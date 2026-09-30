"""Hardware/network-free tests for the additive acquisition layer."""
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import contextmanager, nullcontext

from phase2.model import Observation
from phase2.drivers import BME690Driver, SGP41Driver, SPS30Driver, ENS160Driver, Hardware, bme_class
from phase2.bus import Mux, file_lock
from phase2.outbox import Outbox, QueueFull
from phase2.publish import sync_once, check_credentials, upload
from phase2.config import load_config
from phase2.runtime import Acquisition, collect, compensation, save_environment, deadline


class FakeDriver:
    def __init__(self, error=False):
        self.error, self.closed, self.calls = error, False, 0

    def read(self):
        self.calls += 1
        if self.error:
            raise OSError('SECRET must never appear in logs')
        return Observation({'gas_resistance_ohm': 42, 'temperature_c': 24, 'humidity_pct': 55})

    def close(self):
        self.closed = True


class FakeSGP:
    def __init__(self):
        self.conditions, self.measurements, self.off = [], [], 0

    def heater_off(self):
        self.off += 1

    def conditioning(self, **kwargs):
        self.conditions.append(kwargs)
        return 1234

    def measure_raw(self, **kwargs):
        self.measurements.append(kwargs)
        return 2222, 3333


class SimulatedClock:
    def __init__(self):
        self.now = 0.0
        self.waits = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds


class TimedSGP(FakeSGP):
    def __init__(self, clock):
        super().__init__()
        self.clock, self.commands = clock, []

    def command(self, kind):
        self.commands.append((kind, self.clock()))
        self.clock.now += 0.05  # Vendor command/readout time, not cadence.

    def conditioning(self, **kwargs):
        self.command('conditioning')
        return super().conditioning(**kwargs)

    def measure_raw(self, **kwargs):
        self.command('raw')
        return super().measure_raw(**kwargs)


class Phase2(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.boxes = []

    def tearDown(self):
        for box in self.boxes:
            try:
                box.close()
            except sqlite3.ProgrammingError:
                pass
        self.tmp.cleanup()

    def box(self, key='bme690_01', **kwargs):
        box = Outbox(self.root / (key+'.db'), 'collector-1', key, 'bme690', **kwargs)
        self.boxes.append(box)
        return box

    def test_bme_units_flags_and_fresh_repeated_zero_index(self):
        data = SimpleNamespace(temperature=21.5, humidity=45, pressure=1013.25,
                               gas_resistance=10400, status=0xA0, heat_stable=False, gas_index=0, meas_index=0)
        driver = BME690Driver(SimpleNamespace(data=data, get_sensor_data=lambda: True), 0)
        o = driver.read()
        self.assertEqual((o.status, o.valid), ('warming_up', False))
        self.assertEqual(o.readings['pressure_pa'], 101325)
        data.status, data.heat_stable = 0xB0, True
        # Each True represents a new forced-mode/NEW_DATA-gated measurement.
        # Equal resistance is also legitimate; value changes are not freshness.
        for resistance in (5600, 6000, 6000, 20100):
            data.gas_resistance = resistance
            o = driver.read()
            self.assertEqual((o.status, o.valid), ('ok', True))
            self.assertEqual(o.readings['gas_resistance_ohm'], resistance)
            self.assertEqual(o.acquisition['mux_channel'], 0)
            self.assertEqual(o.acquisition['measurement_index'], 0)
            self.assertTrue(o.acquisition['gas_valid'])
            self.assertTrue(o.acquisition['heater_stable'])
        for stable, gas_valid, expected in ((True, False, 'invalid'),
                                            (False, True, 'warming_up'),
                                            (False, False, 'warming_up')):
            data.heat_stable = stable
            data.status = 0x80 | (0x10 if stable else 0) | (0x20 if gas_valid else 0)
            o = driver.read()
            self.assertEqual((o.status, o.valid), (expected, False))

    def test_bme_failed_read_never_reuses_cached_valid_data(self):
        data = SimpleNamespace(temperature=21.5, humidity=45, pressure=1013.25,
                               gas_resistance=6000, status=0xB0, heat_stable=True, gas_index=0, meas_index=0)
        with patch.object(SimpleNamespace(), 'get_sensor_data', create=True,
                          side_effect=[True, False, OSError('I2C failure'), True]) as read:
            driver = BME690Driver(SimpleNamespace(data=data, get_sensor_data=read), 0)
            self.assertTrue(driver.read().valid)
            o = driver.read()
            self.assertEqual((o.status, o.valid, o.readings), ('warming_up', False, {}))
            with self.assertRaises(OSError):
                driver.read()
            self.assertTrue(driver.read().valid)
            self.assertEqual(read.call_count, 4)

    def test_bme_scan_selects_and_reports_each_configured_profile(self):
        profile = [
            {'temperature_c': temperature, 'duration_ms': 150,
             'profile_id': f'bosch-forced-step-{step}-{temperature}C-150ms'}
            for step, temperature in enumerate((200, 250, 300, 350, 400))
        ]
        data = SimpleNamespace(temperature=21.5, humidity=45, pressure=1013.25,
                               gas_resistance=6000, status=0xB0, heat_stable=True,
                               gas_index=0, meas_index=0)
        selected = []
        def select(step):
            selected.append(step)
            data.gas_index = step
        sensor = SimpleNamespace(data=data, get_sensor_data=lambda: True,
                                 select_gas_heater_profile=select)
        driver = BME690Driver(sensor, 1, profile)
        observations = [driver.read() for _ in range(10)]
        self.assertEqual(selected, [0, 1, 2, 3, 4, 0, 1, 2, 3, 4])
        self.assertTrue(all(observation.valid for observation in observations))
        self.assertEqual([observation.acquisition['heater_target_temperature_c']
                          for observation in observations[:5]], [200, 250, 300, 350, 400])
        self.assertTrue(all(observation.metadata['heater_profile_match']
                            for observation in observations))

    def test_bme_complete_read_holds_mux_lock(self):
        class Bus:
            mask = 0
            def write_byte(self, address, mask):
                self.mask = mask
            def read_byte(self, address):
                return self.mask
        bus = Bus()
        lock = str(self.root/'mux.lock')
        hardware = Hardware({'type': 'bme690', 'mux_channel': 0}, {})
        hardware.bus, hardware.mux = bus, Mux(bus, 0x70, lock)
        data = SimpleNamespace(temperature=21.5, humidity=45, pressure=1013.25,
                               gas_resistance=6000, status=0xB0, heat_stable=True, gas_index=0, meas_index=0)
        def read():
            self.assertEqual(bus.mask, 1)
            with self.assertRaises(TimeoutError):
                with file_lock(lock, timeout=0):
                    pass
            return True
        hardware.driver = BME690Driver(SimpleNamespace(data=data, get_sensor_data=read), 0)
        for _ in range(2):
            self.assertTrue(hardware.read().valid)
            self.assertEqual(bus.mask, 0)
            with file_lock(lock, timeout=0):
                pass

    def test_bme_waits_for_standard_heater_without_vendor_poll(self):
        calls, waits = [], []
        class Vendor:
            def set_power_mode(self, value, blocking=True):
                calls.append((value, blocking))
        wrapper = bme_class(SimpleNamespace(BME690=Vendor, FORCED_MODE=1), waits.append)()
        wrapper.set_power_mode(1)
        self.assertEqual(calls, [(1, False)])
        self.assertEqual(waits, [0.25])

    def test_bme_no_new_data_has_no_fabricated_measurements(self):
        o = BME690Driver(SimpleNamespace(get_sensor_data=lambda: False), 0).read()
        self.assertEqual((o.status, o.readings), ('warming_up', {}))

    def test_sgp_ten_seconds_conditioning_then_paired_raw(self):
        clock, sensor = [0.0], FakeSGP()
        driver = SGP41Driver(sensor, 2, monotonic=lambda: clock[0])
        for second in range(10):
            clock[0] = float(second)
            o = driver.read()
            self.assertEqual(o.status, 'warming_up')
            self.assertNotIn('raw_nox_ticks', o.readings)
            o.payload('collector', 'sgp41_01', 'sgp41', second)
        clock[0] = 10.0
        o = driver.read()
        self.assertEqual((o.readings['raw_voc_ticks'], o.readings['raw_nox_ticks']), (2222, 3333))
        self.assertEqual(len(sensor.measurements), 1)
        self.assertEqual(len(sensor.conditions), 10)
        self.assertTrue(o.valid)
        self.assertEqual(sensor.measurements[0], {'temperature': 25.0, 'humidity': 50.0})
        self.assertEqual(o.metadata['compensation_source'], 'manufacturer_default_25C_50pct')

    def test_sgp_compensation_and_gap_preserves_conditioning_start(self):
        clock, sensor = [0.0], FakeSGP()
        driver = SGP41Driver(sensor, 2, lambda: (22, 44, 'bme690_01', '2026-09-18T00:00:00.000000Z'), lambda: clock[0])
        o = driver.read()
        self.assertEqual(o.readings['compensation_temperature_c'], 25)
        self.assertEqual(o.metadata['compensation_source'], 'manufacturer_conditioning_defaults')
        clock[0] = 5
        self.assertEqual(driver.read().status, 'warming_up')
        self.assertEqual(sensor.off, 1)
        self.assertEqual(driver.started, 0)
        for second in range(6, 11):
            clock[0] = second
            o = driver.read()
        self.assertEqual(o.readings['compensation_temperature_c'], 22)
        self.assertEqual(o.metadata['compensation_source'], 'bme690_01')
        driver.close()
        self.assertEqual(sensor.off, 2)

    def test_sps30_float_order_status_and_warmup(self):
        clock = [0]
        sensor = SimpleNamespace(read_measurement_values_float=lambda: tuple(range(1, 11)),
                                 read_device_status_register=lambda clear: (0, 0))
        driver = SPS30Driver(sensor, lambda: clock[0])
        self.assertEqual(driver.read().status, 'warming_up')
        clock[0] = 10
        self.assertEqual(driver.read().status, 'warming_up')
        clock[0] = 30
        o = driver.read()
        self.assertEqual(o.readings['pm2_5_ug_m3'], 2)
        self.assertEqual(o.readings['number_pm0_5_cm3'], 5)
        self.assertEqual(o.readings['typical_particle_size_um'], 10)
        sensor.read_device_status_register = lambda clear: (1 << 4, 0)
        self.assertFalse(driver.read().valid)
        sensor.read_measurement_values_float = lambda: (1, 2)
        with self.assertRaises(ValueError):
            driver.read()

    def test_mux_exact_mask_and_deselect_after_exception(self):
        class Bus:
            mask = 0
            writes = []
            def write_byte(self, addr, mask):
                self.writes.append((addr, mask)); self.mask = mask
            def read_byte(self, addr):
                return self.mask
        bus = Bus()
        mux = Mux(bus, 0x70, str(self.root/'mux.lock'))
        with self.assertRaises(RuntimeError):
            with mux.selected(2):
                self.assertEqual(bus.mask, 4)
                raise RuntimeError()
        self.assertEqual(bus.writes, [(0x70, 4), (0x70, 0)])
        with self.assertRaises(ValueError):
            with mux.selected(8):
                pass

    def test_resource_lock_excludes_second_worker(self):
        path = str(self.root/'lock')
        with file_lock(path):
            with self.assertRaises(TimeoutError):
                with file_lock(path, timeout=0):
                    pass
        with file_lock(path, timeout=0):
            pass

    def test_durable_restart_sequence_and_identical_lost_ack_retry(self):
        box = self.box()
        o = FakeDriver().read()
        self.assertEqual(box.enqueue(o), 1)
        row = box.next(0)
        original = bytes(row['body'])
        sent = []
        def lose_ack(url, key, body):
            sent.append(body)
            raise TimeoutError()
        self.assertEqual(sync_once(box, '', '', 0, lose_ack, lambda: 0)['retry_state'], 'retry')
        box.close()
        box = self.box()
        def accept(url, key, body):
            sent.append(body)
            return 200, {'ok': True, 'result': 'duplicate'}
        self.assertEqual(sync_once(box, '', '', 10, accept)['retry_state'], 'delivered')
        self.assertEqual(sent, [original, original])
        self.assertEqual(box.stats()['queued_rows'], 0)
        self.assertEqual(box.enqueue(o), 2)
        self.assertEqual(json.loads(original)['observed_at'], o.observed_at)

    def test_sequence_rollback_on_malformed_result(self):
        box = self.box()
        for fields in ({'gas_resistance_ohm': float('nan')}, {'gas_resistance_ohm': -1}, {}, {'gas_resistance_ohm': True}):
            with self.assertRaises(ValueError):
                box.enqueue(Observation(fields))
        self.assertEqual(box.enqueue(FakeDriver().read()), 1)

    def test_status_contract_and_timestamp_precision(self):
        o = FakeDriver().read()
        self.assertRegex(o.observed_at, r'\.\d{6}Z$')
        o.valid, o.status = True, 'warming_up'
        with self.assertRaises(ValueError):
            o.payload('collector', 'bme690_01', 'bme690', 1)
        o.valid = False
        self.assertEqual(o.payload('collector', 'bme690_01', 'bme690', 1)['status'], 'warming_up')

    def test_409_quarantined_not_deleted_and_later_rows_continue(self):
        box = self.box()
        for _ in range(2):
            box.enqueue(FakeDriver().read())
        result = sync_once(box, '', '', 0, lambda *_: (409, None))
        self.assertEqual(result['retry_state'], 'quarantined')
        self.assertEqual(box.stats()['queued_rows'], 2)
        self.assertEqual(box.next(0)['sequence'], 2)
        self.assertEqual(sync_once(box, '', '', 0, lambda *_: (200, {'ok': True, 'result': 'accepted'}))['retry_state'], 'delivered')
        self.assertEqual(box.stats()['queued_rows'], 1)

    def test_temporary_auth_and_bad_ack_retained(self):
        for code, data in [(503, None), (429, None), (401, None), (200, {'ok': True}), (200, [])]:
            box = self.box('bme_'+str(code)+'_'+str(len(self.boxes)))
            box.enqueue(FakeDriver().read())
            result = sync_once(box, '', '', 0, lambda *_: (code, data), lambda: 0)
            self.assertEqual(result['retry_state'], 'retry')
            self.assertIsNone(box.next(0))
            self.assertEqual(box.stats()['queued_rows'], 1)

    def test_storage_bound_pauses_before_read_and_preserves_unsent(self):
        box = self.box(max_rows=1)
        sensor = FakeDriver()
        runner = Acquisition('bme690_01', 'bme690', sensor, box)
        runner.step()
        with self.assertRaises(QueueFull):
            runner.step()
        self.assertEqual(sensor.calls, 1)
        self.assertEqual(box.stats()['queued_rows'], 1)
        box.acknowledge(box.next(0))
        runner.step()
        self.assertEqual(sensor.calls, 2)

    def test_persistence_failure_retries_same_observation_without_new_read(self):
        box = self.box()
        sensor = FakeDriver()
        runner = Acquisition('bme690_01', 'bme690', sensor, box)
        with patch.object(box, 'enqueue', side_effect=sqlite3.OperationalError('disk full')):
            with self.assertRaises(sqlite3.OperationalError):
                runner.step()
        pending = runner.pending
        runner.step()
        self.assertEqual(sensor.calls, 1)
        self.assertEqual(json.loads(box.next(0)['body'])['observed_at'], pending.observed_at)

    def test_sensor_failure_is_independent_and_logs_no_exception_secret(self):
        import io
        output = io.StringIO()
        bad, good = self.box('bme690_02'), self.box()
        with patch('sys.stdout', output):
            Acquisition('bme690_02', 'bme690', FakeDriver(True), bad, 1).step()
            Acquisition('bme690_01', 'bme690', FakeDriver(), good, 0).step()
        self.assertNotIn('SECRET', output.getvalue())
        self.assertEqual(json.loads(bad.next(0)['body'])['status'], 'error')
        self.assertEqual(json.loads(good.next(0)['body'])['status'], 'ok')

    def test_malformed_adapter_result_persisted_as_invalid_without_fake_readings(self):
        box = self.box()
        driver = SimpleNamespace(read=lambda: {'bad': True})
        Acquisition('bme690_01', 'bme690', driver, box).step()
        payload = json.loads(box.next(0)['body'])
        self.assertEqual((payload['status'], payload['readings']), ('invalid', {}))

    def test_shutdown_closes_driver_and_reopen_preserves_queue(self):
        box, sensor, stop = self.box(), FakeDriver(), threading.Event()
        config = {'state_dir': str(self.root), 'sensors': {'bme690_01': {'type': 'bme690', 'interval_seconds': 1}}}
        original = sensor.read
        def once():
            stop.set(); return original()
        sensor.read = once
        collect(config, 'bme690_01', sensor, box, stop)
        self.assertTrue(sensor.closed)
        self.assertEqual(self.box().stats()['queued_rows'], 1)

    def test_deadline_releases_python_driver_hang(self):
        with self.assertRaises(TimeoutError):
            with deadline(0.02):
                time.sleep(1)

    def test_identity_binding_rejects_queue_reuse(self):
        box = self.box(); box.close()
        with self.assertRaises(ValueError):
            Outbox(self.root/'bme690_01.db', 'other', 'bme690_01', 'bme690')

    def test_configuration_defaults_disable_every_sensor(self):
        path = Path(__file__).parent/'phase2/sensors.example.json'
        config = load_config(path)
        self.assertFalse(any(item['enabled'] for item in config['sensors'].values()))
        config['sensors']['sgp41_01']['interval_seconds'] = 5
        invalid = self.root/'invalid.json'; invalid.write_text(json.dumps(config))
        with self.assertRaises(ValueError):
            load_config(invalid)

    def test_compensation_cache_fresh_stale_and_range(self):
        config = {'state_dir': str(self.root), 'compensation_source': 'bme690_01', 'sensors': {'bme690_01': {'type': 'bme690'}}}
        self.assertIsNone(compensation(config))
        o = FakeDriver().read(); save_environment(config, 'bme690_01', o)
        self.assertEqual(compensation(config)[:3], (24, 55, 'bme690_01'))
        o.observed_at = '2020-01-01T00:00:00.000000Z'; save_environment(config, 'bme690_01', o)
        self.assertIsNone(compensation(config))

    def test_no_redirect_and_https_only(self):
        from phase2.publish import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))
        for url in ['http://example/api/ingest/sensors', 'https://user:pass@example/api/ingest/sensors', 'https://example/api/ingest', 'https://example/api/ingest/sensors?key=x']:
            with self.assertRaises(ValueError):
                check_credentials(url, 'dn_'+'a'*43)
        check_credentials('https://example.com/api/ingest/sensors', 'dn_'+'a'*43)

    def test_legacy_ens160_wrapper_does_not_publish_raw(self):
        sensor = SimpleNamespace(read=lambda: (12, 450, 1), close=lambda: None)
        o = ENS160Driver(sensor).read()
        self.assertEqual(o.readings, {'tvoc': 12, 'eco2': 450, 'aqi': 1})
        with self.assertRaises(ValueError):
            o.payload('collector', 'ens160_01', 'ens160', 1)


    def test_http_request_preserves_bytes_and_checks_ack(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"ok":true,"result":"accepted"}'
        response.__enter__.return_value = response
        opener = MagicMock()
        opener.open.return_value = response
        body = b'{"preserve":"exact bytes"}'
        with patch('phase2.publish.build_opener', return_value=opener):
            code, data = upload('https://example.com/api/ingest/sensors', 'dn_'+'a'*43, body)
        self.assertEqual(code, 200)
        self.assertEqual(opener.open.call_args.args[0].data, body)
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 10)
        self.assertEqual(data['result'], 'accepted')

    def test_sgp_early_conditioning_call_waits_then_transitions_at_ten_seconds(self):
        clock = SimulatedClock()
        sensor = TimedSGP(clock)
        driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=clock.sleep)
        for i in range(10):
            clock.now = i * 0.99
            self.assertEqual(driver.read().status, 'warming_up')
        self.assertEqual(len(sensor.conditions), 10)
        self.assertEqual(len(sensor.measurements), 0)
        clock.now = 9.99
        self.assertTrue(driver.read().valid)
        self.assertEqual(sensor.commands[-1], ('raw', 10.0))
        self.assertEqual(sensor.off, 1)

    def test_sgp_jitter_early_and_delayed_commands_preserve_state(self):
        clock = SimulatedClock()
        sensor = TimedSGP(clock)
        driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=clock.sleep)
        for second in range(11):
            clock.now = float(second)
            driver.read()
        for at in (10.2, 12.03, 12.98, 14.04, 14.99, 18.5, 18.6, 19.7):
            clock.now = max(clock.now, at)
            self.assertTrue(driver.read().valid)
        self.assertEqual(len(sensor.conditions), 10)
        self.assertEqual((sensor.off, driver.started), (1, 0))
        times = [t for _, t in sensor.commands]
        self.assertTrue(all(b - a >= 1 for a, b in zip(times, times[1:])))
        self.assertTrue(clock.waits)
        self.assertEqual(driver.last_command_at, times[-1])

    def test_sgp_command_time_follows_compensation_and_early_wakeup(self):
        clock = SimulatedClock()
        sensor = TimedSGP(clock)
        def compensation():
            clock.now += 0.2
            return None
        waits = []
        def sleep(seconds):
            waits.append(seconds)
            # First sleep wakes prematurely; the guard must check again.
            clock.now += seconds / 2 if len(waits) == 1 else seconds
        driver = SGP41Driver(sensor, 3, compensation, clock, sleep)
        driver.read()
        self.assertEqual(driver.last_command_at, 0.2)
        driver.read()
        self.assertEqual(len(waits), 2)
        self.assertEqual(sensor.commands, [('conditioning', 0.2), ('conditioning', 1.2)])

    def test_sgp_early_wait_does_not_hold_mux_but_commands_do(self):
        clock = SimulatedClock()
        sensor = TimedSGP(clock)
        lock = str(self.root/'sgp-mux.lock')
        class Bus:
            mask = 0
            def write_byte(self, address, mask):
                self.mask = mask
            def read_byte(self, address):
                return self.mask
        bus = Bus()
        def sleep(seconds):
            self.assertEqual(bus.mask, 0)
            with file_lock(lock, timeout=0):
                clock.sleep(seconds)
        driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=sleep)
        hardware = Hardware({'type': 'sgp41', 'mux_channel': 3}, {})
        hardware.driver, hardware.bus, hardware.mux = driver, bus, Mux(bus, 0x70, lock)
        original = sensor.command
        def command(kind):
            self.assertEqual(bus.mask, 8)
            with self.assertRaises(TimeoutError):
                with file_lock(lock, timeout=0):
                    pass
            original(kind)
        sensor.command = command
        hardware.read()
        hardware.read()  # Immediate caller; wait outside lock, then select CH3.
        self.assertEqual(bus.mask, 0)
        self.assertEqual(sensor.commands, [('conditioning', 0.0), ('conditioning', 1.0)])

    def test_sgp_genuine_i2c_and_crc_exceptions_are_persisted_as_errors(self):
        for error in (OSError('I2C failure'), RuntimeError('CRC check failed')):
            with self.subTest(error=type(error).__name__):
                clock = SimulatedClock()
                sensor = TimedSGP(clock)
                driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=clock.sleep)
                driver.read()
                clock.now = 10
                driver.read()
                clock.now = 11
                box = Outbox(self.root/(type(error).__name__+'.db'), 'collector-1', 'sgp41_01', 'sgp41')
                self.boxes.append(box)
                with patch.object(sensor, 'measure_raw', side_effect=error), patch('phase2.runtime.log'):
                    observation = Acquisition('sgp41_01', 'sgp41', driver, box, 3).step()
                self.assertEqual((observation.status, observation.valid, observation.error_code),
                                 ('error', False, type(error).__name__))
                self.assertEqual(observation.readings, {})
                self.assertEqual(json.loads(box.next(0)['body'])['error_code'], type(error).__name__)
                self.assertEqual(driver.last_command_at, 11)
                self.assertEqual(sensor.off, 2)  # Genuine error recovery still closes the sensor.

    def test_sgp_delayed_conditioning_call_does_not_extend_or_restart_sequence(self):
        clock = SimulatedClock()
        sensor = TimedSGP(clock)
        driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=clock.sleep)
        driver.read()
        clock.now = 5
        self.assertEqual(driver.read().status, 'warming_up')
        clock.now = 10
        self.assertTrue(driver.read().valid)
        self.assertEqual(sensor.commands, [('conditioning', 0.0), ('conditioning', 5), ('raw', 10)])
        self.assertEqual(sensor.off, 1)
        self.assertEqual(driver.started, 0)

    def test_sgp_scheduler_mux_jitter_runs_for_several_minutes(self):
        clock = SimulatedClock()
        sensor = TimedSGP(clock)
        driver = SGP41Driver(sensor, 3, monotonic=clock, sleep=clock.sleep)
        hardware = Hardware({'type': 'sgp41', 'mux_channel': 3}, {})
        hardware.driver = driver
        lock_delays = iter([0.365, 0.103] + [0.0, 0.27, 0.01, 0.51] * 100)
        @contextmanager
        def selected():
            clock.now += next(lock_delays)
            yield
        observations = []
        class Box:
            identifier = 'collector-1'
            def has_capacity(self):
                return True
            def enqueue(self, observation):
                observations.append(observation)
                if len(observations) in (60, 120):
                    clock.now += 3.25  # Host/persistence stall, not sensor failure.
                return len(observations)
            def stats(self):
                return {}
            def close(self):
                pass
        class Stop:
            def is_set(self):
                return len(observations) >= 240
            def wait(self, seconds):
                clock.now += seconds
        config = {'sensors': {'sgp41_01': {'type': 'sgp41', 'mux_channel': 3, 'interval_seconds': 1}}}
        with patch.object(hardware, '_context', selected), \
             patch.object(hardware, '_initialize') as initialize, \
             patch('phase2.runtime.time.monotonic', clock), \
             patch('phase2.runtime.deadline', side_effect=lambda: nullcontext()), \
             patch('phase2.runtime.log') as log:
            collect(config, 'sgp41_01', hardware, Box(), Stop())
        initialize.assert_not_called()
        self.assertGreater(clock.now, 240)
        self.assertEqual(sensor.off, 2)  # Initialization and final shutdown only.
        first_ok = next(i for i, o in enumerate(observations) if o.valid)
        self.assertTrue(all(o.status == 'warming_up' for o in observations[:first_ok]))
        self.assertTrue(all(o.status == 'ok' and o.valid for o in observations[first_ok:]))
        self.assertLessEqual(len(sensor.conditions), 10)
        times = [t for _, t in sensor.commands]
        self.assertTrue(all(b - a >= 1 - 1e-12 for a, b in zip(times, times[1:])))
        self.assertTrue(any(b - a > 2 for a, b in zip(times, times[1:])))
        # The existing logger includes lock waiting and conversion in duration_ms.
        durations = [call.kwargs['duration_ms'] for call in log.call_args_list
                     if call.args[0] == 'acquisition']
        self.assertEqual(durations[0], 415.0)
        self.assertTrue(all(o.error_code == '' for o in observations))

    def test_byte_budget_exhaustion_retains_first_payload(self):
        box = self.box(max_bytes=400)
        box.enqueue(FakeDriver().read())
        body = bytes(box.next(0)['body'])
        with self.assertRaises(QueueFull):
            box.enqueue(FakeDriver().read())
        self.assertEqual(bytes(box.next(0)['body']), body)
        self.assertEqual(box.stats()['next_seq'], 2)



    def test_diagnostic_initializes_only_requested_sensor_and_never_opens_outbox(self):
        from phase2.__main__ import main
        import io
        config = json.loads((Path(__file__).parent/'phase2/sensors.example.json').read_text())
        config['state_dir'] = str(self.root)
        config['mux_lock'] = str(self.root/'mux.lock')
        path = self.root/'config.json'; path.write_text(json.dumps(config))
        argv = ['phase2', '--config', str(path), 'sensor-test', 'bme690_02', '--samples', '1']
        stopped = threading.Event()
        stopped.wait = lambda _: False
        with patch('sys.argv', argv), patch('sys.stdout', io.StringIO()), \
             patch('phase2.__main__.stop_event', return_value=stopped), \
             patch('phase2.__main__.Hardware', return_value=FakeDriver()) as factory, \
             patch('phase2.__main__.open_box') as opened, patch('phase2.__main__.publish') as publisher:
            main()
        factory.assert_called_once()
        self.assertEqual(factory.call_args.args[0]['mux_channel'], 1)
        opened.assert_not_called()
        publisher.assert_not_called()

    def test_sps_status_failure_preserves_actual_measurement(self):
        sensor = SimpleNamespace(read_measurement_values_float=lambda: tuple(range(1, 11)),
                                 read_device_status_register=lambda _: (_ for _ in ()).throw(OSError()))
        driver = SPS30Driver(sensor, lambda: 0)
        driver.clock = lambda: 30
        observation = driver.read()
        self.assertEqual(observation.status, 'error')
        self.assertFalse(observation.valid)
        self.assertEqual(observation.readings['pm1_ug_m3'], 1)


def contract_samples():
    """Synthetic test-only examples checked by the real TypeScript validator."""
    data = SimpleNamespace(temperature=22.5, humidity=45, pressure=1013.25,
                           gas_resistance=12345, status=0xB0, heat_stable=True, gas_index=0, meas_index=5)
    bme = BME690Driver(SimpleNamespace(data=data, get_sensor_data=lambda: True), 0).read()
    clock, sensor = [0.0], FakeSGP()
    sgp = SGP41Driver(sensor, 2, monotonic=lambda: clock[0])
    warmup = sgp.read()
    for second in range(1, 10):
        clock[0] = float(second); sgp.read()
    clock[0] = 10.0
    raw = sgp.read()
    sps = SPS30Driver(SimpleNamespace(read_measurement_values_float=lambda: tuple(range(1, 11)),
                      read_device_status_register=lambda _: (0, 0)), lambda: 0)
    sps.clock = lambda: 30
    observations = [('bme690', bme), ('sgp41', warmup), ('sgp41', raw), ('sps30', sps.read()),
                    ('bme690', Observation({}, 'error', False, error_code='OSError')),
                    ('bme690', Observation({'gas_resistance_ohm': None}, 'invalid', False))]
    return [o.payload('fixture_collector', kind+'_01', kind, i+1) for i, (kind, o) in enumerate(observations)]


if __name__ == '__main__':
    unittest.main()
