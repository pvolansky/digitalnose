"""Allowlisted, keyset-paged read-only sources. No database mutation statements."""
from datetime import timedelta
import json
from pathlib import Path
import re
import sqlite3

from .core import canonical, ens_record, instant, record, stamp

TABLES = {
    'sensor_observations': dict(scope='sensor_id', time='observed_at', arrival='received_at',
        keys=('observed_at', 'sequence_number'),
        columns='id,sensor_id,sensor_type,observed_at,received_at,sequence_number,status,valid,readings,acquisition,metadata,error_code,last_error'),
    'minute_aggregates': dict(scope='device_id', time='minute_start_utc', arrival='created_at',
        keys=('minute_start_utc', 'id'),
        columns='id,device_id,minute_start_utc,tvoc_mean,tvoc_min,tvoc_max,eco2_mean,eco2_min,eco2_max,aqi_max,sample_count,created_at'),
    'smell_reports': dict(scope='site_id', time='reported_at', arrival='created_at',
        keys=('reported_at', 'id'), columns='id,site_id,reported_at,intensity,smell_type,created_at'),
    'site_state_events': dict(scope='site_id', time='recorded_at', arrival='created_at',
        keys=('recorded_at', 'id'), columns='id,site_id,event_type,value,recorded_at,created_at'),
    'weather_observations': dict(scope='site_id', time='observed_at_utc', arrival='created_at',
        keys=('observed_at_utc', 'id'), columns='id,site_id,observed_at_utc,temperature_c,relative_humidity_pct,surface_pressure_hpa,precipitation_mm,wind_speed_kmh,wind_direction_deg,wind_gust_kmh,weather_code,source,model,created_at'),
}


def no_secrets(value):
    """Fail closed on common credential keys/tokens; never redact source silently."""
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r'(password|secret|token|api.?key|credential|key_hash|private.?key)', key, re.I):
                raise ValueError('Potential secret in selected metadata; manual review required')
            no_secrets(item)
    elif isinstance(value, list):
        for item in value:
            no_secrets(item)
    elif isinstance(value, str) and (re.search(r'\bdn_[A-Za-z0-9_-]{43}\b', value) or 'PRIVATE KEY-----' in value):
        raise ValueError('Potential credential in selected metadata')


class CloudSource:
    def __init__(self, dsn):
        import psycopg
        from psycopg.rows import dict_row
        self.db = psycopg.connect(dsn, autocommit=True, row_factory=dict_row, connect_timeout=10)
        self.db.read_only = True

    def close(self):
        self.db.close()

    def query(self, query, parameters):
        with self.db.transaction():
            self.db.execute("SET LOCAL statement_timeout = '10s'")
            self.db.execute("SET LOCAL lock_timeout = '500ms'")
            return self.db.execute(query, parameters).fetchall()

    def page(self, table, scope, start, end, boundary, cursor=None, limit=1000):
        if not 1 <= limit <= 1000:
            raise ValueError('Export page exceeds limit')
        spec = TABLES[table]  # Identifiers are constants, never user-supplied SQL.
        keys = spec['keys']
        query = (f"SELECT {spec['columns']} FROM public.{table} WHERE {spec['scope']}=%s "
                 f"AND {spec['time']} >= %s AND {spec['time']} < %s AND {spec['arrival']} <= %s")
        params = [scope, start, end, boundary]
        if cursor is not None:
            query += f" AND ({','.join(keys)}) > (%s,%s)"
            params.extend(cursor)
        query += f" ORDER BY {','.join(keys)} LIMIT %s"
        return self.query(query, (*params, limit))

    def metadata(self, device):
        # Explicit projection excludes API keys, member profiles, coordinates and free-text labels.
        devices = self.query('SELECT id,site_id,device_identifier,created_at FROM public.devices WHERE id=%s', (device,))
        if len(devices) != 1:
            raise ValueError('Device not found')
        sensors = self.query('''SELECT id,device_id,sensor_key,sensor_type,manufacturer,model,
          connection_type,mux_channel,enabled,freshness_seconds,created_at,updated_at
          FROM public.sensors WHERE device_id=%s ORDER BY id LIMIT 100''', (device,))
        sites = self.query('SELECT id,timezone,continuous_ventilation,created_at FROM public.sites WHERE id=%s',
                           (devices[0]['site_id'],))
        return {'devices': devices, 'sensors': sensors, 'sites': sites}


def export_cloud(source, spool, table, scope, device, sensor, kind, start, end, boundary):
    spec = TABLES[table]
    start, end, boundary = instant(start), instant(end), instant(boundary)
    if start >= end:
        raise ValueError('Export interval is empty')
    # No resume watermark is trusted for late arrivals. Re-running this explicit
    # observed-time range with a later received-at boundary reconciles all pages.
    count = 0
    hour = start
    while hour < end:
        upper = min(end, hour.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
        cursor = None
        while True:
            batch = source.page(table, scope, hour, upper, boundary, cursor)
            for row in batch:
                no_secrets(row)
                if table == 'sensor_observations':
                    item = record(table, device, sensor, row['sensor_type'], row['id'], row['observed_at'], row,
                                  row['readings'], row['received_at'], row['sequence_number'], row['valid'], row['status'])
                else:
                    item = record(table, device, sensor, kind, row['id'], row[spec['time']], row,
                                  received=row[spec['arrival']])
                count += int(spool.append(item, retain=True))
            if not batch:
                break
            cursor = tuple(batch[-1][key] for key in spec['keys'])
            while spool.seal(stamp(upper)):
                pass
        hour = upper
    spool.checkpoint('cloud_export:' + table + ':' + str(scope),
                     dict(start=stamp(start), end=stamp(end), received_boundary=stamp(boundary), added=count,
                          reconciliation='Repeat full observed range with later boundary; do not rely on observed-time watermark'))
    return count


def sqlite_readonly(path):
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=.25)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    return db


def export_ens(path, spool, device, sensor='ens160_01', historical=True, limit=1000):
    if not 1 <= limit <= 1000:
        raise ValueError('Invalid SQLite batch size')
    db = sqlite_readonly(path)
    prefix = 'ens:' + str(Path(path).resolve()) + ':' + sensor
    try:
        high = db.execute('SELECT max(id) FROM sensor_readings').fetchone()[0] or 0
        # Live table is append-only in this phase; bounded high-id snapshot avoids
        # holding a SQLite read transaction that could delay the collector.
        last = spool.checkpoint(prefix) or 0
        count = 0
        while last < high:
            rows = db.execute('''SELECT id,recorded_at_utc,tvoc_ppb,eco2_ppm,aqi,sensor_status
              FROM sensor_readings WHERE id>? AND id<=? ORDER BY id LIMIT ?''', (last, high, limit)).fetchall()
            if not rows:
                raise ValueError('ENS source IDs disappeared inside export boundary')
            for row in rows:
                count += int(spool.append(ens_record(dict(row), device, sensor), retain=True if historical else None))
            last = rows[-1]['id']
            spool.checkpoint(prefix, last)  # Journal commit precedes cursor advance.
            if not historical:
                break  # Live worker yields to health/summaries/uploads after one bounded page.
        if historical:
            last_minute = ''
            high_minute = db.execute('SELECT max(minute_start_utc) FROM minute_aggregates').fetchone()[0] or ''
            while last_minute < high_minute:
                rows = db.execute('''SELECT minute_start_utc,tvoc_mean,tvoc_min,tvoc_max,
                  eco2_mean,eco2_min,eco2_max,aqi_max,sample_count FROM minute_aggregates
                  WHERE minute_start_utc>? AND minute_start_utc<=? ORDER BY minute_start_utc LIMIT ?''',
                                  (last_minute, high_minute, limit)).fetchall()
                if not rows:
                    break
                for row in rows:
                    spool.append(record('ens_minute_aggregates', device, sensor, 'ens160',
                                        row['minute_start_utc'], row['minute_start_utc'], dict(row)), retain=True)
                last_minute = rows[-1]['minute_start_utc']
        return count
    finally:
        db.close()
