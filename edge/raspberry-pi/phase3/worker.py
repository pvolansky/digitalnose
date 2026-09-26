"""Independent archive/summary worker. Old publishers remain enabled."""
from datetime import timedelta
import json
import time

from .core import canonical, digest, instant, minute, now, stamp
from .export import export_ens
from .integration import open_spool, copy_pending
from .provenance import clock_status, health, save_session, session
from .remote import Supabase, publish_summary, upload_one
from .summary import summarize


def summarize_due(spool, config, key, before, limit=120):
    item = config['sensors'][key]
    device, sensor = config['device_id'], item['sensor_id']
    cutoff = minute(before)
    start = minute(config['coverage_start'])
    cursor_key = 'summary_cursor:' + sensor
    saved_cursor = spool.checkpoint(cursor_key)
    # A retained cursor must not generate minutes from disabled coverage periods.
    cursor = stamp(max(instant(saved_cursor), instant(start))) if saved_cursor is not None else start
    completed = 0
    # Emit missing-sensor minutes even if no observation ever arrives.
    while cursor < cutoff and completed < limit:
        rows = [r for r in spool.rows(device, sensor, cursor) if r['valid'] is not None]
        spool.save_summary(summarize(rows, device, sensor, item['type'], cursor, item['interval_seconds']))
        cursor = stamp(instant(cursor) + timedelta(minutes=1))
        spool.checkpoint(cursor_key, cursor)
        completed += 1
    # Dirty generations catch arbitrarily late outbox deliveries, not just a lookback.
    dirty = spool.db.execute('''SELECT * FROM dirty WHERE device=? AND sensor=?
      AND minute>=? AND minute<? ORDER BY minute LIMIT ?''', (device, sensor, start, cutoff, limit)).fetchall()
    for row in dirty:
        rows = [r for r in spool.rows(device, sensor, row['minute']) if r['valid'] is not None]
        spool.save_summary(summarize(rows, device, sensor, item['type'], row['minute'], item['interval_seconds']))
        with spool.db:
            # This removes rebuild work only, never observations or queue contents.
            spool.db.execute('DELETE FROM dirty WHERE device=? AND sensor=? AND minute=? AND generation=?',
                             (device, sensor, row['minute'], row['generation']))
    return completed + len(dirty)


def publish_health(spool, remote, device):
    row = spool.db.execute('SELECT * FROM health WHERE published=0 ORDER BY id LIMIT 1').fetchone()
    if not row:
        return False
    payload = {'device_id': device, 'id': row['id'], 'body': json.loads(row['body'])}
    session_id = payload['body']['session_id']
    info = spool.db.execute('SELECT body FROM sessions WHERE id=?', (session_id,)).fetchone()
    if info is None:
        raise ValueError('Health session missing')
    key = f'sessions/device={device}/{session_id}.json'
    remote.put(key, info[0].encode())
    if remote.get(key) != info[0].encode():
        raise ValueError('Health session mismatch')
    response = json.loads(remote.rpc('phase3_put_health', {'payload': payload}))
    if response != {'ok': True}:
        raise ValueError('Health acknowledgement failed')
    with spool.db:
        spool.db.execute('UPDATE health SET published=1 WHERE id=?', (row['id'],))
    return True


def run(config, key, stop, remote=None):
    spool = open_spool(config, key)
    info = session(config, 'archive-worker')
    save_session(spool, info)
    started = time.monotonic()
    remote = remote or Supabase.environment()
    try:
        while not stop.is_set():
            local_error = None
            try:
                if config['sensors'][key]['type'] == 'ens160':
                    export_ens(config['ens_database'], spool, config['device_id'],
                               config['sensors'][key]['sensor_id'], historical=False)
                else:
                    copy_pending(config, key, spool, info['session_id'])
                summarize_due(spool, config, key, stamp(instant(now()) - timedelta(seconds=30)))
                # Full UTC hours, up to 3600 observations/16MiB input per part.
                cutoff = stamp(instant(now()).replace(minute=0, second=0, microsecond=0))
                spool.seal(cutoff)
            except Exception as exc:
                local_error = type(exc).__name__
                print(canonical({'event': 'phase3_local_failure', 'error_type': type(exc).__name__, 'at': now()}), flush=True)
            try:
                from .device_health import heartbeat
                heartbeat(spool, info['session_id'], started, config['sensors'][key]['sensor_id'], local_error)
            except Exception as exc:
                print(canonical({'event': 'phase3_heartbeat_failed', 'error_type': type(exc).__name__, 'at': now()}), flush=True)
            # Each network domain fails independently of local acquisition and summaries.
            for job in (lambda: upload_one(spool, remote),):
                try:
                    job()
                except Exception as exc:
                    print(canonical({'event': 'phase3_remote_failure', 'error_type': type(exc).__name__, 'at': now()}), flush=True)
            try:
                for _ in range(120):
                    if stop.is_set() or not publish_summary(spool, remote):
                        break
            except Exception as exc:
                print(canonical({'event': 'phase3_summary_failure', 'error_type': type(exc).__name__, 'at': now()}), flush=True)
            stop.wait(30)
    finally:
        spool.close()
