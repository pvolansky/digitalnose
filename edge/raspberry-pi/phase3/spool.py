"""Durable bounded parallel journal. This milestone deliberately has no expiry code."""
import json
import os
from pathlib import Path
import sqlite3

from .archive import MAX_INPUT_BYTES, durable_mkdir, write_part
from .core import canonical, eligible, minute, now


class SpoolFull(OSError):
    pass


class Spool:
    def __init__(self, root, max_bytes=2 * 1024**3, min_free_bytes=2 * 1024**3):
        self.root = Path(root)
        durable_mkdir(self.root)
        self.max_bytes, self.min_free_bytes = max_bytes, min_free_bytes
        self.db = sqlite3.connect(self.root / 'journal.sqlite3', timeout=2)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=DELETE')
        self.db.execute('PRAGMA synchronous=FULL')
        # Leave three quarters of the budget for journals, Parquet and manifests.
        page_size = self.db.execute('PRAGMA page_size').fetchone()[0]
        self.db.execute('PRAGMA max_page_count=%d' % max(32, max_bytes // 4 // page_size))
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS records(
            id TEXT PRIMARY KEY, device TEXT NOT NULL, sensor TEXT NOT NULL, kind TEXT NOT NULL,
            minute TEXT NOT NULL, body TEXT NOT NULL, eligible INTEGER NOT NULL,
            part_key TEXT, inserted_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS records_minute ON records(device,sensor,minute);
          CREATE INDEX IF NOT EXISTS records_pending ON records(eligible,part_key,minute);
          CREATE TABLE IF NOT EXISTS parts(key TEXT PRIMARY KEY, manifest TEXT NOT NULL,
            verified_at TEXT, last_error TEXT, attempts INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS summaries(device TEXT,sensor TEXT,minute TEXT,
            revision INTEGER NOT NULL, body TEXT NOT NULL, published_revision INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(device,sensor,minute));
          CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS checkpoints(name TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS dirty(device TEXT,sensor TEXT,minute TEXT,generation INTEGER NOT NULL,
            PRIMARY KEY(device,sensor,minute));
          CREATE TABLE IF NOT EXISTS health(id TEXT PRIMARY KEY,body TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 0);
        ''')

    def close(self):
        self.db.close()

    def usage(self):
        # Includes partials, manifests and SQLite journals, not just payload bytes.
        return sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file())

    def capacity(self, extra):
        fs = os.statvfs(self.root)
        if (self.usage() + extra > self.max_bytes or fs.f_bavail * fs.f_frsize < self.min_free_bytes + extra
                or (fs.f_files and fs.f_favail / fs.f_files < 0.05)):
            raise SpoolFull('Archive storage budget exhausted; old outbox must remain unacknowledged')

    def append(self, row, retain=None):
        body = canonical(row)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            previous = self.db.execute('SELECT body FROM records WHERE id=?', (row['record_id'],)).fetchone()
            if previous:
                # Session belongs to first capture, not a retry after publisher restart.
                before, after = json.loads(previous[0]), dict(row)
                before.pop('session_id'); after.pop('session_id')
                if before != after:
                    raise ValueError('Conflicting archive identity')
                return False
            self.capacity(len(body.encode()) * 4 + 65536)
            self.db.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?,NULL,?)',
                            (row['record_id'], row['device_id'], row['sensor_id'], row['sensor_type'],
                             minute(row['observed_at']), body,
                             int(eligible(row['observed_at']) if retain is None else retain), now()))
            self.db.execute('''INSERT INTO dirty VALUES(?,?,?,1) ON CONFLICT(device,sensor,minute)
              DO UPDATE SET generation=dirty.generation+1''',
                            (row['device_id'], row['sensor_id'], minute(row['observed_at'])))
        return True

    def checkpoint(self, name, value=None):
        if value is None:
            row = self.db.execute('SELECT value FROM checkpoints WHERE name=?', (name,)).fetchone()
            return json.loads(row[0]) if row else None
        with self.db:
            self.db.execute('INSERT INTO checkpoints VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value',
                            (name, canonical(value)))

    def seal(self, before, limit=3600):
        if not 1 <= limit <= 3600:
            raise ValueError('Invalid chunk row limit')
        pending = self.db.execute('''SELECT * FROM records WHERE eligible=1 AND part_key IS NULL
          AND minute<? ORDER BY minute,id LIMIT ?''', (minute(before), limit)).fetchall()
        if not pending:
            return None
        first = json.loads(pending[0]['body'])
        partition = lambda r: (r['device_id'], r['sensor_id'], r['source'], r['observed_at'][:13])
        batch, size = [], 0
        for entry in pending:
            row = json.loads(entry['body'])
            if partition(row) != partition(first):
                continue
            length = len(entry['body'].encode()) + 1
            if size + length + 2 > MAX_INPUT_BYTES:
                break
            batch.append(row); size += length
        self.capacity(size * 2 + 131072)
        manifest = write_part(self.root, batch)
        # Files fsynced first. A crash before this commit replays identical content IDs.
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO parts(key,manifest) VALUES(?,?)',
                            (manifest['object_key'], canonical(manifest)))
            self.db.executemany('UPDATE records SET part_key=? WHERE id=?',
                                [(manifest['object_key'], r['record_id']) for r in batch])
        return manifest

    def rows(self, device, sensor, start):
        return [json.loads(r[0]) for r in self.db.execute(
            'SELECT body FROM records WHERE device=? AND sensor=? AND minute=? ORDER BY id',
            (device, sensor, minute(start)))]

    def save_summary(self, summary):
        body = canonical(summary)
        key = (summary['device_id'], summary['sensor_id'], summary['minute_start'])
        self.capacity(len(body.encode()) * 4 + 65536)
        with self.db:
            self.db.execute('''INSERT INTO summaries(device,sensor,minute,revision,body) VALUES(?,?,?,1,?)
              ON CONFLICT(device,sensor,minute) DO UPDATE SET body=excluded.body,revision=summaries.revision+1
              WHERE summaries.body<>excluded.body''', (*key, body))

    def status(self):
        row = self.db.execute('''SELECT count(*),min(minute) FROM records
          WHERE eligible=1 AND (part_key IS NULL OR part_key IN (SELECT key FROM parts WHERE verified_at IS NULL))''').fetchone()
        return dict(unsynced_observations=row[0], oldest_unsynced_observation=row[1],
                    pending_parts=self.db.execute('SELECT count(*) FROM parts WHERE verified_at IS NULL').fetchone()[0],
                    spool_bytes=self.usage(), spool_budget_bytes=self.max_bytes,
                    automatic_expiry=False)
