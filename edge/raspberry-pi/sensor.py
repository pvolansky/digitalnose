"""ENS160 status-first block acquisition; diagnostics are separate from eligibility."""
import os
import time
from dataclasses import dataclass

@dataclass(frozen=True)
class Observation:
    raw_status: int
    aqi: int
    tvoc: int
    eco2: int

    @property
    def validity(self): return (self.raw_status >> 2) & 3

    @property
    def reason(self):
        if self.raw_status & 0x40: return 'device_error'
        if not self.raw_status & 0x80: return 'not_running'
        if self.validity: return ('normal','warm_up','startup','invalid')[self.validity]
        if not self.raw_status & 2: return 'no_new_data'
        if not (1<=self.aqi<=5 and 0<=self.tvoc<=65000 and 400<=self.eco2<=65000): return 'out_of_range'
        return 'eligible'

    @property
    def eligible(self): return self.reason=='eligible'

class Sensor:
    def __init__(self):
        from smbus2 import SMBus
        self.address=int(os.environ.get('ENS160_ADDRESS','0x53'),0)
        self.bus=SMBus(int(os.environ.get('ENS160_BUS','1')))
        try:
            if self.bus.read_word_data(self.address,0x00)!=0x0160: raise OSError('ENS160 part ID mismatch')
            self.bus.write_byte_data(self.address,0x10,1)
            time.sleep(.02)
            self.bus.write_byte_data(self.address,0x10,2)
            time.sleep(.02)
        except Exception:
            self.close()
            raise

    def observe(self):
        data=self.bus.read_i2c_block_data(self.address,0x20,6)
        if len(data)!=6: raise OSError('Short ENS160 read')
        return Observation(data[0],data[1]&7,data[2]|data[3]<<8,data[4]|data[5]<<8)

    def read(self):
        observation=self.observe()
        return (observation.tvoc,observation.eco2,observation.aqi) if observation.eligible else None

    def close(self): self.bus.close()

class RecoveringSensor:
    """Monotonic deadlines; retries capped at 60 s, at most one reset per 300 s."""
    def __init__(self,factory=Sensor,clock=time.monotonic):
        self.factory,self.clock=factory,clock
        self.sensor=None
        self.failures=0
        self.delay=1
        self.next_attempt=0
        self.bad_since=None
        self.bad_reason=None
        self.last_reset=float('-inf')

    def close(self):
        if self.sensor:
            try: self.sensor.close()
            except OSError: pass
        self.sensor=None

    def reset(self,now):
        import logging
        logging.warning('ENS160 recovery: reopening sensor')
        self.close()
        self.last_reset=now
        self.next_attempt=now+self.delay
        self.delay=min(60,self.delay*2)
        self.bad_since=None
        self.failures=0

    def observe(self):
        import logging
        now=self.clock()
        if now<self.next_attempt: return None
        try:
            if self.sensor is None:
                self.sensor=self.factory()
                self.bad_since=None
            observation=self.sensor.observe()
        except OSError:
            self.failures+=1
            logging.warning('ENS160 I2C failure (%s consecutive)',self.failures)
            if self.sensor is None or self.failures>=3: self.reset(now)
            return None
        self.failures=0
        if observation.eligible:
            self.bad_since=None
            self.delay=1
        else:
            if self.bad_since is None or self.bad_reason != observation.reason:
                self.bad_since=now
                self.bad_reason=observation.reason
            # Legitimate startup can last an hour; warm-up normally takes three minutes.
            limit=3900 if observation.reason=='startup' else 300 if observation.reason=='warm_up' else 60
            if now-self.bad_since>=limit and now-self.last_reset>=300: self.reset(now)
        return observation
