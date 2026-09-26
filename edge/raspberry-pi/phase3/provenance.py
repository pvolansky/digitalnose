"""Non-secret immutable capture/build records and conservative host health."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

from . import VERSION
from .core import canonical, digest, now


def build_hash():
    base = Path(__file__).resolve().parent.parent
    files = sorted(list((base / 'phase3').glob('*.py')) + list((base / 'phase2').glob('*.py')))
    return digest({str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files})


def session(config, role='archive-publisher'):
    # Hash the supplied sensor configuration; do not persist its arbitrary content.
    packages = {}
    for name in ('adafruit-circuitpython-sgp41', 'bme690', 'sensirion-uart-sps30', 'smbus2', 'pyarrow'):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    boot = Path('/proc/sys/kernel/random/boot_id')
    return dict(session_id=str(uuid.uuid4()), started_at=now(), role=role,
                collector_version=VERSION, build_id=build_hash(), config_hash=digest(config),
                boot_id=boot.read_text().strip() if boot.exists() else None,
                driver_versions=packages, archive_schema_version=1,
                # Publisher provenance must never be misrepresented as acquisition provenance.
                acquisition_build_id=None)


def save_session(spool, data):
    spool.capacity(len(canonical(data).encode()) * 4 + 65536)
    with spool.db:
        spool.db.execute('INSERT INTO sessions VALUES(?,?)', (data['session_id'], canonical(data)))


def health(spool, session_id, started_monotonic, clock_synced=None):
    fs = os.statvfs(spool.root)
    used = 1 - fs.f_bavail / fs.f_blocks if fs.f_blocks else None
    status = spool.status()
    issues = []
    if used is None or clock_synced is None:
        issues.append('unknown_clock_or_storage')
    if clock_synced is False:
        issues.append('clock_unsynchronised')
    if used is not None and used >= .7:
        issues.append('storage_critical' if used >= .9 else 'storage_high')
    if fs.f_files and fs.f_favail / fs.f_files < .05:
        issues.append('inodes_low')
    if status['spool_bytes'] >= .8 * spool.max_bytes:
        issues.append('spool_high')
    failed = spool.db.execute('SELECT count(*) FROM parts WHERE last_error IS NOT NULL AND verified_at IS NULL').fetchone()[0]
    if failed:
        issues.append('archive_upload_failed')
    if status['oldest_unsynced_observation']:
        from .core import instant
        if (instant(now()) - instant(status['oldest_unsynced_observation'])).total_seconds() > 7200:
            issues.append('archive_backlog')
    return dict(observed_at=now(), session_id=session_id,
                health='degraded' if any(x != 'unknown_clock_or_storage' for x in issues) else ('unknown' if issues else 'normal'),
                issues=issues, disk_free_bytes=fs.f_bavail * fs.f_frsize,
                inode_free=fs.f_favail, disk_used_fraction=used, clock_synchronised=clock_synced,
                service_uptime_seconds=time.monotonic()-started_monotonic,
                collector_uptime_seconds=None, collector_restart_count=None,
                failed_upload_parts=failed, **status)


def clock_status():
    try:
        result = subprocess.run(['timedatectl', 'show', '-p', 'NTPSynchronized', '--value'],
                                capture_output=True, text=True, timeout=2, check=True)
        return {'yes': True, 'no': False}.get(result.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return None
