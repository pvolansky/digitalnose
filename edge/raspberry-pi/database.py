"""Phase I live-schema storage. Existing incompatible databases are never converted."""
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

VERSION = 1
RAW = {'id','recorded_at_utc','tvoc_ppb','eco2_ppm','aqi','sensor_status','synced_at_utc'}
AGG = {'minute_start_utc','tvoc_mean','tvoc_min','tvoc_max','eco2_mean','eco2_min','eco2_max','aqi_max','sample_count','synced_at_utc'}
SCHEMA = '''
CREATE TABLE sensor_readings(id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at_utc TEXT NOT NULL,
 tvoc_ppb INTEGER NOT NULL, eco2_ppm INTEGER NOT NULL, aqi INTEGER NOT NULL,
 sensor_status INTEGER NOT NULL, synced_at_utc TEXT);
CREATE INDEX idx_sensor_readings_time ON sensor_readings(recorded_at_utc);
CREATE TABLE minute_aggregates(minute_start_utc TEXT PRIMARY KEY, tvoc_mean REAL NOT NULL,
 tvoc_min INTEGER NOT NULL,tvoc_max INTEGER NOT NULL,eco2_mean REAL NOT NULL,
 eco2_min INTEGER NOT NULL,eco2_max INTEGER NOT NULL,aqi_max INTEGER NOT NULL,
 sample_count INTEGER NOT NULL,synced_at_utc TEXT);
'''
EXTENSIONS = '''
CREATE TABLE IF NOT EXISTS phase1_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS phase1_diagnostics(reading_id INTEGER PRIMARY KEY REFERENCES sensor_readings(id),
 raw_status INTEGER NOT NULL, eligible INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS phase1_retries(minute_start_utc TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,retry_at REAL NOT NULL DEFAULT 0);
'''

def utc(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()

def epoch(value):
    dt = datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Minute timestamps must include timezone')
    return dt.timestamp()

def connect(path=None, *, upgrade=False, aggregation_start=None):
    if aggregation_start is not None and (aggregation_start != int(aggregation_start) or int(aggregation_start) % 60):
        raise ValueError('Boundary must be a UTC minute')
    path = Path(path or os.environ.get('DIGITALNOSE_DB', str(Path.home()/'digital-nose/data/digitalnose.db')))
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=5)
    db.row_factory=sqlite3.Row
    try:
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        if tables:
            for table, columns in [('sensor_readings',RAW),('minute_aggregates',AGG)]:
                actual={r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
                info={r['name']:r for r in db.execute(f'PRAGMA table_info({table})')}
                identity='id' if table=='sensor_readings' else 'minute_start_utc'
                expected_type='INTEGER' if table=='sensor_readings' else 'TEXT'
                if actual != columns or info[identity]['type'].upper()!=expected_type or not info[identity]['pk']:
                    raise ValueError(f'Unsupported Phase I schema: {table}; explicit offline migration required')
            version = db.execute("SELECT value FROM phase1_metadata WHERE key='schema_version'").fetchone() if 'phase1_metadata' in tables else None
            if version and version[0] != str(VERSION):
                raise ValueError('Unsupported Phase I schema version')
            if version and not {'phase1_diagnostics','phase1_retries'}.issubset(tables):
                raise ValueError('Incomplete versioned schema')
            if not version and not upgrade:
                raise ValueError('Live unversioned schema: explicit --upgrade with aggregation boundary required')
            if not version and aggregation_start is None:
                raise ValueError('Explicit aggregation boundary required; historical backfill is disabled')
        else:
            db.executescript(SCHEMA)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA busy_timeout=5000')
        db.executescript(EXTENSIONS)
        with db:
            db.execute("INSERT OR IGNORE INTO phase1_metadata VALUES ('schema_version',?)",(str(VERSION),))
            if aggregation_start is not None:
                boundary=int(aggregation_start)
                if boundary % 60: raise ValueError('Boundary must be a UTC minute')
                db.execute("INSERT OR IGNORE INTO phase1_metadata VALUES ('aggregation_cursor',?)",(str(boundary),))
        return db
    except Exception:
        db.close()
        raise

def insert_reading(db, recorded_at_utc, observation):
    with db:
        cursor=db.execute('INSERT INTO sensor_readings(recorded_at_utc,tvoc_ppb,eco2_ppm,aqi,sensor_status) VALUES (?,?,?,?,?)',
            (recorded_at_utc,observation.tvoc,observation.eco2,observation.aqi,observation.validity))
        db.execute('INSERT INTO phase1_diagnostics VALUES (?,?,?,?)',
            (cursor.lastrowid,observation.raw_status,int(observation.eligible),observation.reason))

def create_minute_aggregate(db, minute_start, minute_end):
    start,end=epoch(minute_start),epoch(minute_end)
    if start % 60 or end != start+60: raise ValueError('Expected one UTC minute')
    try:
        db.execute('BEGIN IMMEDIATE')
        exists=db.execute('SELECT 1 FROM minute_aggregates WHERE julianday(minute_start_utc)=julianday(?)',(minute_start,)).fetchone()
        if exists: result='already_exists'
        else:
            rows=db.execute('''SELECT r.*,d.eligible FROM sensor_readings r LEFT JOIN phase1_diagnostics d ON d.reading_id=r.id
                WHERE julianday(recorded_at_utc)>=julianday(?) AND julianday(recorded_at_utc)<julianday(?)''',(minute_start,minute_end)).fetchall()
            eligible=[r for r in rows if r['sensor_status']==0 and r['eligible'] != 0 and 0<=r['tvoc_ppb']<=65000 and 400<=r['eco2_ppm']<=65000 and 1<=r['aqi']<=5]
            if not rows: result='no_samples'
            elif not eligible: result='no_eligible_samples'
            else:
                # One actual eligible observation per five-second slot; never truncate count alone.
                slots={}
                for r in sorted(eligible,key=lambda r:r['id']): slots.setdefault(int(epoch(r['recorded_at_utc']))//5,r)
                samples=list(slots.values())
                tvoc=[r['tvoc_ppb'] for r in samples]; eco2=[r['eco2_ppm'] for r in samples]
                db.execute('INSERT INTO minute_aggregates VALUES (?,?,?,?,?,?,?,?,?,NULL)',
                    (minute_start,sum(tvoc)/len(samples),min(tvoc),max(tvoc),sum(eco2)/len(samples),min(eco2),max(eco2),max(r['aqi'] for r in samples),len(samples)))
                result='created'
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--upgrade',action='store_true',required=True)
    parser.add_argument('--aggregation-start',required=True)
    args=parser.parse_args()
    db=connect(upgrade=True,aggregation_start=epoch(args.aggregation_start))
    db.close()
