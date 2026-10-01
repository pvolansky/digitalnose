"""Operational ENS160 adapter with the shared I2C transaction lock."""
from contextlib import contextmanager
import fcntl
import os
import time

from DFRobot_ENS160 import DFRobot_ENS160_I2C


MUX_LOCK = "/var/lib/digitalnose/phase2/mux.lock"


@contextmanager
def i2c_lock(path=MUX_LOCK):
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


class ENS160Sensor:
    def __init__(self, sensor=None, lock_path=MUX_LOCK):
        self.sensor = sensor or DFRobot_ENS160_I2C(i2c_addr=0x53, bus=1)
        self.lock_path = lock_path

    def initialise(self):
        print("Initialising ENS160...")
        while True:
            with i2c_lock(self.lock_path):
                ready = self.sensor.begin()
            if ready:
                break
            print("ENS160 not responding. Retrying...")
            time.sleep(3)
        print("ENS160 ready.")

    def read(self):
        # Keep the complete logical sample together so capture-side mux changes
        # cannot interleave with the ENS160 register transaction sequence.
        with i2c_lock(self.lock_path):
            status = self.sensor.get_ENS160_status()
            return {
                "sensor_status": status,
                "aqi": self.sensor.get_AQI,
                "tvoc_ppb": self.sensor.get_TVOC_ppb,
                "eco2_ppm": self.sensor.get_ECO2_ppm,
            }
