"""Local SQLite contention regressions; all databases and observations are temporary."""
from contextlib import nullcontext
import os
import json
import multiprocessing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from phase2.outbox import Outbox, read_queue_status
from phase2.model import Observation, FIELDS
from phase2.runtime import collect, deadline
from phase2.drivers import Hardware, SGP41Driver
from phase2.publish import sync_once
from test_phase2 import FakeSGP, SimulatedClock


SENSORS = [('bme690_01', 'bme690'), ('bme690_02', 'bme690'),
           ('sgp41_01', 'sgp41'), ('sps30_01', 'sps30')]


def stress_worker(root, key, kind, role, barrier, results, count):
    """Separate OS processes use real acquisition/publisher loops, with fake I/O."""
    import phase2.runtime as runtime
    path = Path(root)/(key+'.sqlite3')
    stats = {'key': key, 'role': role, 'busy': 0, 'max_status_ms': 0}
    stop = threading.Event()
    try:
        box = None if role == 'status' else Outbox(path, 'collector', key, kind)
        barrier.wait(timeout=15)
        if role == 'acquire':
            class Driver:
                calls = 0
                def read(self):
                    self.calls += 1
                    if self.calls == count:
                        stop.set()
                    return Observation(dict.fromkeys(FIELDS[kind], 25))
                def close(self):
                    pass
            config = {'state_dir': root, 'sensors': {key: {'type': kind, 'interval_seconds': 0.01}}}
            with patch.object(runtime, 'log'):
                collect(config, key, Driver(), box, stop)
        elif role == 'publish':
            delivered = []
            def sender(url, credential, body):
                payload = json.loads(body)
                delivered.append(payload['sequence_number'])
                if payload['sequence_number'] == count:
                    stop.set()
                return 200, {'ok': True, 'result': 'accepted'}
            def local_sync(box, url, credential, now):
                return sync_once(box, url, credential, now, sender=sender)
            with patch.object(runtime, 'sync_once', local_sync), patch.object(runtime, 'log'):
                runtime.publish({'sensors': {key: {'type': kind}}}, key, box, '', '', stop)
            stats['delivered'] = delivered
        else:
            for _ in range(100):
                started = time.monotonic()
                try:
                    read_queue_status(path, 'collector', key, kind)
                except sqlite3.OperationalError:
                    stats['busy'] += 1
                stats['max_status_ms'] = max(stats['max_status_ms'], (time.monotonic()-started)*1000)
                time.sleep(0.003)
        results.put(stats)
    except BaseException as exc:
        results.put({**stats, 'error': repr(exc)})
        raise


class Phase2Storage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = self.root/'queue #1?.sqlite3'
        self.box = Outbox(self.path, 'collector', 'bme690_01', 'bme690')

    def tearDown(self):
        self.box.close()
        self.tmp.cleanup()

    def status(self):
        return read_queue_status(self.path, 'collector', 'bme690_01', 'bme690')

    def test_current_journal_durability_and_timeout(self):
        self.assertEqual(self.box.db.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
        self.assertEqual(self.box.db.execute('PRAGMA synchronous').fetchone()[0], 2)
        self.assertEqual(self.box.db.execute('PRAGMA busy_timeout').fetchone()[0], 2000)

    def test_status_has_no_writes_or_initialization_and_preserves_bytes(self):
        self.box.enqueue(Observation({'gas_resistance_ohm': 42}))
        original_bytes = self.path.read_bytes()
        statements = []
        connect = sqlite3.connect
        def traced(*args, **kwargs):
            self.assertTrue(args[0].endswith('?mode=ro'))
            self.assertTrue(kwargs['uri'])
            self.assertIsNone(kwargs['isolation_level'])
            db = connect(*args, **kwargs)
            db.set_trace_callback(statements.append)
            return db
        with patch('phase2.outbox.sqlite3.connect', traced):
            self.assertEqual(self.status(), self.box.stats())
        self.assertEqual(len(statements), 2)
        self.assertEqual(statements[0], 'PRAGMA query_only=ON')
        self.assertTrue(statements[1].startswith('SELECT'))
        self.assertEqual(self.path.read_bytes(), original_bytes)
        self.box.db.execute('BEGIN EXCLUSIVE')  # Reader released its lock.
        self.box.db.rollback()

    def test_status_reads_committed_snapshot_while_writer_reserved(self):
        self.box.db.execute('BEGIN IMMEDIATE')
        self.box.db.execute('UPDATE identity SET next_seq=99')
        try:
            self.assertEqual(self.status()['next_seq'], 1)
        finally:
            self.box.db.rollback()

    def test_old_status_constructor_attempts_write(self):
        self.box.db.execute('BEGIN IMMEDIATE')
        connect = sqlite3.connect
        connections = []
        def reject_identity_write(*args, **kwargs):
            db = connect(*args, **kwargs)
            connections.append(db)
            db.set_authorizer(lambda action, a, b, dbname, source:
                              sqlite3.SQLITE_DENY if action == sqlite3.SQLITE_INSERT and a == 'identity'
                              else sqlite3.SQLITE_OK)
            return db
        try:
            with patch('phase2.outbox.sqlite3.connect', reject_identity_write):
                with self.assertRaises(sqlite3.DatabaseError):
                    Outbox(self.path, 'collector', 'bme690_01', 'bme690')
        finally:
            for db in connections:
                db.close()
            self.box.db.rollback()

    def test_status_fails_promptly_on_exclusive_lock(self):
        self.box.db.execute('BEGIN EXCLUSIVE')
        started = time.monotonic()
        try:
            with self.assertRaises(sqlite3.OperationalError):
                self.status()
            self.assertLess(time.monotonic()-started, 1.0)
        finally:
            self.box.db.rollback()
        self.assertEqual(self.status()['next_seq'], 1)

    def test_status_rejects_wrong_identity(self):
        for identifier, key, kind in [('other', 'bme690_01', 'bme690'),
                                      ('collector', 'bme690_02', 'bme690'),
                                      ('collector', 'bme690_01', 'sgp41')]:
            with self.assertRaises(ValueError):
                read_queue_status(self.path, identifier, key, kind)

    def test_missing_status_does_not_create_directory_or_database(self):
        missing = self.root/'missing'/'sensor.sqlite3'
        with self.assertRaises(sqlite3.OperationalError):
            read_queue_status(missing, 'collector', 'bme690_01', 'bme690')
        self.assertFalse(missing.parent.exists())

    def test_cli_queue_status_never_opens_writer_or_creates_state_directory(self):
        from phase2.__main__ import main
        config = json.loads((Path(__file__).parent/'phase2/sensors.example.json').read_text())
        config['state_dir'] = str(self.root/'missing')
        path = self.root/'config.json'; path.write_text(json.dumps(config))
        with patch('sys.argv', ['phase2', '--config', str(path), 'queue-status', 'bme690_01']), \
             patch.dict('os.environ', {'DEVICE_IDENTIFIER': 'collector'}), \
             patch('phase2.__main__.open_box') as writer:
            with self.assertRaises(sqlite3.OperationalError):
                main()
        writer.assert_not_called()
        self.assertFalse(Path(config['state_dir']).exists())

    def test_four_cli_status_processes_read_while_four_writers_hold_reserved_locks(self):
        config = json.loads((Path(__file__).parent/'phase2/sensors.example.json').read_text())
        config['state_dir'] = str(self.root)
        path = self.root/'config.json'; path.write_text(json.dumps(config))
        boxes, processes = [], []
        try:
            for key, kind in SENSORS:
                box = Outbox(self.root/(key+'.sqlite3'), 'collector', key, kind)
                boxes.append(box)
                box.db.execute('BEGIN IMMEDIATE')
                box.db.execute('UPDATE identity SET next_seq=99')
            for key, _ in SENSORS:
                processes.append(subprocess.Popen(
                    [sys.executable, '-m', 'phase2', '--config', str(path), 'queue-status', key],
                    cwd=Path(__file__).parent,
                    env={**os.environ, 'DEVICE_IDENTIFIER': 'collector', 'PYTHONDONTWRITEBYTECODE': '1'},
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
            for process in processes:
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, stderr)
                self.assertEqual(json.loads(stdout), {'next_seq': 1, 'queued_rows': 0, 'queued_bytes': 0})
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill(); process.wait()
            for box in boxes:
                box.db.rollback(); box.close()

    def test_storage_delay_has_no_sensor_alarm_or_premature_close(self):
        clock = SimulatedClock()
        sensor = FakeSGP()
        driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=clock.sleep)
        driver.read(); clock.now = 10; driver.read()  # Already in normal mode.
        hardware = Hardware({'type': 'sgp41', 'mux_channel': 3}, {})
        hardware.driver = driver
        box = Outbox(self.root/'sgp.sqlite3', 'collector', 'sgp41_01', 'sgp41')
        original = box.enqueue
        attempted = []
        stop = threading.Event()
        def enqueue(observation):
            attempted.append(observation)
            if len(attempted) == 1:
                time.sleep(0.1)  # Exceeds sensor budget, but storage has no sensor alarm.
            result = original(observation)
            stop.set()
            return result
        config = {'sensors': {'sgp41_01': {'type': 'sgp41', 'interval_seconds': 1}}}
        def wait(_):
            clock.now += 5
        stop.wait = wait
        with patch.object(hardware, '_context', return_value=nullcontext()), \
             patch.object(box, 'enqueue', enqueue), \
             patch('phase2.runtime.deadline', side_effect=lambda: deadline(0.02)), \
             patch('phase2.runtime.log') as log:
            collect(config, 'sgp41_01', hardware, box, stop)
        self.assertEqual(len(attempted), 1)
        self.assertTrue(attempted[0].valid)
        self.assertEqual(sensor.off, 2)  # Initial heater-off + final shutdown only.
        self.assertIsNone(hardware.driver)  # Normal final shutdown.
        self.assertFalse(any(c.args[0] in ('storage_backpressure', 'hardware_recovery')
                             for c in log.call_args_list))
        with sqlite3.connect(self.root/'sgp.sqlite3') as db:
            body = json.loads(db.execute('SELECT body FROM outbox').fetchone()[0])
        self.assertEqual(body['observed_at'], attempted[0].observed_at)

    def test_sqlite_busy_can_delay_python_alarm_delivery(self):
        other = sqlite3.connect(self.path, timeout=0.15)
        self.box.db.execute('BEGIN IMMEDIATE')
        started = time.monotonic()
        try:
            with self.assertRaises(TimeoutError):
                with deadline(0.02):
                    other.execute('BEGIN IMMEDIATE')
            # Python signal handling is deferred until the SQLite C call returns.
            self.assertGreater(time.monotonic()-started, 0.1)
        finally:
            other.close()
            self.box.db.rollback()

    def test_four_outboxes_acquire_publish_and_concurrent_status_stress(self):
        count = 40
        for key, kind in SENSORS:
            box = Outbox(self.root/(key+'.sqlite3'), 'collector', key, kind)
            box.close()
        ctx = multiprocessing.get_context('spawn')
        barrier, results = ctx.Barrier(13), ctx.Queue()
        workers = [ctx.Process(target=stress_worker,
                   args=(str(self.root), key, kind, role, barrier, results, count))
                   for key, kind in SENSORS for role in ('acquire', 'publish', 'status')]
        try:
            for worker in workers:
                worker.start()
            barrier.wait(timeout=15)
            outputs = [results.get(timeout=20) for _ in workers]
            for worker in workers:
                worker.join(timeout=5)
                self.assertEqual(worker.exitcode, 0)
            self.assertFalse([o for o in outputs if 'error' in o], outputs)
            for o in outputs:
                if o['role'] == 'publish':
                    self.assertEqual(o['delivered'], list(range(1, count+1)))
            for key, kind in SENSORS:
                stats = read_queue_status(self.root/(key+'.sqlite3'), 'collector', key, kind)
                self.assertEqual(stats, {'next_seq': count+1, 'queued_rows': 0, 'queued_bytes': 0})
                with sqlite3.connect(self.root/(key+'.sqlite3')) as db:
                    self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                    self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
            print('STRESS', json.dumps([o for o in outputs if o['role'] == 'status']))
        finally:
            for worker in workers:
                if worker.is_alive():
                    worker.terminate()
                    worker.join(timeout=5)
            results.close()


if __name__ == '__main__':
    unittest.main()
