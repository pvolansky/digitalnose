"""Explicit commands; nothing deploys, deletes data, or disables existing sync."""
import argparse
import json
import os
import signal
import sys
import threading

from .archive import verify
from .core import canonical, digest, now, record
from .export import CloudSource, TABLES, export_cloud, export_ens
from .integration import load_config, open_spool
from .remote import Supabase, upload_one
from .spool import Spool
from .worker import run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    device_health = commands.add_parser('device-health')
    device_health.add_argument('--config', required=True)
    validate = commands.add_parser('validate')
    for name in ('source-spool', 'archive-spool', 'config', 'sensor', 'start', 'end', 'output'):
        validate.add_argument('--' + name, required=True)
    worker = commands.add_parser('worker')
    worker.add_argument('--config', required=True)
    worker.add_argument('--sensor', required=True)
    ens = commands.add_parser('export-ens')
    ens.add_argument('--database', required=True)
    ens.add_argument('--device', required=True)
    ens.add_argument('--sensor', required=True)
    cloud = commands.add_parser('export-cloud')
    cloud.add_argument('--table', choices=list(TABLES), required=True)
    for name in ('scope', 'device', 'sensor', 'kind', 'start', 'end', 'boundary'):
        cloud.add_argument('--' + name, required=True)
    metadata = commands.add_parser('export-metadata')
    metadata.add_argument('--device', required=True)
    seal = commands.add_parser('seal')
    seal.add_argument('--before', required=True)
    commands.add_parser('upload')
    commands.add_parser('status')
    for command in (ens, cloud, metadata, seal, commands.choices['upload'], commands.choices['status']):
        command.add_argument('--spool', required=True)
        command.add_argument('--max-bytes', type=int, default=2*1024**3)
        command.add_argument('--min-free-bytes', type=int, default=2*1024**3)
    check = commands.add_parser('verify')
    check.add_argument('manifest')
    args = parser.parse_args()
    if args.command == 'device-health':
        from .device_health import report_once
        print(canonical(report_once(load_config(args.config), Supabase.environment())))
        return
    if args.command == 'validate':
        from .validate import compare
        report = compare(args.source_spool, args.archive_spool, load_config(args.config), args.sensor,
                         args.start, args.end, args.output)
        print(canonical(report))
        if not report['passed']:
            raise SystemExit(2)
        return
    if args.command == 'verify':
        from pathlib import Path
        path = Path(args.manifest)
        print(canonical({'verified_rows': len(verify(str(path).removesuffix('.manifest.json'), json.loads(path.read_text())))}))
        return
    if args.command == 'worker':
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())
        config = load_config(args.config)
        # One worker per sensor. Reuses established non-blocking advisory lock helper.
        from phase2.bus import file_lock
        from pathlib import Path
        root = Path(config['spool_root']) / args.sensor
        root.mkdir(parents=True, exist_ok=True)
        with file_lock(str(root / 'worker.lock'), timeout=0):
            run(config, args.sensor, stop)
        return
    spool = Spool(args.spool, args.max_bytes, args.min_free_bytes)
    try:
        if args.command == 'export-ens':
            print(canonical({'added': export_ens(args.database, spool, args.device, args.sensor)}))
        elif args.command in ('export-cloud', 'export-metadata'):
            source = CloudSource(os.environ['PHASE3_EXPORT_DSN'])
            try:
                if args.command == 'export-cloud':
                    count = export_cloud(source, spool, args.table, args.scope, args.device, args.sensor,
                                         args.kind, args.start, args.end, args.boundary)
                    print(canonical({'added': count}))
                else:
                    metadata = source.metadata(args.device)
                    captured = now()
                    for table, rows in metadata.items():
                        for row in rows:
                            spool.append(record(table, args.device, 'context', 'context',
                                                str(row['id']) + ':' + digest(row),
                                                row.get('updated_at', row['created_at']), row), retain=True)
                    spool.checkpoint('metadata_capture', {'captured_at': captured, 'device_id': args.device})
                    print(canonical({'metadata_rows': sum(map(len, metadata.values()))}))
            finally:
                source.close()
        elif args.command == 'seal':
            while spool.seal(args.before):
                pass
        elif args.command == 'upload':
            remote = Supabase.environment()
            while upload_one(spool, remote):
                pass
        elif args.command == 'status':
            print(canonical(spool.status()))
    finally:
        spool.close()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        print(canonical({'event': 'phase3_failed', 'error_type': type(exc).__name__}), file=sys.stderr)
        raise SystemExit(1)
