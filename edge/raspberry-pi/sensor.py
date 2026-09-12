"""Minimal ENS160 I²C adapter; excludes warm-up/start-up/invalid measurements.
Register map: ScioSense ENS160 datasheet, DATA_STATUS 0x20 through DATA_ECO2 0x25.
"""
import os
import time

class Sensor:
    def __init__(self):
        from smbus2 import SMBus
        self.address = int(os.environ.get("ENS160_ADDRESS", "0x53"), 0)
        self.bus = SMBus(int(os.environ.get("ENS160_BUS", "1")))
        if self.bus.read_word_data(self.address, 0x00) != 0x0160:
            self.bus.close()
            raise RuntimeError("ENS160 part ID not found")
        self.bus.write_byte_data(self.address, 0x10, 0x01)  # idle
        time.sleep(0.02)
        self.bus.write_byte_data(self.address, 0x10, 0x02)  # standard sensing
        time.sleep(0.02)

    def read(self):
        data = self.bus.read_i2c_block_data(self.address, 0x20, 6)
        status = data[0]
        if status & 0x40 or (status >> 2) & 3 or not status & 2:
            return None
        aqi = data[1] & 7
        tvoc = data[2] | data[3] << 8
        eco2 = data[4] | data[5] << 8
        if not (1 <= aqi <= 5 and 0 <= tvoc <= 65000 and 400 <= eco2 <= 65000):
            return None
        return tvoc, eco2, aqi

    def close(self):
        self.bus.close()
