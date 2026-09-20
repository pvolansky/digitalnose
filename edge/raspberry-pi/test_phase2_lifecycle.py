"""Deterministic lifecycle tests: real SQLite/adapters, simulated sensor transports."""
from contextlib import nullcontext
import json
from pathlib import Path
import signal
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from phase2.drivers import Hardware, BME690Driver, SGP41Driver, SPS30Driver
from phase2.model import Observation
from phase2.outbox import Outbox
from phase2.runtime import Acquisition, collect, deadline
from phase2.publish import sync_once
from test_phase2 import SimulatedClock, FakeSGP


class SerialException(OSError):
    """Same exception family as pyserial; no serial hardware is opened."""


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.clock = SimulatedClock()
        self.boxes = []
        self.logs = patch('phase2.runtime.log').start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(lambda: [b.close() for b in self.boxes])

    def fixture(self, kind, key=None):
        key = key or kind + '_01'
        channel = {'bme690': 0 if key.endswith('01') else 1, 'sgp41': 3}.get(kind)
        sensor = FakeSGP() if kind == 'sgp41' else SimpleNamespace(calls=0, closes=0)
        hardware = Hardware({'type': kind, 'mux_channel': channel}, {})
        hardware.initializations = 0
        hardware._context = lambda: nullcontext()
        def initialize():
            hardware.initializations += 1
            if kind == 'sgp41':
                hardware.driver = SGP41Driver(sensor, channel, monotonic=self.clock, sleep=self.clock.sleep)
            elif kind == 'bme690':
                sensor.data = SimpleNamespace(temperature=24, humidity=50, pressure=1013,
                    gas_resistance=6000, status=0x20, heat_stable=True, gas_index=0, meas_index=0)
                def read():
                    sensor.calls += 1
                    return True
                sensor.get_sensor_data = read
                hardware.driver = BME690Driver(sensor, channel)
            else:
                def read():
                    sensor.calls += 1
                    return tuple(range(1, 11))
                def close(): sensor.closes += 1
                sensor.read_measurement_values_float = read
                sensor.read_device_status_register = lambda clear: (0, 0)
                sensor.stop_measurement = close
                hardware.driver = SPS30Driver(sensor, self.clock)
        hardware._initialize = initialize
        box = Outbox(self.root/(key+'.sqlite3'), 'collector', key, kind)
        box.db.execute('PRAGMA busy_timeout=0')  # Deterministic injected lock; no wall-clock sleep.
        self.boxes.append(box)
        runner = Acquisition(key, kind, hardware, box, channel)
        return runner, hardware, sensor, box

    def healthy(self, runner):
        runner.step()
        self.clock.now += 31
        self.assertTrue(runner.step().valid)

    def test_each_healthy_adapter_survives_repeated_real_sqlite_busy_exactly_once(self):
        for kind in ('bme690', 'sgp41', 'sps30'):
            with self.subTest(kind=kind):
                runner, hardware, sensor, box = self.fixture(kind)
                self.healthy(runner)
                adapter = hardware.driver
                previous = box.stats()['next_seq']
                blocker = sqlite3.connect(self.root/(kind+'_01.sqlite3'))
                blocker.execute('BEGIN IMMEDIATE')
                try:
                    with patch.object(hardware, 'read', wraps=hardware.read) as reads:
                        pending = None
                        for retry in range(8):
                            self.clock.now += 2
                            with self.assertRaises(sqlite3.OperationalError): runner.step()
                            pending = pending or runner.pending
                            self.assertIs(runner.pending, pending)
                            self.assertIs(hardware.driver, adapter)
                        self.assertEqual(reads.call_count, 1)
                        blocker.rollback()
                        self.assertIs(runner.step(), pending)
                        self.assertEqual(reads.call_count, 1)
                finally: blocker.close()
                self.assertEqual(box.stats()['next_seq'], previous+1)
                body = json.loads(box.db.execute('SELECT body FROM outbox WHERE sequence=?', (previous,)).fetchone()[0])
                self.assertEqual(body['observed_at'], pending.observed_at)
                self.assertEqual(body['status'], 'ok')
                self.assertEqual(hardware.initializations, 1)
                if kind == 'sgp41':
                    self.assertEqual(sensor.off, 1)
                    self.assertEqual(len(sensor.conditions), 1)
                elif kind == 'sps30': self.assertEqual(sensor.closes, 0)
                self.clock.now += 1
                self.assertTrue(runner.step().valid)
                self.assertFalse(any(c.args[0]=='hardware_recovery' for c in self.logs.call_args_list))

    def test_commit_busy_rolls_back_sequence_then_persists_original_once(self):
        runner, hardware, sensor, box = self.fixture('bme690')
        blocker = sqlite3.connect(self.root/'bme690_01.sqlite3')
        blocker.execute('BEGIN')
        blocker.execute('SELECT * FROM identity').fetchall()  # SHARED lock blocks COMMIT.
        try:
            with self.assertRaises(sqlite3.OperationalError): runner.step()
            pending = runner.pending
            self.assertFalse(box.db.in_transaction)
            self.assertEqual(box.stats()['next_seq'],1)
            self.assertEqual(box.stats()['queued_rows'],0)
            blocker.rollback()
            self.assertIs(runner.step(),pending)
            self.assertEqual(box.stats()['next_seq'],2)
            self.assertEqual(box.stats()['queued_rows'],1)
            self.assertEqual(sensor.calls,1)
            event = next(c for c in self.logs.call_args_list if c.args[0]=='persistence_retry')
            self.assertEqual(event.kwargs['error_domain'],'storage')
            self.assertEqual(event.kwargs['storage_operation'],'enqueue')
            self.assertIn('sqlite_errorcode',event.kwargs)
            self.assertIn('sqlite_errorname',event.kwargs)
        finally: blocker.close()

    def test_sps_status_io_error_is_persisted_and_recovers_hardware(self):
        runner, hardware, sensor, box = self.fixture('sps30')
        self.healthy(runner)
        with patch.object(sensor,'read_device_status_register',side_effect=SerialException):
            result = runner.step()
        self.assertEqual(result.error_code,'status_read_failed')
        self.assertEqual(result.status,'error')
        self.assertIsNone(hardware.driver)
        self.assertEqual(sensor.closes,1)

    def test_collect_backoff_is_bounded_and_storage_does_not_recover_hardware(self):
        runner, hardware, sensor, box = self.fixture('sgp41')
        self.healthy(runner)
        original = box.enqueue
        attempts, waits, observations = [], [], []
        class Stop:
            def is_set(self): return len(observations) == 2
            def wait(self, delay):
                waits.append(delay)
                self_clock.now += delay
        self_clock = self.clock
        def enqueue(obs):
            attempts.append(obs)
            if len(attempts) <= 8: raise sqlite3.OperationalError('busy')
            observations.append(obs)
            self.assertEqual(sensor.off, 1)  # Still open until graceful shutdown.
            return original(obs)
        with patch.object(box, 'enqueue', enqueue), patch('phase2.runtime.time.monotonic', self.clock):
            collect({'sensors': {'sgp41_01': {'type':'sgp41','interval_seconds':1}}},
                    'sgp41_01', hardware, box, Stop())
        self.assertEqual(waits[:8], [.25,.5,1,2,4,5,5,5])
        self.assertTrue(all(o is attempts[0] for o in attempts[:9]))
        self.assertTrue(all(o.valid for o in observations))
        self.assertEqual(hardware.initializations, 1)
        self.assertEqual(sensor.off, 2)  # Initialization and normal final shutdown.
        self.assertFalse(any(c.args[0]=='hardware_recovery' for c in self.logs.call_args_list))

    def test_genuine_i2c_and_serial_faults_recreate_only_affected_hardware(self):
        for kind, fault in [('bme690', OSError), ('sgp41', OSError), ('sps30', SerialException)]:
            with self.subTest(kind=kind):
                runner, hardware, sensor, box = self.fixture(kind)
                self.healthy(runner)
                adapter = hardware.driver
                with patch.object(adapter, 'read', side_effect=fault('private vendor detail')):
                    observation = runner.step()
                self.assertEqual(observation.status, 'error')
                self.assertEqual(observation.error_code, fault.__name__)
                self.assertIsNone(hardware.driver)
                self.clock.now += 1
                runner.step()
                self.assertEqual(hardware.initializations, 2)
        self.assertEqual(sum(c.args[0]=='hardware_recovery' for c in self.logs.call_args_list), 3)

    def test_storage_never_has_sensor_alarm_and_postcommit_stats_cannot_trigger_retry(self):
        runner, hardware, sensor, box = self.fixture('bme690')
        original = box.enqueue
        def enqueue(obs):
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)
            return original(obs)
        with patch.object(box, 'enqueue', enqueue), patch.object(box, 'stats', side_effect=sqlite3.OperationalError):
            self.assertTrue(runner.step().valid)
            self.assertIsNone(runner.pending)
        self.assertEqual(box.stats()['queued_rows'], 1)

    def test_sensor_alarm_recovers_hardware_and_is_labelled_even_if_wrapped(self):
        import time
        runner, hardware, sensor, box = self.fixture('sps30')
        def wrapped():
            try: time.sleep(.05)
            except OSError as exc: raise SerialException('wrapped') from exc
        with patch.object(hardware, 'read', wrapped), patch('phase2.runtime.deadline', lambda: deadline(.01)):
            result = runner.step()
        self.assertEqual(result.error_code, 'SerialException')
        acquisition = next(c for c in self.logs.call_args_list if c.args[0]=='acquisition')
        self.assertTrue(acquisition.kwargs['sensor_deadline_expired'])
        self.assertEqual(acquisition.kwargs['error_domain'], 'hardware')

    def test_preflight_busy_never_reads_or_closes_sensor(self):
        runner, hardware, sensor, box = self.fixture('bme690')
        self.healthy(runner)
        adapter = hardware.driver
        with patch.object(box, 'has_capacity', side_effect=sqlite3.OperationalError('busy')), \
             patch.object(hardware, 'read') as read:
            with self.assertRaises(sqlite3.OperationalError): runner.step()
            read.assert_not_called()
        self.assertIs(hardware.driver, adapter)
        self.assertIsNone(runner.pending)
        self.assertTrue(runner.step().valid)

    def test_graceful_shutdown_retries_pending_before_closing(self):
        runner, hardware, sensor, box = self.fixture('bme690')
        import threading
        stop = threading.Event()
        original = box.enqueue
        attempts = []
        def enqueue(obs):
            attempts.append(obs)
            self.assertIsNotNone(hardware.driver)
            stop.set()
            if len(attempts) < 3: raise sqlite3.OperationalError('busy')
            return original(obs)
        with patch.object(box, 'enqueue', enqueue), patch('phase2.runtime.time.sleep'):
            collect({'state_dir':str(self.root), 'sensors':{'bme690_01':
                    {'type':'bme690','interval_seconds':1}}}, 'bme690_01',hardware,box,stop)
        self.assertEqual(len(attempts),3)
        self.assertTrue(all(o is attempts[0] for o in attempts))
        with sqlite3.connect(self.root/'bme690_01.sqlite3') as db:
            rows=db.execute('SELECT body FROM outbox').fetchall()
            self.assertEqual(len(rows),1)
            self.assertEqual(json.loads(rows[0][0])['observed_at'],attempts[0].observed_at)
        self.assertIsNone(hardware.driver)

    def test_hardware_stage_timings_separate_mux_and_sensor(self):
        from contextlib import contextmanager
        runner, hardware, sensor, box = self.fixture('bme690')
        hardware.mux = SimpleNamespace(last_wait_ms=0)
        @contextmanager
        def selected():
            self.clock.now += .4
            hardware.mux.last_wait_ms = 400
            yield
        original = hardware._initialize
        def initialize():
            original()
            read = hardware.driver.read
            def delayed():
                self.clock.now += .25
                return read()
            hardware.driver.read = delayed
        hardware._initialize = initialize
        hardware._context = selected
        with patch('phase2.drivers.time.monotonic', self.clock):
            self.assertTrue(runner.step().valid)
        self.assertEqual(hardware.last_timings['mux_wait_ms'],400)
        self.assertEqual(hardware.last_timings['sensor_io_ms'],250)
        self.assertEqual(hardware.last_timings['cadence_wait_ms'],0)

    def test_sps_reserved_bit_is_not_a_fault_and_documented_bits_still_are(self):
        runner, hardware, sensor, box = self.fixture('sps30')
        runner.step()
        sensor.read_device_status_register = lambda clear: (1048576, 0)
        self.clock.now = 3
        self.assertEqual(runner.step().status, 'warming_up')
        self.clock.now = 31
        observation = runner.step()
        self.assertTrue(observation.valid)
        self.assertEqual(observation.acquisition['device_status'], 1048576)
        for bit in (21,5,4):
            sensor.read_device_status_register = lambda clear: ((1<<bit)|1048576,0)
            self.assertEqual(runner.step().status, 'invalid')

    def test_four_worker_boot_storage_outage_at_45_seconds_then_six_healthy_minutes(self):
        fixtures = [self.fixture(kind,key) for key,kind in
                    [('bme690_01','bme690'),('bme690_02','bme690'),('sgp41_01','sgp41'),('sps30_01','sps30')]]
        delivered = {r.key: [] for r,_,_,_ in fixtures}
        blockers, pending = {}, {}
        try:
            # Four acquisition workers and four publisher connections, interleaved
            # deterministically. Separate multiprocess test covers actual concurrency.
            pubs = {}
            for r,_,_,_ in fixtures:
                pubs[r.key] = Outbox(self.root/(r.key+'.sqlite3'),'collector',r.key,r.kind)
                pubs[r.key].db.execute('PRAGMA busy_timeout=0')
                self.boxes.append(pubs[r.key])
            for second in range(421):
                self.clock.now = second
                if second == 45:
                    for r,_,_,_ in fixtures:
                        b = sqlite3.connect(self.root/(r.key+'.sqlite3'))
                        b.execute('BEGIN IMMEDIATE'); blockers[r.key] = b
                if second == 53:
                    for b in blockers.values(): b.rollback()
                for r,h,s,b in fixtures:
                    if r.kind != 'sps30' or second % 3 == 0 or r.pending:
                        try:
                            result = r.step()
                            if second >= 31: self.assertTrue(result.valid, (second,r.key,result))
                        except sqlite3.OperationalError:
                            self.assertTrue(45 <= second < 53)
                            pending.setdefault(r.key,r.pending)
                            self.assertIs(r.pending,pending[r.key])
                    def sender(url,key,body):
                        delivered[r.key].append(json.loads(body))
                        return 200, {'ok':True,'result':'accepted'}
                    try: sync_once(pubs[r.key], '', '', second, sender=sender)
                    except sqlite3.OperationalError:
                        self.assertTrue(45 <= second < 53)
            for r,h,s,b in fixtures:
                self.assertEqual(h.initializations,1)
                payloads=delivered[r.key]
                self.assertEqual([p['sequence_number'] for p in payloads],list(range(1,len(payloads)+1)))
                matches=[p for p in payloads if p['observed_at']==pending[r.key].observed_at]
                self.assertEqual(len(matches),1)
                self.assertEqual(b.stats()['queued_rows'],0)
                self.assertEqual(b.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                if r.kind=='sgp41':
                    self.assertEqual(len(s.conditions),10)
                    self.assertEqual(s.off,1)
                if r.kind=='sps30': self.assertEqual(s.closes,0)
            self.assertFalse(any(c.args[0]=='hardware_recovery' for c in self.logs.call_args_list))
        finally:
            for b in blockers.values(): b.close()


if __name__=='__main__': unittest.main()
