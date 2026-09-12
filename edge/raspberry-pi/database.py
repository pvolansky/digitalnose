"""Local-only raw readings and durable upload outbox. No network operations here."""
import os
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sensor_readings (
 observed_at INTEGER PRIMARY KEY CHECK(observed_at % 5 = 0),
 tvoc INTEGER NOT NULL CHECK(tvoc BETWEEN 0 AND 65000),
 eco2 INTEGER NOT NULL CHECK(eco2 BETWEEN 400 AND 65000),
 aqi INTEGER NOT NULL CHECK(aqi BETWEEN 1 AND 5)
);
CREATE TABLE IF NOT EXISTS minute_aggregates (
 minute_start_utc INTEGER PRIMARY KEY,
 tvoc_mean REAL NOT NULL, tvoc_min INTEGER NOT NULL, tvoc_max INTEGER NOT NULL,
 eco2_mean REAL NOT NULL, eco2_min INTEGER NOT NULL, eco2_max INTEGER NOT NULL,
 aqi_max INTEGER NOT NULL, sample_count INTEGER NOT NULL,
 synced_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 retry_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS unsynced_minutes ON minute_aggregates(retry_at, minute_start_utc) WHERE synced_at IS NULL;
"""

def connect(path=None):
    path = path or os.environ.get("DIGITALNOSE_DB", "/var/lib/digitalnose/readings.sqlite3")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=2000")
    db.executescript(SCHEMA)
    return db
