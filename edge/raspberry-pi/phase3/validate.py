"""Read-only comparison and restore rehearsal using a separate bounded scratch index."""
import json
import math
from pathlib import Path
import sqlite3

from .archive import atomic, verify
from .core import canonical, digest, eligible, minute, stamp
from .export import sqlite_readonly
from .summary import summarize


def physical_key(row):
    return canonical([row['device_id'], row['sensor_id'], row['observed_at'], row['sequence_number']])


def measured_content(row):
    original = json.loads(row['source_json'])
    return dict(readings=row['readings'], valid=row['valid'], status=row['status'],
                acquisition=original.get('acquisition', {}), metadata=original.get('metadata', {}),
                error_code=original.get('error_code') or None)


def close_enough(left, right):
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(close_enough(v, right[k]) for k, v in left.items())
    if type(left) in (float, int) and type(right) in (float, int):
        return math.isclose(left, right, rel_tol=1e-10, abs_tol=1e-8)
    return left == right


def compare(source_root, archive_root, config, key, start, end, output):
    """Source spool is an independently exported old cloud/ENS history.

    Scratch restore index intentionally persists for inspection; refuse to replace
    an existing index. Inputs are mode=ro and never run Spool initialization.
    """
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    index_path = output / 'restore-rehearsal.sqlite3'
    with index_path.open('xb'):
        pass
    db = sqlite3.connect(index_path)
    db.execute('PRAGMA max_page_count=262144')  # 1GiB with default 4KiB pages.
    db.execute('CREATE TABLE comparison(side TEXT,key TEXT,minute TEXT,content TEXT,record TEXT,PRIMARY KEY(side,key))')
    source = sqlite_readonly(Path(source_root)/'journal.sqlite3')
    archive = sqlite_readonly(Path(archive_root)/'journal.sqlite3')
    start, end = stamp(start), stamp(end)
    device, item = config['device_id'], config['sensors'][key]
    if start != minute(start) or end != minute(end) or start >= end:
        raise ValueError('Validation requires an increasing whole-minute interval')
    issues = []
    part_count = 0
    def add(side, row):
        if (row['device_id'], row['sensor_id']) != (device, item['sensor_id']):
            return
        if not start <= row['observed_at'] < end or not eligible(row['observed_at']) or row['valid'] is None:
            return
        identity, content = physical_key(row), canonical(measured_content(row))
        prior = db.execute('SELECT content FROM comparison WHERE side=? AND key=?', (side, identity)).fetchone()
        if prior and prior[0] != content:
            raise ValueError('Conflicting physical observation in validation input')
        db.execute('INSERT OR IGNORE INTO comparison VALUES(?,?,?,?,?)',
                   (side, identity, minute(row['observed_at']), content, canonical(row)))
    try:
        for row in source.execute('SELECT body FROM records WHERE device=? AND sensor=? AND minute>=? AND minute<?',
                                  (device, item['sensor_id'], start, end)):
            add('source', json.loads(row[0]))
        db.commit()
        for part in archive.execute('SELECT manifest,verified_at FROM parts'):
            manifest = json.loads(part[0])
            if manifest['end'] < start or manifest['start'] >= end or manifest['sensor_id'] != item['sensor_id']:
                continue
            if not part[1]:
                issues.append('part_not_remote_verified:' + manifest['canonical_sha256'])
            for row in verify(Path(archive_root)/manifest['object_key'], manifest):
                add('archive', row)
            db.commit()
            part_count += 1
        missing = db.execute("SELECT count(*) FROM comparison s LEFT JOIN comparison a ON a.side='archive' AND a.key=s.key WHERE s.side='source' AND a.key IS NULL").fetchone()[0]
        extra = db.execute("SELECT count(*) FROM comparison a LEFT JOIN comparison s ON s.side='source' AND a.key=s.key WHERE a.side='archive' AND s.key IS NULL").fetchone()[0]
        mismatches = db.execute("SELECT count(*) FROM comparison s JOIN comparison a ON a.side='archive' AND a.key=s.key WHERE s.side='source' AND s.content<>a.content").fetchone()[0]
        summary_count, summary_failures = 0, 0
        from datetime import timedelta
        from .core import instant
        cursor = start
        while cursor < end:
            if eligible(cursor):
                rows = [json.loads(r[0]) for r in db.execute("SELECT record FROM comparison WHERE side='source' AND minute=?", (cursor,))]
                expected = summarize(rows, device, item['sensor_id'], item['type'], cursor, item['interval_seconds'])
                actual = archive.execute('SELECT body FROM summaries WHERE device=? AND sensor=? AND minute=?',
                                         (device, item['sensor_id'], cursor)).fetchone()
                fields = ('metrics','expected_samples','observed_samples','valid_samples','invalid_samples',
                          'warmup_samples','error_samples','missing_samples','health')
                if not actual or not close_enough({k: expected[k] for k in fields},
                                                  {k: json.loads(actual[0])[k] for k in fields}):
                    summary_failures += 1
                summary_count += 1
            cursor = stamp(instant(cursor)+timedelta(minutes=1))
        counts = dict(db.execute('SELECT side,count(*) FROM comparison GROUP BY side'))
        report = dict(start=start, end=end, sensor_id=item['sensor_id'], parts_verified_locally=part_count,
                      counts=counts, missing_from_archive=missing, unexpected_in_archive=extra,
                      content_mismatches=mismatches, summary_minutes=summary_count,
                      summary_failures=summary_failures, issues=issues,
                      restored_records=counts.get('archive', 0),
                      passed=bool(counts.get('source')) and not (missing or extra or mismatches or summary_failures or issues),
                      scope='Restaurant-window counts/content/statistics only; service/reboot/queue acceptance requires live evidence')
        atomic(output/'validation.json', canonical(report).encode())
        return report
    finally:
        source.close(); archive.close(); db.close()
