"""Phase IIIA preservation tests: only synthetic data and temporary directories."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from phase2.model import Observation
from phase2.outbox import Outbox
from phase2.publish import sync_once
from phase3.archive import read_part, verify, write_part
from phase3.core import canonical, eligible, ens_record, minute, phase2_record, stamp
from phase3.export import CloudSource, TABLES, export_cloud, export_ens, no_secrets
from phase3.provenance import health, save_session, session
from phase3.remote import Supabase, publish_summary, upload_one
from phase3.spool import Spool, SpoolFull
from phase3.summary import summarize
from phase3.worker import summarize_due

HAS_ARROW = importlib.util.find_spec('pyarrow') is not None
DEVICE = '00000000-0000-4000-8000-000000000001'
SENSOR = '00000000-0000-4000-8000-000000000002'


def observation(seq=1, at='2026-09-24T10:00:00.123456Z', value=80, status='ok'):
    payload = Observation({'raw_voc_ticks': value, 'raw_nox_ticks': 16000},
                          status, status == 'ok', observed_at=at,
                          metadata={'compensation_source': 'bme690_01'},
                          error_code='read_failed' if status == 'error' else '').payload('test_device', 'sgp41_01', 'sgp41', seq)
    return phase2_record(payload, DEVICE, SENSOR)


class MemoryRemote:
    def __init__(self):
        self.objects = {}
        self.fail = None
    def put(self, key, body):
        if self.fail == 'network':
            raise TimeoutError()
        if self.fail == 'partial':
            self.objects[key] = body[:10]
            raise OSError()
        if key in self.objects and self.objects[key] != body:
            raise ValueError('Immutable object conflict')
        self.objects[key] = body
    def get(self, key):
        if self.fail == 'corrupt':
            return b'corrupt'
        return self.objects[key]
    def rpc(self, name, payload):
        if self.fail:
            raise TimeoutError()
        return b'{"ok":true}'


class Schedule(unittest.TestCase):
    def test_boundaries_and_dst(self):
        for date, offset in [('2026-01-01', 0), ('2026-07-01', 1),
                             ('2026-03-29', 1), ('2026-10-25', 0)]:
            start = datetime.fromisoformat(date).replace(hour=10-offset, tzinfo=timezone.utc)
            end = start + timedelta(hours=13, minutes=55)
            self.assertFalse(eligible(start-timedelta(microseconds=1)))
            self.assertTrue(eligible(start))
            self.assertTrue(eligible(end-timedelta(microseconds=1)))
            self.assertFalse(eligible(end))

    def test_extended_evening_boundary(self):
        self.assertTrue(eligible('2026-09-25T22:54:59.999999Z'))
        self.assertFalse(eligible('2026-09-25T22:55:00Z'))

    def test_naive_timestamp_rejected(self):
        with self.assertRaises(ValueError):
            eligible('2026-09-24T10:00:00')


class Summaries(unittest.TestCase):
    def test_spike_m2_extrema_first_last_and_missing(self):
        values = [80, 82, 91, 700, 110, 85]
        rows = [observation(i+1, f'2026-09-24T10:00:{i:02d}.123456Z', x) for i, x in enumerate(values)]
        result = summarize(rows[::-1], DEVICE, SENSOR, 'sgp41', rows[0]['observed_at'], 1)
        metric = result['metrics']['raw_voc_ticks']
        self.assertEqual(metric['min'], 80)
        self.assertEqual(metric['max'], 700)
        self.assertEqual(metric['max_at'], rows[3]['observed_at'])
        self.assertAlmostEqual(metric['mean'], sum(values)/6)
        self.assertAlmostEqual(metric['m2'], sum((v-sum(values)/6)**2 for v in values))
        self.assertEqual((metric['first'], metric['last']), (80, 85))
        self.assertEqual(result['missing_samples'], 54)
        self.assertEqual(result['health'], 'degraded')

    def test_ens_zero_and_validity(self):
        rows = [ens_record(dict(id=i+1, recorded_at_utc=f'2026-09-24T10:00:{i*5:02d}Z',
                                tvoc_ppb=0, eco2_ppm=400, aqi=1, sensor_status=i), DEVICE, SENSOR) for i in range(4)]
        result = summarize(rows, DEVICE, SENSOR, 'ens160', rows[0]['observed_at'], 5)
        self.assertEqual(result['valid_samples'], 1)
        self.assertEqual(result['warmup_samples'], 2)
        self.assertEqual(result['invalid_samples'], 1)
        self.assertEqual(result['metrics']['tvoc_ppb']['mean'], 0)
        self.assertNotIn('clean', canonical(result))

    def test_invalid_and_error_values_excluded(self):
        rows = [observation(), observation(2, value=500, status='error'), observation(3, value=900, status='invalid')]
        result = summarize(rows, DEVICE, SENSOR, 'sgp41', rows[0]['observed_at'], 1)
        self.assertEqual(result['metrics']['raw_voc_ticks']['max'], 80)
        self.assertEqual(result['error_samples'], 1)
        self.assertEqual(result['invalid_samples'], 1)
        self.assertEqual(result['missing_samples'], 59)  # Same occupied cadence slot.

    def test_missing_sensor_is_unknown_not_zero(self):
        result = summarize([], DEVICE, SENSOR, 'sgp41', '2026-09-24T01:00:00Z', 1)
        self.assertEqual(result['health'], 'unknown')
        self.assertEqual(result['missing_samples'], 60)
        self.assertIsNone(result['metrics']['raw_voc_ticks'])
        self.assertIsNone(result['provenance']['attempted_samples'])

    def test_duplicate_identity_rejected(self):
        with self.assertRaises(ValueError):
            summarize([observation(), observation()], DEVICE, SENSOR, 'sgp41', '2026-09-24T10:00:00Z', 1)


class SpoolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.spool = Spool(self.temp.name, min_free_bytes=0)
    def tearDown(self):
        self.spool.close()
        self.temp.cleanup()

    def test_restart_idempotency_and_conflict(self):
        self.assertTrue(self.spool.append(observation()))
        self.spool.close()
        self.spool = Spool(self.temp.name, min_free_bytes=0)
        self.assertFalse(self.spool.append(observation()))
        with self.assertRaises(ValueError):
            self.spool.append(observation(value=99))
        self.assertEqual(len(self.spool.rows(DEVICE, SENSOR, '2026-09-24T10:00:00Z')), 1)

    def test_after_close_upload_eligibility_uses_observation(self):
        self.spool.append(observation(at='2026-09-24T22:54:59.999999Z'))
        self.spool.append(observation(2, at='2026-09-24T22:55:00.000000Z'))
        self.assertEqual([r[0] for r in self.spool.db.execute('SELECT eligible FROM records ORDER BY minute')], [1, 0])

    def test_disk_limit_does_not_drop_prior_rows(self):
        self.spool.append(observation())
        self.spool.max_bytes = self.spool.usage()
        with self.assertRaises(SpoolFull):
            self.spool.append(observation(2))
        self.assertEqual(self.spool.db.execute('SELECT count(*) FROM records').fetchone()[0], 1)

    def test_health_clock_backlog_restart(self):
        self.spool.append(observation(at='2020-01-01T12:00:00.000000Z'))
        first, second = session({}), session({})
        self.assertNotEqual(first['session_id'], second['session_id'])
        self.assertEqual(first['build_id'], second['build_id'])
        report = health(self.spool, second['session_id'], time.monotonic(), False)
        self.assertEqual(report['health'], 'degraded')
        self.assertIn('clock_unsynchronised', report['issues'])
        self.assertIn('archive_backlog', report['issues'])
        self.assertIsNone(report['collector_restart_count'])

    def test_late_delivery_rebuilds_old_minute(self):
        config = dict(device_id=DEVICE, coverage_start='2026-09-24T10:00:00Z',
                      sensors={'sgp': dict(sensor_id=SENSOR, type='sgp41', interval_seconds=1)})
        summarize_due(self.spool, config, 'sgp', '2026-09-24T10:03:00Z')
        self.spool.append(observation())
        summarize_due(self.spool, config, 'sgp', '2026-09-24T10:03:00Z')
        row = self.spool.db.execute('SELECT * FROM summaries ORDER BY minute LIMIT 1').fetchone()
        self.assertEqual(row['revision'], 2)
        self.assertEqual(json.loads(row['body'])['valid_samples'], 1)
        self.assertEqual(self.spool.db.execute('SELECT count(*) FROM summaries').fetchone()[0], 3)
        remote = MemoryRemote()
        remote.fail = 'network'
        with self.assertRaises(TimeoutError):
            publish_summary(self.spool, remote)
        self.assertEqual(self.spool.db.execute('SELECT max(published_revision) FROM summaries').fetchone()[0], 0)
        remote.fail = None
        self.assertTrue(publish_summary(self.spool, remote))

    @unittest.skipUnless(HAS_ARROW, 'Install phase3 requirements to exercise Parquet')
    def test_raw_roundtrip_manifest_and_duplicate_retry(self):
        for row in (observation(), observation(2, status='error')):
            self.spool.append(row)
        manifest = self.spool.seal('2026-09-24T11:00:00Z')
        rows = verify(self.spool.root / manifest['object_key'], manifest)
        self.assertEqual({r['source_json'] for r in rows}, {observation()['source_json'], observation(2, status='error')['source_json']})
        self.assertEqual(rows[0]['observed_at'], '2026-09-24T10:00:00.123456Z')
        self.assertEqual(manifest['sequence_max'], 2)
        self.assertEqual(manifest['validity_counts'], {'True': 1, 'False': 1})
        self.assertEqual(write_part(self.spool.root, rows)['object_key'], manifest['object_key'])
        remote = MemoryRemote()
        self.assertTrue(upload_one(self.spool, remote))
        self.assertFalse(upload_one(self.spool, remote))
        self.assertEqual(self.spool.status()['unsynced_observations'], 0)
        self.assertEqual(self.spool.db.execute('SELECT count(*) FROM records').fetchone()[0], 2)

    @unittest.skipUnless(HAS_ARROW, 'Install phase3 requirements')
    def test_remote_corruption_network_and_interrupted_upload(self):
        self.spool.append(observation())
        self.spool.seal('2026-09-24T11:00:00Z')
        for failure in ('network', 'partial', 'corrupt'):
            remote = MemoryRemote(); remote.fail = failure
            with self.assertRaises((ValueError, OSError)):
                upload_one(self.spool, remote)
            self.assertEqual(self.spool.status()['pending_parts'], 1)
        remote = MemoryRemote()
        # Crash after remote bytes exist but before local acknowledgement.
        class InterruptAfterGet(MemoryRemote):
            def get(self, key):
                if key.endswith('.manifest.json'):
                    raise KeyboardInterrupt()
                return super().get(key)
        interrupted = InterruptAfterGet()
        with self.assertRaises(KeyboardInterrupt):
            upload_one(self.spool, interrupted)
        remote.objects = interrupted.objects
        upload_one(self.spool, remote)
        self.assertEqual(self.spool.status()['pending_parts'], 0)

    @unittest.skipUnless(HAS_ARROW, 'Install phase3 requirements')
    def test_crash_during_chunk_and_restart(self):
        self.spool.append(observation())
        with patch('phase3.archive.os.replace', side_effect=OSError('power loss')):
            with self.assertRaises(OSError):
                self.spool.seal('2026-09-24T11:00:00Z')
        self.assertEqual(self.spool.status()['unsynced_observations'], 1)
        self.assertTrue(list(self.spool.root.rglob('*.partial')))
        self.spool.close()
        self.spool = Spool(self.temp.name, min_free_bytes=0)
        manifest = self.spool.seal('2026-09-24T11:00:00Z')
        self.assertEqual(len(verify(self.spool.root / manifest['object_key'], manifest)), 1)

    @unittest.skipUnless(HAS_ARROW, 'Install phase3 requirements')
    def test_crash_after_parquet_before_manifest(self):
        self.spool.append(observation())
        with patch('phase3.archive.atomic', side_effect=OSError('interrupted manifest')):
            with self.assertRaises(OSError):
                self.spool.seal('2026-09-24T11:00:00Z')
        self.assertEqual(len(list(self.spool.root.rglob('*.parquet'))), 1)
        self.spool.seal('2026-09-24T11:00:00Z')
        self.assertEqual(len(list(self.spool.root.rglob('*.parquet'))), 1)

    @unittest.skipUnless(HAS_ARROW, 'Install phase3 requirements')
    def test_local_corruption_fails_verification(self):
        self.spool.append(observation())
        manifest = self.spool.seal('2026-09-24T11:00:00Z')
        path = self.spool.root / manifest['object_key']
        path.write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            verify(path, manifest)

    def test_mirror_failure_keeps_original_queue_and_does_not_send(self):
        box = Outbox(Path(self.temp.name)/'old.sqlite3', 'test_device', 'sgp41_01', 'sgp41')
        box.enqueue(Observation({'raw_voc_ticks': 80, 'raw_nox_ticks': 16000}))
        calls = []
        def failed(_):
            raise SpoolFull()
        with self.assertRaises(SpoolFull):
            sync_once(box, '', '', 0, sender=lambda *a: calls.append(a), preserve=failed)
        self.assertEqual(box.stats()['queued_rows'], 1)
        self.assertEqual(calls, [])
        sync_once(box, '', '', 0, sender=lambda *a: (200, {'ok': True, 'result': 'accepted'}),
                  preserve=lambda body: self.spool.append(phase2_record(json.loads(body), DEVICE, SENSOR)))
        self.assertEqual(box.stats()['queued_rows'], 0)
        self.assertEqual(self.spool.db.execute('SELECT count(*) FROM records').fetchone()[0], 1)
        box.close()


class ExportTests(unittest.TestCase):
    def test_ens_export_does_not_modify_live_database(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'ens.db'
            db = sqlite3.connect(path)
            db.executescript('''CREATE TABLE sensor_readings(id INTEGER PRIMARY KEY,recorded_at_utc TEXT,tvoc_ppb INTEGER,eco2_ppm INTEGER,aqi INTEGER,sensor_status INTEGER);
              CREATE TABLE minute_aggregates(minute_start_utc TEXT PRIMARY KEY,tvoc_mean REAL,tvoc_min INTEGER,tvoc_max INTEGER,eco2_mean REAL,eco2_min INTEGER,eco2_max INTEGER,aqi_max INTEGER,sample_count INTEGER);
              INSERT INTO sensor_readings VALUES(1,'2026-09-24T01:00:00.123456Z',0,400,1,0);
              INSERT INTO minute_aggregates VALUES('2026-09-24T01:00:00Z',0,0,0,400,400,400,1,1);''')
            db.close()
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            spool = Spool(Path(root)/'spool', min_free_bytes=0)
            try:
                self.assertEqual(export_ens(path, spool, DEVICE, SENSOR), 1)
                self.assertEqual(export_ens(path, spool, DEVICE, SENSOR), 0)
                self.assertEqual(spool.db.execute('SELECT count(*) FROM records WHERE eligible=1').fetchone()[0], 2)
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
            finally:
                spool.close()

    def test_query_bounds_and_secret_projection(self):
        source = CloudSource.__new__(CloudSource)
        calls = []
        source.query = lambda sql, params: calls.append((sql, params)) or []
        source.page('sensor_observations', SENSOR, 'start', 'end', 'boundary', ('cursor', 5))
        sql, params = calls[0]
        self.assertIn('(observed_at,sequence_number) > (%s,%s)', sql)
        self.assertIn('received_at <= %s', sql)
        self.assertIn('LIMIT %s', sql)
        self.assertEqual(params[-1], 1000)
        self.assertNotIn('user_id', TABLES['smell_reports']['columns'])
        self.assertNotIn('note', TABLES['smell_reports']['columns'])
        for value in ({'api_key': 'hidden'}, {'nested': {'password': 'hidden'}}):
            with self.assertRaises(ValueError):
                no_secrets(value)
        with self.assertRaises(KeyError):
            source.page('device_api_keys', '', '', '', '')

    def test_remote_requires_https(self):
        for url in ('http://example.com', 'https://user@example.com', 'https://example.com/?token=x'):
            with self.assertRaises(ValueError):
                Supabase(url, 'key', 'token')


@unittest.skipUnless(HAS_ARROW, 'Install phase3 requirements')
class Validation(unittest.TestCase):
    def test_restore_rehearsal_and_compare_detects_loss(self):
        from phase3.validate import compare
        with tempfile.TemporaryDirectory() as root:
            source = Spool(Path(root)/'source', min_free_bytes=0)
            archive = Spool(Path(root)/'archive', min_free_bytes=0)
            config = dict(device_id=DEVICE, coverage_start='2026-09-24T10:00:00Z',
                          sensors={'sgp': dict(sensor_id=SENSOR, type='sgp41', interval_seconds=1)})
            try:
                source.append(observation()); archive.append(observation())
                summarize_due(archive, config, 'sgp', '2026-09-24T10:01:00Z')
                archive.seal('2026-09-24T11:00:00Z')
                upload_one(archive, MemoryRemote())
                report = compare(source.root, archive.root, config, 'sgp',
                                 '2026-09-24T10:00:00Z', '2026-09-24T10:01:00Z', Path(root)/'pass')
                self.assertTrue(report['passed'])
                self.assertEqual(report['restored_records'], 1)
                source.append(observation(2, at='2026-09-24T10:00:01.000000Z'))
                report = compare(source.root, archive.root, config, 'sgp',
                                 '2026-09-24T10:00:00Z', '2026-09-24T10:01:00Z', Path(root)/'fail')
                self.assertFalse(report['passed'])
                self.assertEqual(report['missing_from_archive'], 1)
                self.assertEqual(report['summary_failures'], 1)
            finally:
                source.close(); archive.close()

    def test_cloud_paging_same_timestamp_and_late_arrival(self):
        with tempfile.TemporaryDirectory() as root:
            spool = Spool(root, min_free_bytes=0)
            rows = []
            for i in (1, 2):
                p = json.loads(observation(i)['source_json'])
                rows.append(dict(id=str(i), sensor_id=SENSOR, received_at='2026-09-24T11:00:00Z',
                                 **{k: p[k] for k in ('sensor_type','observed_at','sequence_number','status','valid','readings','acquisition','metadata')}))
            class Source:
                def page(self, table, scope, start, end, boundary, cursor):
                    return [r for r in rows if cursor is None or (r['observed_at'], r['sequence_number']) > cursor][:1]
            try:
                args = (Source(), spool, 'sensor_observations', SENSOR, DEVICE, SENSOR, 'sgp41',
                        '2026-09-24T10:00:00Z','2026-09-24T11:00:00Z','2026-09-24T12:00:00Z')
                self.assertEqual(export_cloud(*args), 2)
                self.assertEqual(export_cloud(*args), 0)
                rows.append({**rows[0], 'id': 'late', 'sequence_number': 3})
                self.assertEqual(export_cloud(*args), 1)
                self.assertEqual(spool.db.execute('SELECT count(*) FROM records').fetchone()[0], 3)
            finally:
                spool.close()


class AuthAndHealth(unittest.TestCase):
    def test_readonly_pending_copy_includes_quarantine_without_ack(self):
        from phase3.integration import copy_pending
        with tempfile.TemporaryDirectory() as root:
            old = Path(root)/'old'; old.mkdir()
            box = Outbox(old/'sgp41_01.sqlite3', 'test_device', 'sgp41_01', 'sgp41')
            box.enqueue(Observation({'raw_voc_ticks': 80, 'raw_nox_ticks': 16000},
                                    observed_at='2026-09-24T10:00:00.000000Z'))
            box.fail(box.next(0), 422, 0, quarantine=True)
            spool = Spool(Path(root)/'spool', min_free_bytes=0)
            config = dict(device_id=DEVICE, phase2_state_dir=str(old), sensors={
                'sgp41_01': dict(sensor_id=SENSOR, type='sgp41', interval_seconds=1)})
            try:
                self.assertEqual(copy_pending(config, 'sgp41_01', spool, None), 1)
                self.assertEqual(copy_pending(config, 'sgp41_01', spool, None), 0)
                self.assertEqual(box.stats()['queued_rows'], 1)
                self.assertEqual(box.db.execute('SELECT status FROM outbox').fetchone()[0], 'quarantined')
            finally:
                box.close(); spool.close()

    def test_refresh_persists_private_rotated_token(self):
        from phase3.auth import access_token
        import io
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'session.json'
            path.write_text(json.dumps(dict(access_token='old', refresh_token='old-refresh', expires_at=0)))
            path.chmod(0o600)
            class Opener:
                def open(self, req, timeout):
                    return io.BytesIO(b'{"access_token":"new","refresh_token":"new-refresh","expires_in":3600}')
            self.assertEqual(access_token(path, 'https://example.invalid', 'public', Opener()), 'new')
            self.assertEqual(json.loads(path.read_text())['refresh_token'], 'new-refresh')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(access_token(path, 'https://example.invalid', 'public', None), 'new')

    def test_disk_near_limit_health(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as root:
            spool = Spool(root, min_free_bytes=0)
            try:
                fs = SimpleNamespace(f_bavail=5, f_blocks=100, f_frsize=4096, f_files=100, f_favail=3)
                with patch('phase3.provenance.os.statvfs', return_value=fs):
                    report = health(spool, 'session', time.monotonic(), True)
                self.assertIn('storage_critical', report['issues'])
                self.assertIn('inodes_low', report['issues'])
                self.assertEqual(report['health'], 'degraded')
            finally:
                spool.close()


if __name__ == '__main__':
    unittest.main()
