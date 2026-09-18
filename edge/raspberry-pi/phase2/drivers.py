"""Vendor adapters; no network calls and no fabricated measurements."""
from contextlib import nullcontext
import time
from .model import Observation, FIELDS


class SensorDriver:
    def read(self):
        raise NotImplementedError

    def close(self):
        pass


class ENS160Driver(SensorDriver):
    """Diagnostic wrapper only. Production ENS160 stays on its existing pipeline."""
    def __init__(self, sensor):
        self.sensor = sensor

    def read(self):
        raw = self.sensor.read()
        if raw is None:
            return Observation({}, 'warming_up', False)
        tvoc, eco2, aqi = raw
        return Observation({'tvoc': tvoc, 'eco2': eco2, 'aqi': aqi})

    def close(self):
        self.sensor.close()


def bme_class(module, sleep=time.sleep):
    class StandardBME690(module.BME690):
        def set_power_mode(self, value, blocking=True):
            # 1.0.0's get_power_mode mutates the comparison target and returns
            # the whole oversampling register. Avoid that poll, and allow the
            # vendor example's 150ms heater plus T/P/H conversion to complete.
            super().set_power_mode(value, blocking=False)
            if blocking:
                sleep(0.25 if value == module.FORCED_MODE else 0.01)
    return StandardBME690


class BME690Driver(SensorDriver):
    def __init__(self, sensor, channel):
        self.sensor, self.channel = sensor, channel
        self.last_index = None

    def read(self):
        if not self.sensor.get_sensor_data():
            return Observation({}, 'warming_up', False, acquisition={'mux_channel': self.channel})
        d = self.sensor.data
        readings = {'temperature_c': d.temperature, 'humidity_pct': d.humidity,
                    'pressure_pa': d.pressure * 100, 'gas_resistance_ohm': d.gas_resistance}
        acquisition = {'mux_channel': self.channel, 'gas_valid': bool(d.status & 0x20),
                       'heater_stable': bool(d.heat_stable), 'heater_step': d.gas_index,
                       'measurement_index': d.meas_index, 'heater_profile_id': 'pimoroni-standard-320C-150ms',
                       'heater_target_temperature_c': 320, 'heater_duration_ms': 150,
                       'driver_version': 'bme690/1.0.0+digitalnose-standard-wait'}
        duplicate = self.last_index == d.meas_index
        self.last_index = d.meas_index
        status = ('invalid' if duplicate else 'warming_up' if not d.heat_stable
                  else 'invalid' if not acquisition['gas_valid'] else 'ok')
        return Observation(readings, status, status == 'ok', acquisition=acquisition,
                           metadata={'heater_values': 'configured targets, not measured heater temperature'})


class SGP41Driver(SensorDriver):
    def __init__(self, sensor, channel, compensation=lambda: None, monotonic=time.monotonic):
        self.sensor, self.channel, self.compensation, self.clock = sensor, channel, compensation, monotonic
        self.started = None
        self.count = 0
        self.last_call = None
        # Targeted heater-off, never the vendor's general-call bus reset.
        self.sensor.heater_off()

    def read(self):
        now = self.clock()
        if self.last_call is not None and now - self.last_call < 0.9:
            raise RuntimeError('SGP41 called faster than 1 Hz')
        if self.last_call is not None and now - self.last_call > 2:
            self.sensor.heater_off()
            self.started, self.count = None, 0
        self.last_call = now
        source = self.compensation()
        if source:
            temperature, humidity, key, observed_at = source
            meta = {'compensation_source': key, 'compensation_observed_at': observed_at}
        else:
            # Sensirion/Adafruit documented default inputs (not measured environment).
            temperature, humidity = 25.0, 50.0
            meta = {'compensation_source': 'manufacturer_default_25C_50pct'}
        if self.started is None:
            self.started = now
        conditioning = now - self.started < 10
        if conditioning:
            # SGP41 datasheet section 3.1 requires default command inputs
            # during conditioning, even when measured compensation exists.
            temperature, humidity = 25.0, 50.0
            meta = {'compensation_source': 'manufacturer_conditioning_defaults'}
        readings = {'compensation_temperature_c': temperature, 'compensation_humidity_pct': humidity}
        if conditioning:
            if self.count < 10:
                readings['raw_voc_ticks'] = self.sensor.conditioning(humidity=humidity, temperature=temperature)
                self.count += 1
        else:
            readings['raw_voc_ticks'], readings['raw_nox_ticks'] = self.sensor.measure_raw(
                humidity=humidity, temperature=temperature)
        return Observation(readings, 'warming_up' if conditioning else 'ok', not conditioning,
                           acquisition={'mux_channel': self.channel, 'conditioning': conditioning,
                                        'driver_version': 'adafruit-circuitpython-sgp41/1.0.2'}, metadata=meta)

    def close(self):
        self.sensor.heater_off()


class SPS30Driver(SensorDriver):
    def __init__(self, sensor, monotonic=time.monotonic):
        self.sensor, self.clock = sensor, monotonic
        self.first_read = monotonic() + 1
        self.ready_after = monotonic() + 30

    def read(self):
        if self.clock() < self.first_read:
            return Observation({}, 'warming_up', False)
        values = self.sensor.read_measurement_values_float()
        if len(values) != 10:
            raise ValueError('Incomplete SPS30 measurement')
        # Capture observation time before the subsequent diagnostic status query.
        observation = Observation(dict(zip(FIELDS['sps30'], values)))
        if self.clock() < self.ready_after:
            observation.status, observation.valid = 'warming_up', False
        try:
            flags, _reserved = self.sensor.read_device_status_register(False)
        except Exception:
            observation.status, observation.valid = 'error', False
            observation.error_code = 'status_read_failed'
            return observation
        observation.acquisition = {'device_status': int(flags), 'driver_version': 'sensirion-uart-sps30/1.0.0'}
        if flags:
            observation.status, observation.valid = 'invalid', False
        return observation

    def close(self):
        self.sensor.stop_measurement()


class Hardware(SensorDriver):
    """Lazy initialization under the same mux lock as each complete read."""
    def __init__(self, config, root, compensation=lambda: None):
        self.config, self.root, self.compensation = config, root, compensation
        self.driver = self.bus = self.transport = self.mux = None

    def _context(self):
        if self.config['type'] not in ('bme690', 'sgp41'):
            return nullcontext()
        if self.bus is None:
            from smbus2 import SMBus
            from .bus import Mux
            self.bus = SMBus(self.root['i2c_bus'])
            self.mux = Mux(self.bus, self.root['mux_address'], self.root['mux_lock'])
        return self.mux.selected(self.config['mux_channel'])

    def read(self):
        with self._context():
            if self.driver is None:
                self._initialize()
            return self.driver.read()

    def _initialize(self):
        kind = self.config['type']
        if kind == 'bme690':
            import bme690
            sensor = bme_class(bme690)(i2c_addr=self.config['address'], i2c_device=self.bus)
            sensor.set_gas_heater_temperature(320)
            sensor.set_gas_heater_duration(150)
            sensor.select_gas_heater_profile(0)
            self.driver = BME690Driver(sensor, self.config['mux_channel'])
        elif kind == 'sgp41':
            from adafruit_extended_bus import ExtendedI2C
            from adafruit_sgp41.sgp41 import SGP41
            self.transport = ExtendedI2C(self.root['i2c_bus'])
            self.driver = SGP41Driver(SGP41(self.transport, address=self.config['address']),
                                      self.config['mux_channel'], self.compensation)
        elif kind == 'sps30':
            from sensirion_shdlc_driver import ShdlcSerialPort
            from sensirion_driver_adapters.shdlc_adapter.shdlc_channel import ShdlcChannel
            from sensirion_uart_sps30.device import Sps30Device
            from sensirion_uart_sps30.commands import OutputFormat
            self.transport = ShdlcSerialPort(port=self.config['serial_port'], baudrate=115200,
                                             additional_response_time=0.02)
            sensor = Sps30Device(ShdlcChannel(self.transport))
            try:
                sensor.stop_measurement()
            except Exception:
                # Already-idle devices can reject stop. The following start
                # must still succeed, otherwise initialization fails.
                pass
            sensor.start_measurement(OutputFormat(0x103))
            self.driver = SPS30Driver(sensor)
        elif kind == 'ens160':
            from sensor import Sensor
            self.driver = ENS160Driver(Sensor())
        else:
            raise ValueError('Unsupported driver')

    def close(self):
        try:
            if self.driver is not None:
                with self._context():
                    self.driver.close()
        finally:
            self.driver = None
            try:
                if self.transport is not None:
                    close = getattr(self.transport, 'deinit', None) or getattr(self.transport, 'close', None)
                    if close:
                        close()
            finally:
                self.transport = None
                try:
                    if self.bus is not None:
                        self.bus.close()
                finally:
                    self.bus = self.mux = None
