"""Single-sensor workers; systemd gives each acquisition and publisher isolation."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import sqlite3
import threading
import time

from .model import Observation, utc_now
from .outbox import Outbox, QueueFull
from .config import state_path
from .publish import sync_once


def log(event, key, kind, **fields):
    # Deliberately exclude exception messages, payloads, URLs, headers and credentials.
    print(json.dumps(dict(timestamp=utc_now(), event=event, sensor_key=key,
                          sensor_type=kind, **fields), allow_nan=False), flush=True)


@contextmanager
def deadline(seconds=3):
    state = {'expired': False}
    def expired(_signal, _frame):
        state['expired'] = True
        raise TimeoutError('Driver deadline exceeded')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield state
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def compensation(config):
    key = config.get('compensation_source')
    if not key or config['sensors'].get(key, {}).get('type') != 'bme690':
        return None
    try:
        data = json.loads((Path(config['state_dir']) / (key + '.environment.json')).read_text())
        at = datetime.fromisoformat(data['observed_at'].replace('Z', '+00:00'))
        age = (datetime.now(timezone.utc) - at).total_seconds()
        t, h = data['temperature_c'], data['humidity_pct']
        if 0 <= age <= 30 and type(t) in (int, float) and type(h) in (int, float) and -45 <= t <= 130 and 0 <= h <= 100:
            return t, h, key, data['observed_at']
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def save_environment(config, key, observation):
    if not observation.valid:
        return
    readings = observation.readings
    if readings.get('temperature_c') is None or readings.get('humidity_pct') is None:
        return
    dest = Path(config['state_dir']) / (key + '.environment.json')
    temp = dest.with_suffix('.tmp')
    temp.write_text(json.dumps({'observed_at': observation.observed_at,
                               'temperature_c': readings['temperature_c'], 'humidity_pct': readings['humidity_pct']}))
    os.replace(temp, dest)


def storage_error(exc):
    # Python <3.11 does not expose SQLite extended codes: null means unavailable.
    return dict(error_domain='storage', error_type=type(exc).__name__,
                sqlite_errorcode=getattr(exc, 'sqlite_errorcode', None),
                sqlite_errorname=getattr(exc, 'sqlite_errorname', None))


class Acquisition:
    def __init__(self, key, kind, driver, box, channel=None):
        self.key, self.kind, self.driver, self.box, self.channel = key, kind, driver, box, channel
        self.pending = None
        self.storage_failures = 0
        self.pending_since = None

    def recover_hardware(self, reason):
        started = time.monotonic()
        close_error = None
        try:
            with deadline():
                self.driver.close()
        except Exception as exc:
            close_error = type(exc).__name__
        log('hardware_recovery', self.key, self.kind, error_domain='hardware',
            reason=reason, recovery_action='close_for_lazy_reinitialize',
            recovery_ms=round((time.monotonic() - started) * 1000, 3),
            close_error=close_error)

    def persist_pending(self):
        if self.pending is None:
            return None
        started = time.monotonic()
        try:
            # No SIGALRM around SQLite. Its own busy timeout bounds lock waits;
            # filesystem stalls are not relabelled as sensor faults.
            seq = self.box.enqueue(self.pending)
        except (QueueFull, sqlite3.Error, OSError) as exc:
            self.storage_failures += 1
            log('persistence_retry', self.key, self.kind,
                persistence_ms=round((time.monotonic() - started) * 1000, 3),
                persistence_retry=self.storage_failures, storage_operation='enqueue',
                pending_observed_at=self.pending.observed_at, **storage_error(exc))
            raise
        observation, self.pending = self.pending, None
        # Clear pending immediately after commit, BEFORE any logging/diagnostics.
        # Do not perform a fallible stats query after commit and retry the insert.
        log('persisted', self.key, self.kind, sequence_number=seq,
            persistence_ms=round((time.monotonic() - started) * 1000, 3),
            persistence_wait_ms=round((time.monotonic() - self.pending_since) * 1000, 3),
            persistence_retry=self.storage_failures, observed_at=observation.observed_at)
        self.storage_failures = 0
        self.pending_since = None
        return observation

    def step(self):
        if self.pending is None:
            # Storage preflight is outside the sensor-operation deadline too.
            preflight = time.monotonic()
            try:
                if not self.box.has_capacity():
                    raise QueueFull('Acquisition paused before next physical read')
            except (QueueFull, sqlite3.Error, OSError) as exc:
                log('storage_preflight_failed', self.key, self.kind,
                    storage_operation='capacity',
                    persistence_ms=round((time.monotonic() - preflight) * 1000, 3),
                    **storage_error(exc))
                raise
            started = time.monotonic()
            timer = None
            hardware_error = None
            try:
                with deadline() as timer:
                    self.pending = self.driver.read()
                if not isinstance(self.pending, Observation):
                    raise ValueError('Malformed driver result')
                self.pending.payload(self.box.identifier, self.key, self.kind, 0)
                if self.pending.status == 'error':
                    hardware_error = self.pending.error_code or 'driver_error'
            except ValueError:
                self.pending = Observation({}, 'invalid', False, error_code='malformed_driver_result')
            except Exception as exc:
                hardware_error = type(exc).__name__
                self.pending = Observation({}, 'error', False, error_code=hardware_error)
            self.pending_since = time.monotonic()
            if self.channel is not None:
                self.pending.acquisition['mux_channel'] = self.channel
            log('acquisition', self.key, self.kind, mux_channel=self.channel,
                duration_ms=round((time.monotonic() - started) * 1000, 3),
                status=self.pending.status, valid=self.pending.valid,
                driver_error=self.pending.error_code or None,
                error_domain='hardware' if hardware_error else None,
                sensor_deadline_expired=bool(timer and timer['expired']),
                **getattr(self.driver, 'last_timings', {}))
            if hardware_error:
                self.recover_hardware(hardware_error)
        # Retain the exact object/timestamp across retries; never read over it.
        return self.persist_pending()

    def close(self):
        try:
            with deadline():
                self.driver.close()
        finally:
            self.box.close()


def open_box(config, key, collector):
    started = time.monotonic()
    kind = config['sensors'][key]['type']
    try:
        box = Outbox(state_path(config, key), collector, key, kind, **config['outbox'])
    except (sqlite3.Error, OSError) as exc:
        log('storage_initialization_failed', key, kind, storage_operation='open',
            persistence_ms=round((time.monotonic() - started) * 1000, 3), **storage_error(exc))
        raise
    log('storage_initialized', key, kind, storage_operation='open',
        persistence_ms=round((time.monotonic() - started) * 1000, 3))
    return box


def stop_event():
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _s, _f: stop.set())
    return stop


def collect(config, key, driver, box, stop):
    item = config['sensors'][key]
    runner = Acquisition(key, item['type'], driver, box, item.get('mux_channel'))
    due = time.monotonic()
    failures = 0
    try:
        while not stop.is_set():
            try:
                observation = runner.step()
                failures = 0
                if item['type'] == 'bme690':
                    try:
                        save_environment(config, key, observation)
                    except OSError:
                        log('compensation_cache_unavailable', key, item['type'])
            except (QueueFull, sqlite3.Error, OSError) as exc:
                failures += 1
                backoff = min(5.0, 0.25 * 2 ** min(failures - 1, 5))
                log('storage_backpressure', key, item['type'], retry_count=failures,
                    retry_delay_seconds=backoff, pending=runner.pending is not None,
                    **storage_error(exc))
                # No close/reset: storage owns neither hardware nor conditioning.
                stop.wait(backoff)
                due = time.monotonic()
                continue
            due += item['interval_seconds']
            if due < time.monotonic():
                # Skip missed slots rather than burst-reading after a delay.
                due = time.monotonic() + item['interval_seconds']
            stop.wait(max(0, due - time.monotonic()))
    finally:
        # A graceful stop must not voluntarily discard a pending measurement.
        # SIGKILL/power loss can still lose RAM; systemd's stop timeout applies.
        while runner.pending is not None:
            try:
                runner.persist_pending()
            except (sqlite3.Error, QueueFull, OSError) as exc:
                log('shutdown_pending_storage', key, item['type'],
                    pending_observed_at=runner.pending.observed_at, **storage_error(exc))
                time.sleep(min(5.0, 0.25 * 2 ** min(runner.storage_failures - 1, 5)))
        try:
            runner.close()
        except Exception as exc:
            log('shutdown_error', key, item['type'], driver_error=type(exc).__name__)
        log('stopped', key, item['type'])


def publish(config, key, box, url, credential, stop):
    mirror = None
    try:
        from .publish import publish_mode
        mode = publish_mode(os.environ.get('DIGITALNOSE_PUBLISH_MODE'))
        archive_config = os.environ.get('DIGITALNOSE_PHASE3_CONFIG')
        if mode == 'archive_only' and not archive_config:
            raise ValueError('Archive-only publishing requires Phase III configuration')
        if archive_config:
            from phase3.integration import Mirror
            from phase3.publisher_timing import timed_sync_once
            mirror = Mirror(archive_config, key)
        while not stop.is_set():
            try:
                if mirror is None:
                    result = sync_once(box, url, credential, time.time())
                else:
                    result = timed_sync_once(
                        sync_once, box, url, credential, time.time(), mirror,
                        lambda fields: log('publisher_timing', key,
                                           config['sensors'][key]['type'], **fields),
                        archive_only=mode == 'archive_only')
                if result:
                    log('delivery', key, config['sensors'][key]['type'], **result)
                else:
                    stop.wait(1)
            except (sqlite3.Error, OSError, ValueError) as exc:
                if mirror is None and not isinstance(exc, sqlite3.Error):
                    raise
                log('outbox_unavailable', key, config['sensors'][key]['type'], **storage_error(exc))
                stop.wait(5)
    finally:
        try:
            if mirror is not None:
                mirror.close()
        finally:
            box.close()
