"""One selected mux channel for the complete measurement, across processes."""
from contextlib import contextmanager
import fcntl
import os
import time


@contextmanager
def file_lock(path, timeout=1.0):
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Hardware resource busy')
                time.sleep(0.01)
        yield
    finally:
        os.close(fd)


class Mux:
    def __init__(self, bus, address, lock_path):
        self.bus, self.address, self.lock_path = bus, address, lock_path

    @contextmanager
    def selected(self, channel):
        if type(channel) is not int or not 0 <= channel <= 7:
            raise ValueError('Invalid mux channel')
        with file_lock(self.lock_path):
            try:
                self.bus.write_byte(self.address, 1 << channel)
                if self.bus.read_byte(self.address) != 1 << channel:
                    raise OSError('Mux selection not confirmed')
                yield
            finally:
                self.bus.write_byte(self.address, 0)

    def probe(self):
        # Probe only the mux, never scan downstream addresses or initialize sensors.
        with file_lock(self.lock_path):
            before = self.bus.read_byte(self.address)
            self.bus.write_byte(self.address, 0)
            after = self.bus.read_byte(self.address)
            if after != 0:
                raise OSError('Mux deselection not confirmed')
            return {'address': hex(self.address), 'previous_mask': before, 'mask': after}
