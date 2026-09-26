"""Bounded, content-addressed Parquet parts and durable local manifests."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import uuid

from .core import METRICS, canonical, digest, instant

MAX_ROWS = 3600
MAX_INPUT_BYTES = 16 * 1024 * 1024


def fsync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_mkdir(path):
    missing = []
    current = Path(path)
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700, exist_ok=True)
        fsync_dir(directory.parent)


def atomic(path, body):
    path = Path(path)
    durable_mkdir(path.parent)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.partial')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    fsync_dir(path.parent)


def schema():
    import pyarrow as pa
    required = ['record_id', 'source', 'device_id', 'sensor_id', 'sensor_type', 'identity', 'source_json']
    fields = [pa.field(k, pa.string(), nullable=False) for k in required]
    fields += [pa.field('observed_at', pa.timestamp('us', tz='UTC'), nullable=False),
               pa.field('received_at', pa.timestamp('us', tz='UTC')),
               pa.field('sequence_number', pa.int64()), pa.field('valid', pa.bool_()),
               pa.field('status', pa.string()), pa.field('session_id', pa.string()),
               pa.field('readings_json', pa.string(), nullable=False)]
    for key in sorted({k for keys in METRICS.values() for k in keys}):
        fields.append(pa.field(key, pa.int64() if key in ('tvoc_ppb', 'eco2_ppm', 'aqi', 'raw_voc_ticks', 'raw_nox_ticks') else pa.float64()))
    return pa.schema(fields, metadata={b'archive_schema': b'1', b'canonical_json': b'sorted-compact-v1'})


def _typed(row):
    result = {k: v for k, v in row.items() if k != 'readings'}
    result['observed_at'] = instant(row['observed_at'])
    result['received_at'] = instant(row['received_at']) if row['received_at'] else None
    result['readings_json'] = canonical(row['readings'])
    result.update(row['readings'])
    return result


def read_part(path):
    import pyarrow.parquet as pq
    # ParquetFile avoids Hive inference/collisions with path partition columns.
    table = pq.ParquetFile(path).read()
    if not table.schema.equals(schema(), check_metadata=True):
        raise ValueError('Archive schema mismatch')
    from .core import stamp
    rows = []
    for item in table.to_pylist():
        readings = json.loads(item.pop('readings_json'))
        for key in {k for keys in METRICS.values() for k in keys}:
            if item.pop(key) != readings.get(key):
                raise ValueError('Typed measurement differs from source')
        item['readings'] = readings
        item['observed_at'] = stamp(item['observed_at'])
        item['received_at'] = stamp(item['received_at']) if item['received_at'] else None
        rows.append(item)
    return rows


def sha_file(path):
    sha = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()


def describe(rows):
    seqs = [r['sequence_number'] for r in rows if r['sequence_number'] is not None]
    ids = sorted(r['identity'] for r in rows)
    domain_issues = Counter()
    for row in rows:
        if row['valid'] is True and row['status'] != 'ok':
            raise ValueError('Valid observation has non-normal status')
        for key, value in row['readings'].items():
            if value is None:
                domain_issues[key + ':null'] += 1
                continue
            okay = (value >= -273.15 if key.endswith('temperature_c') else
                    0 <= value <= 100 if key.endswith('humidity_pct') else
                    0 <= value <= 65535 and int(value) == value if key.startswith('raw_') else
                    1 <= value <= 5 and int(value) == value if key == 'aqi' else value >= 0)
            if not okay:
                domain_issues[key + ':outside_physical_domain'] += 1
    return dict(row_count=len(rows), start=min(r['observed_at'] for r in rows),
                end=max(r['observed_at'] for r in rows), identity_first=ids[0], identity_last=ids[-1],
                identity_digest=digest(sorted(r['record_id'] for r in rows)),
                sequence_min=min(seqs) if seqs else None, sequence_max=max(seqs) if seqs else None,
                validity_counts=dict(Counter(str(r['valid']) for r in rows)),
                status_counts=dict(Counter(str(r['status']) for r in rows)),
                domain_issues=dict(domain_issues),
                session_ids=sorted({r['session_id'] for r in rows if r['session_id']}),
                canonical_sha256=digest(rows))


def verify(path, manifest):
    if sha_file(path) != manifest['sha256']:
        raise ValueError('Archive checksum mismatch')
    rows = read_part(path)
    if not rows or len({r['record_id'] for r in rows}) != len(rows):
        raise ValueError('Empty part or duplicate source identity')
    for key, value in describe(rows).items():
        if manifest[key] != value:
            raise ValueError('Archive manifest mismatch: ' + key)
    return rows


def write_part(root, rows):
    import pyarrow as pa
    import pyarrow.parquet as pq
    rows = sorted(rows, key=lambda r: (r['observed_at'], r['record_id']))
    if not 1 <= len(rows) <= MAX_ROWS or len(canonical(rows).encode()) > MAX_INPUT_BYTES:
        raise ValueError('Part exceeds bounded input budget')
    first = rows[0]
    partition = lambda r: (r['source'], r['device_id'], r['sensor_id'], r['sensor_type'], r['observed_at'][:13])
    if any(partition(r) != partition(first) for r in rows):
        raise ValueError('Part must contain one source/sensor/UTC hour')
    if len({r['record_id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate source identity')
    content = digest(rows)
    key = (f"raw/schema=v1/device={first['device_id']}/sensor_type={first['sensor_type']}/"
           f"sensor={first['sensor_id']}/source={first['source']}/date={first['observed_at'][:10]}/"
           f"hour={first['observed_at'][11:13]}/part-{content}.parquet")
    path = Path(root) / key
    durable_mkdir(path.parent)
    if not path.exists():
        tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.partial')
        table = pa.Table.from_pylist([_typed(r) for r in rows], schema=schema())
        pq.write_table(table, tmp, compression='zstd', compression_level=6,
                       version='2.6', coerce_timestamps='us', allow_truncated_timestamps=False)
        with tmp.open('rb') as stream:
            os.fsync(stream.fileno())
        if read_part(tmp) != rows:
            raise ValueError('Parquet round-trip changed source records')
        os.replace(tmp, path)
        fsync_dir(path.parent)
    manifest = dict(schema_version=1, source_table=first['source'], device_id=first['device_id'],
                    sensor_id=first['sensor_id'], sensor_type=first['sensor_type'], object_key=key,
                    sha256=sha_file(path), bytes=path.stat().st_size, **describe(rows))
    # Handles a crash after Parquet rename but before manifest publication.
    verify(path, manifest)
    atomic(str(path) + '.manifest.json', canonical(manifest).encode())
    return manifest
