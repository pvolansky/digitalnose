"""One device report; independent local worker heartbeats remain authoritative."""
from datetime import timedelta
import json
from pathlib import Path
import time

from .archive import atomic
from .core import canonical, digest, instant, now
from .export import sqlite_readonly
from .provenance import clock_status, health, save_session, session
from .spool import Spool


def heartbeat(spool, session_id, started, sensor_id, error=None):
    report = health(spool, session_id, started, clock_status())
    report['sensor_id'] = sensor_id
    report['local_error'] = error
    if error:
        report['health'] = 'degraded'
        report['issues'].append('local_processing_failed')
    atomic(spool.root/'heartbeat.json', canonical(report).encode())


def aggregate(config, at=None, max_age_seconds=180):
    at = at or now()
    sensors = {}
    for key, item in config['sensors'].items():
        entry = dict(sensor_id=item['sensor_id'], health='unknown', worker_state='missing',
                     worker_observed_at=None, coverage=None)
        root = Path(config['spool_root'])/key
        try:
            report = json.loads((root/'heartbeat.json').read_text())
            age = (instant(at)-instant(report['observed_at'])).total_seconds()
            entry.update(worker_observed_at=report['observed_at'], worker=report)
            if report['sensor_id'] != item['sensor_id']:
                raise ValueError('Heartbeat identity mismatch')
            if age < -60:
                entry.update(worker_state='clock_discontinuity', health='unknown')
            elif age > max_age_seconds:
                entry.update(worker_state='stale', health='unknown')
            else:
                entry.update(worker_state='fresh', health=report['health'])
                db = sqlite_readonly(root/'journal.sqlite3')
                try:
                    row = db.execute('''SELECT body FROM summaries WHERE device=? AND sensor=?
                      ORDER BY minute DESC LIMIT 1''', (config['device_id'], item['sensor_id'])).fetchone()
                finally:
                    db.close()
                if row:
                    coverage = json.loads(row[0])
                    coverage_age = (instant(at)-instant(coverage['minute_start'])).total_seconds()
                    entry['coverage'] = {k: coverage[k] for k in ('minute_start','health','expected_samples',
                        'observed_samples','valid_samples','invalid_samples','error_samples','missing_samples')}
                    if not 0 <= coverage_age <= max_age_seconds:
                        entry['health'] = 'unknown'
                    elif coverage['health'] == 'degraded' or entry['health'] == 'degraded':
                        entry['health'] = 'degraded'
                    elif coverage['health'] != 'normal':
                        entry['health'] = 'unknown'
                else:
                    entry['health'] = 'unknown'
        except Exception as exc:
            entry.update(health='unknown', read_error=type(exc).__name__)
        sensors[key] = entry
    states = [entry['health'] for entry in sensors.values()]
    return dict(observed_at=at, sensors=sensors,
                health='degraded' if 'degraded' in states else ('unknown' if not states or 'unknown' in states else 'normal'),
                all_sensors_confirmed_healthy=bool(states) and all(s=='normal' for s in states),
                stale_after_seconds=max_age_seconds,
                semantics='Point-in-time coverage snapshot, not proof of every instant in the preceding five minutes')


def report_once(config, remote):
    from .worker import publish_health
    root = Path(config['spool_root'])/'device-health'
    spool = Spool(root, max_bytes=512*1024**2, min_free_bytes=config['min_disk_free_bytes'])
    try:
        info = session(config, 'device-health-reporter')
        save_session(spool, info)
        report = aggregate(config)
        host = health(spool, info['session_id'], time.monotonic(), clock_status())
        report['host'] = host
        report['session_id'] = info['session_id']
        if host['health'] == 'degraded' or report['health'] == 'degraded':
            report['health'] = 'degraded'
        elif host['health'] != 'normal':
            report['health'] = 'unknown'
        report['all_sensors_confirmed_healthy'] = report['health'] == 'normal'
        with spool.db:
            spool.db.execute('INSERT INTO health(id,body) VALUES(?,?)', (digest(report), canonical(report)))
        for _ in range(12):
            if not publish_health(spool, remote, config['device_id']):
                break
        return report
    finally:
        spool.close()
