"""Tests for the additive operational Phase I adapter."""
import fcntl
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest


fake_vendor = types.ModuleType('DFRobot_ENS160')
fake_vendor.DFRobot_ENS160_I2C = object
sys.modules['DFRobot_ENS160'] = fake_vendor
spec = importlib.util.spec_from_file_location(
    'phase1_runtime_sensor', Path(__file__).parent / 'phase1-runtime' / 'sensor.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeSensor:
    def __init__(self, lock_path):
        self.lock_path = lock_path
        self.calls = []

    def locked(self):
        with open(self.lock_path, 'a+') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(handle, fcntl.LOCK_UN)
            return False

    def begin(self):
        self.calls.append(('begin', self.locked()))
        return True

    def get_ENS160_status(self):
        self.calls.append(('status', self.locked()))
        return 1

    @property
    def get_AQI(self):
        self.calls.append(('aqi', self.locked()))
        return 2

    @property
    def get_TVOC_ppb(self):
        self.calls.append(('tvoc', self.locked()))
        return 3

    @property
    def get_ECO2_ppm(self):
        self.calls.append(('eco2', self.locked()))
        return 4


class Phase1RuntimeTest(unittest.TestCase):
    def test_initialization_and_complete_sample_hold_shared_lock(self):
        with tempfile.TemporaryDirectory() as root:
            lock_path = str(Path(root) / 'mux.lock')
            vendor = FakeSensor(lock_path)
            sensor = module.ENS160Sensor(vendor, lock_path)
            sensor.initialise()
            self.assertEqual(sensor.read(), {
                'sensor_status': 1, 'aqi': 2, 'tvoc_ppb': 3, 'eco2_ppm': 4})
            self.assertTrue(all(locked for _name, locked in vendor.calls))


if __name__ == '__main__':
    unittest.main()
