"""Explicitly enabled Phase II hooks. No optional dependency in acquisition."""
import json
import os
from pathlib import Path
from uuid import UUID

from .core import phase2_record
from .export import no_secrets
from .provenance import save_session, session
from .spool import Spool


def load_config(path):
    data = json.loads(Path(path).read_text())
    if data.get('schema_version') != 1:
        raise ValueError('Unsupported Phase III configuration')
    UUID(data['device_id'])
    if not Path(data['spool_root']).is_absolute():
        raise ValueError('Spool root must be absolute')
    for key in ('ens_database', 'phase2_state_dir'):
        if not Path(data[key]).is_absolute():
            raise ValueError('Source paths must be absolute')
    from .core import minute, stamp
    if stamp(data['coverage_start']) != minute(data['coverage_start']):
        raise ValueError('Coverage start must be a whole UTC minute')
    for key, item in data['sensors'].items():
        from .core import METRICS, safe_component
        safe_component(key)
        UUID(item['sensor_id'])
        if item['type'] not in METRICS or not 0 < item['interval_seconds'] <= 60:
            raise ValueError('Invalid Phase III sensor configuration')
    if not 16*1024**2 <= data['spool_max_bytes_per_sensor'] <= 32*1024**3:
        raise ValueError('Invalid per-sensor spool budget')
    if data['min_disk_free_bytes'] < 128*1024**2:
        raise ValueError('Disk reserve too small')
    no_secrets(data)
    return data


def open_spool(config, key):
    return Spool(Path(config['spool_root']) / key, config['spool_max_bytes_per_sensor'], config['min_disk_free_bytes'])


def acquisition_session(config, key):
    path = os.environ.get('DIGITALNOSE_PHASE3_CONFIG')
    if not path:
        return None
    archive = load_config(path)
    item = archive['sensors'][key]
    if (item['type'], item['interval_seconds']) != (config['sensors'][key]['type'], config['sensors'][key]['interval_seconds']):
        raise ValueError('Archive cadence/type differs from acquisition configuration')
    spool = open_spool(archive, key)
    try:
        data = session(config, 'acquisition')
        data['acquisition_build_id'] = data['build_id']
        # Only the non-secret sensor topology is retained; environment is never read.
        data['sensor_config'] = {k: v for k, v in config['sensors'][key].items()
                                 if k in ('type', 'enabled', 'address', 'mux_channel', 'interval_seconds', 'serial_port')}
        data['device_id'] = archive['device_id']
        data['sensor_id'] = item['sensor_id']
        save_session(spool, data)
        return data['session_id']
    finally:
        spool.close()


class Mirror:
    def __init__(self, path, key):
        self.config = load_config(path)
        self.key = key
        self.spool = open_spool(self.config, key)
        self.session = session(self.config)
        self.session['device_id'] = self.config['device_id']
        self.session['sensor_id'] = self.config['sensors'][key]['sensor_id']
        save_session(self.spool, self.session)

    def __call__(self, body):
        payload = json.loads(body)
        no_secrets(payload)
        item = self.config['sensors'][self.key]
        if payload['sensor_key'] != self.key or payload['sensor_type'] != item['type']:
            raise ValueError('Archive sensor mapping mismatch')
        acquisition = payload.get('metadata', {}).get('phase3', {}).get('session_id')
        if acquisition and not self.spool.db.execute('SELECT 1 FROM sessions WHERE id=?', (acquisition,)).fetchone():
            raise ValueError('Acquisition session record missing')
        self.spool.append(phase2_record(payload, self.config['device_id'], item['sensor_id'],
                                       acquisition or self.session['session_id']))

    def close(self):
        self.spool.close()


def copy_pending(config, key, spool, capture_session):
    """Independent bounded reader, including quarantined rows; no queue mutation.

    The publisher mirror closes the reader/ack race. Never deploy this reader
    alone and claim it is a lossless replacement for the acknowledgement hook.
    """
    from .export import sqlite_readonly
    path = Path(config['phase2_state_dir']) / (key + '.sqlite3')
    checkpoint = 'phase2_read_cursor:' + key
    last = spool.checkpoint(checkpoint) or 0
    db = sqlite_readonly(path)
    try:
        rows = db.execute('SELECT sequence,body FROM outbox WHERE sequence>? ORDER BY sequence LIMIT 1000', (last,)).fetchall()
    finally:
        db.close()  # Release old-queue read lock before writing any archive data.
    item = config['sensors'][key]
    for row in rows:
        payload = json.loads(row['body'])
        no_secrets(payload)
        if payload['sensor_key'] != key or payload['sensor_type'] != item['type']:
            raise ValueError('Queue identity mismatch')
        reference = payload.get('metadata', {}).get('phase3', {}).get('session_id') or capture_session
        spool.append(phase2_record(payload, config['device_id'], item['sensor_id'], reference))
        last = row['sequence']
    if rows:
        spool.checkpoint(checkpoint, last)
    return len(rows)
