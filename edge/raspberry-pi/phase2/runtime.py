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
    def expired(_signal, _frame):
        raise TimeoutError('Driver deadline exceeded')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
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


class Acquisition:
    def __init__(self, key, kind, driver, box, channel=None):
        self.key, self.kind, self.driver, self.box, self.channel = key, kind, driver, box, channel
        self.pending = None

    def step(self):
        if self.pending is None:
            if not self.box.has_capacity():
                raise QueueFull('Acquisition paused before next physical read')
            started = time.monotonic()
            try:
                self.pending = self.driver.read()
                if not isinstance(self.pending, Observation):
                    raise ValueError('Malformed driver result')
                self.pending.payload(self.box.identifier, self.key, self.kind, 0)
            except ValueError:
                self.pending = Observation({}, 'invalid', False, error_code='malformed_driver_result')
            except Exception as exc:
                self.pending = Observation({}, 'error', False, error_code=type(exc).__name__)
                try:
                    self.driver.close()
                except Exception:
                    pass
            if self.channel is not None:
                self.pending.acquisition['mux_channel'] = self.channel
            log('acquisition', self.key, self.kind, mux_channel=self.channel,
                duration_ms=round((time.monotonic() - started) * 1000, 3),
                status=self.pending.status, valid=self.pending.valid, driver_error=self.pending.error_code or None)
        # If persistence fails, retain the same in-memory observation and do not
        # collect another until it is safely written. No new timestamp on retry.
        seq = self.box.enqueue(self.pending)
        observation, self.pending = self.pending, None
        log('persisted', self.key, self.kind, sequence_number=seq, **self.box.stats())
        return observation

    def close(self):
        try:
            self.driver.close()
        finally:
            self.box.close()


def open_box(config, key, collector):
    return Outbox(state_path(config, key), collector, key, config['sensors'][key]['type'], **config['outbox'])


def stop_event():
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _s, _f: stop.set())
    return stop


def collect(config, key, driver, box, stop):
    item = config['sensors'][key]
    runner = Acquisition(key, item['type'], driver, box, item.get('mux_channel'))
    due = time.monotonic()
    try:
        while not stop.is_set():
            try:
                with deadline():
                    observation = runner.step()
                if item['type'] == 'bme690':
                    try:
                        save_environment(config, key, observation)
                    except OSError:
                        log('compensation_cache_unavailable', key, item['type'])
            except (QueueFull, sqlite3.Error, OSError) as exc:
                log('storage_backpressure', key, item['type'], driver_error=type(exc).__name__)
                # In particular, do not leave SGP41 in conditioning while
                # acquisition waits for disk space. Restart cleanly on resume.
                try:
                    with deadline():
                        driver.close()
                except Exception:
                    log('backpressure_driver_close_failed', key, item['type'])
                stop.wait(5)
                due = time.monotonic()
            due += item['interval_seconds']
            if due < time.monotonic():
                # Skip missed slots rather than burst-reading after a delay.
                due = time.monotonic() + item['interval_seconds']
            stop.wait(max(0, due - time.monotonic()))
    finally:
        if runner.pending is not None:
            try:
                box.enqueue(runner.pending)
            except (sqlite3.Error, QueueFull, ValueError):
                log('unpersisted_observation_on_shutdown', key, item['type'])
        try:
            with deadline():
                runner.close()
        except Exception as exc:
            log('shutdown_error', key, item['type'], driver_error=type(exc).__name__)
        log('stopped', key, item['type'])


def publish(config, key, box, url, credential, stop):
    try:
        while not stop.is_set():
            try:
                result = sync_once(box, url, credential, time.time())
                if result:
                    log('delivery', key, config['sensors'][key]['type'], **result)
                else:
                    stop.wait(1)
            except sqlite3.Error as exc:
                log('outbox_unavailable', key, config['sensors'][key]['type'], driver_error=type(exc).__name__)
                stop.wait(5)
    finally:
        box.close()
