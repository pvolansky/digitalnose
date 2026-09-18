"""Per-sensor durable sequence allocation and byte-identical HTTP outbox."""
import json
import sqlite3
from pathlib import Path


class QueueFull(RuntimeError):
    pass


class Outbox:
    def __init__(self, path, identifier, sensor_key, sensor_type, max_rows=100000,
                 max_bytes=128 * 1024 * 1024, max_db_bytes=256 * 1024 * 1024):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=2)
        self.db.row_factory = sqlite3.Row
        self.max_rows, self.max_bytes = max_rows, max_bytes
        self.identifier, self.key, self.kind = identifier, sensor_key, sensor_type
        self.db.execute('PRAGMA busy_timeout=2000')
        self.db.execute('PRAGMA journal_mode=DELETE')
        self.db.execute('PRAGMA synchronous=FULL')
        page_size = self.db.execute('PRAGMA page_size').fetchone()[0]
        self.db.execute('PRAGMA max_page_count=%d' % (max_db_bytes // page_size))
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS identity (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), identifier TEXT NOT NULL,
            sensor_key TEXT NOT NULL, sensor_type TEXT NOT NULL, next_seq INTEGER NOT NULL,
            queued_rows INTEGER NOT NULL DEFAULT 0, queued_bytes INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS outbox (
            sequence INTEGER PRIMARY KEY, body BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, retry_at REAL NOT NULL DEFAULT 0,
            http_status INTEGER, CHECK(status IN ('pending','quarantined')));
          CREATE INDEX IF NOT EXISTS ready ON outbox(status,retry_at,sequence);
        ''')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO identity(singleton,identifier,sensor_key,sensor_type,next_seq) VALUES(1,?,?,?,1)',
                            (identifier, sensor_key, sensor_type))
            saved = self.db.execute('SELECT * FROM identity').fetchone()
        if (saved['identifier'], saved['sensor_key'], saved['sensor_type']) != (identifier, sensor_key, sensor_type):
            self.db.close()
            raise ValueError('Outbox belongs to another collector/sensor; never reuse it')

    def has_capacity(self):
        row = self.db.execute('SELECT queued_rows,queued_bytes FROM identity').fetchone()
        return row[0] < self.max_rows and row[1] + 16384 <= self.max_bytes

    def enqueue(self, observation):
        # Sequence, immutable payload and queue counters commit atomically.
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            state = self.db.execute('SELECT * FROM identity').fetchone()
            seq = state['next_seq']
            payload = observation.payload(self.identifier, self.key, self.kind, seq)
            body = json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
            if len(body) > 16384:
                raise ValueError('Payload exceeds API limit')
            if state['queued_rows'] >= self.max_rows or state['queued_bytes'] + len(body) > self.max_bytes:
                raise QueueFull('Outbox capacity reached; acquisition paused')
            self.db.execute('INSERT INTO outbox(sequence,body) VALUES(?,?)', (seq, body))
            self.db.execute('UPDATE identity SET next_seq=?,queued_rows=queued_rows+1,queued_bytes=queued_bytes+? WHERE singleton=1',
                            (seq + 1, len(body)))
        return seq

    def next(self, now):
        return self.db.execute("SELECT * FROM outbox WHERE status='pending' AND retry_at<=? ORDER BY sequence LIMIT 1", (now,)).fetchone()

    def acknowledge(self, row):
        with self.db:
            changed = self.db.execute('DELETE FROM outbox WHERE sequence=? AND body=?', (row['sequence'], row['body'])).rowcount
            if changed:
                self.db.execute('UPDATE identity SET queued_rows=queued_rows-1,queued_bytes=queued_bytes-?', (len(row['body']),))

    def fail(self, row, code, retry_at, quarantine=False):
        with self.db:
            self.db.execute('UPDATE outbox SET attempts=attempts+1,http_status=?,retry_at=?,status=? WHERE sequence=?',
                            (code, retry_at, 'quarantined' if quarantine else 'pending', row['sequence']))

    def stats(self):
        return dict(self.db.execute('SELECT next_seq,queued_rows,queued_bytes FROM identity').fetchone())

    def close(self):
        self.db.close()
