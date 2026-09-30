"""Vendor adapters; no network calls and no fabricated measurements."""
from contextlib import nullcontext
import time
from .model import Observation, FIELDS


class SensorDriver:
    def read(self):
        raise NotImplementedError

    def close(self):
        pass

    def shutdown(self):
        self.close()
        return {'attempted': True, 'verified': False}


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
        def set_gas_heater_duration(self, value, nb_profile=0):
            super().set_gas_heater_duration(value, nb_profile)
            if not hasattr(self, '_digitalnose_heater_durations'):
                self._digitalnose_heater_durations = {}
            self._digitalnose_heater_durations[nb_profile] = value

        def select_gas_heater_profile(self, value):
            super().select_gas_heater_profile(value)
            durations = getattr(self, '_digitalnose_heater_durations', {})
            self._digitalnose_heater_duration_ms = durations.get(value, 150)

        def set_power_mode(self, value, blocking=True):
            # 1.0.0's get_power_mode mutates the comparison target and returns
            # the whole oversampling register. Avoid that poll, and allow the
            # vendor example's 150ms heater plus T/P/H conversion to complete.
            super().set_power_mode(value, blocking=False)
            if blocking:
                duration = getattr(self, '_digitalnose_heater_duration_ms', 150)
                sleep((duration + 100) / 1000 if value == module.FORCED_MODE else 0.01)
    return StandardBME690


class BME690Driver(SensorDriver):
    def __init__(self, sensor, channel, heater_profile=None):
        self.sensor, self.channel = sensor, channel
        self.heater_profile = heater_profile or [
            {'temperature_c':320, 'duration_ms':150,
             'profile_id':'pimoroni-standard-320C-150ms'}]
        self.next_step = 0

    def read(self):
        # Pinned bme690 1.0.0 triggers FORCED_MODE and returns True only after
        # NEW_DATA-gated FIELD0 readout. This is the freshness gate; never reuse
        # cached .data on False. meas_index is ordering metadata, not a counter
        # guaranteed to advance across forced-mode calls (it can remain zero).
        # Hardware.read holds the mux lock across the trigger, wait and readout.
        step = self.next_step
        setting = self.heater_profile[step]
        if hasattr(self.sensor, 'select_gas_heater_profile'):
            self.sensor.select_gas_heater_profile(step)
        if not self.sensor.get_sensor_data():
            return Observation({}, 'warming_up', False, acquisition={'mux_channel': self.channel})
        self.next_step = (step + 1) % len(self.heater_profile)
        d = self.sensor.data
        readings = {'temperature_c': d.temperature, 'humidity_pct': d.humidity,
                    'pressure_pa': d.pressure * 100, 'gas_resistance_ohm': d.gas_resistance}
        profile_match = int(d.gas_index) == step
        acquisition = {'mux_channel': self.channel, 'gas_valid': bool(d.status & 0x20),
                       'heater_stable': bool(d.heat_stable), 'heater_step': step,
                       'measurement_index': d.meas_index,
                       'heater_profile_id': setting['profile_id'],
                       'heater_target_temperature_c': setting['temperature_c'],
                       'heater_duration_ms': setting['duration_ms'],
                       'driver_version': 'bme690/1.0.0+digitalnose-standard-wait'}
        status = ('warming_up' if not d.heat_stable
                  else 'invalid' if not acquisition['gas_valid'] or not profile_match else 'ok')
        return Observation(readings, status, status == 'ok', acquisition=acquisition,
                           metadata={'heater_values': 'configured targets, not measured heater temperature',
                                     'heater_profile_match': profile_match})

    def shutdown(self):
        # Forced mode completes one bounded TPHG cycle and returns to sleep.
        # The worker calls shutdown only between reads, after the driver's
        # bounded conversion wait, so configuration writes do not interrupt a
        # measurement in progress.
        from bme690 import constants
        self.sensor.set_power_mode(constants.SLEEP_MODE, blocking=False)
        self.sensor.set_gas_status(constants.RUN_GAS_DISABLE)
        self.sensor.set_gas_heater_status(constants.GAS_HEAT_DISABLE)
        mode_register = self.sensor._get_regs(constants.CONF_T_P_MODE_ADDR, 1)
        mode = (mode_register & constants.MODE_MSK) >> constants.MODE_POS
        run_gas = self.sensor.get_gas_status()
        heater_control = self.sensor.get_gas_heater_status()
        verified = (mode == constants.SLEEP_MODE and
                    run_gas == constants.RUN_GAS_DISABLE and
                    heater_control == constants.GAS_HEAT_DISABLE)
        return {'attempted': True, 'verified': verified,
                'readback': {'mode': mode, 'run_gas': run_gas,
                             'heater_control': heater_control,
                             'mode_register': mode_register}}

    def close(self):
        return self.shutdown()


class SGP41Driver(SensorDriver):
    def __init__(self, sensor, channel, compensation=lambda: None, monotonic=time.monotonic,
                 sleep=time.sleep):
        self.sensor, self.channel, self.compensation, self.clock = sensor, channel, compensation, monotonic
        self.sleep = sleep
        self.started = None
        self.count = 0
        self.last_command_at = None
        # Targeted heater-off, never the vendor's general-call bus reset.
        self.sensor.heater_off()

    def wait_until_ready(self):
        # collect() owns nominal cadence. This is only a command-spacing guard:
        # MUX/OS jitter can compress otherwise one-second acquisition slots.
        # Recheck after sleeping in case the wait returns early.
        while self.last_command_at is not None:
            remaining = self.last_command_at + 1.0 - self.clock()
            if remaining <= 0:
                break
            self.sleep(remaining)

    def read(self):
        source = self.compensation()
        if source:
            temperature, humidity, key, observed_at = source
            meta = {'compensation_source': key, 'compensation_observed_at': observed_at}
        else:
            # Sensirion/Adafruit documented default inputs (not measured environment).
            temperature, humidity = 25.0, 50.0
            meta = {'compensation_source': 'manufacturer_default_25C_50pct'}
        self.wait_until_ready()
        now = self.clock()
        if self.started is None:
            self.started = now
        conditioning = now - self.started < 10
        if conditioning:
            # SGP41 datasheet section 3.1 requires default command inputs
            # during conditioning, even when measured compensation exists.
            temperature, humidity = 25.0, 50.0
            meta = {'compensation_source': 'manufacturer_conditioning_defaults'}
        readings = {'compensation_temperature_c': temperature, 'compensation_humidity_pct': humidity}
        # Timestamp actual vendor command dispatch, not entry to read() or the
        # scheduler slot. Record attempts too: an I2C failure may follow a write.
        # Exceptions still propagate to Acquisition's existing error recovery.
        if conditioning:
            if self.count < 10:
                self.last_command_at = self.clock()
                readings['raw_voc_ticks'] = self.sensor.conditioning(humidity=humidity, temperature=temperature)
                self.count += 1
        else:
            self.last_command_at = self.clock()
            readings['raw_voc_ticks'], readings['raw_nox_ticks'] = self.sensor.measure_raw(
                humidity=humidity, temperature=temperature)
        return Observation(readings, 'warming_up' if conditioning else 'ok', not conditioning,
                           acquisition={'mux_channel': self.channel, 'conditioning': conditioning,
                                        'driver_version': 'adafruit-circuitpython-sgp41/1.0.2'}, metadata=meta)

    def close(self):
        self.sensor.heater_off()

    def shutdown(self):
        self.sensor.heater_off()
        return {'attempted': True, 'verified': False,
                'readback': {'supported': False, 'command': 'heater_off'}}


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
        # Sensirion SPS30 datasheet 4.4: only SPEED(21), LASER(5), FAN(4)
        # are public status bits. Reserved bits (including bit 20) may be 1.
        # Keep the complete raw register diagnostic; ignore reserved bits.
        if int(flags) & ((1 << 21) | (1 << 5) | (1 << 4)):
            observation.status, observation.valid = 'invalid', False
        return observation

    def close(self):
        self.sensor.stop_measurement()

    def shutdown(self):
        self.sensor.stop_measurement()
        return {'attempted': True, 'verified': False,
                'readback': {'supported': False, 'command': 'stop_measurement'}}


class Hardware(SensorDriver):
    """Lazy initialization under the same mux lock as each complete read."""
    def __init__(self, config, root, compensation=lambda: None):
        self.config, self.root, self.compensation = config, root, compensation
        self.driver = self.bus = self.transport = self.mux = None
        self.last_timings = {}
        self.started_at = None

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
        self.last_timings = {'cadence_wait_ms': 0.0, 'mux_wait_ms': 0.0, 'sensor_io_ms': 0.0}
        started = time.monotonic()
        try:
            if self.config['type'] == 'sgp41' and self.driver is not None:
                # Wait outside the shared MUX; adapter rechecks under the lock.
                self.driver.wait_until_ready()
        finally:
            self.last_timings['cadence_wait_ms'] = round((time.monotonic() - started) * 1000, 3)
        try:
            with self._context():
                started = time.monotonic()
                try:
                    if self.driver is None:
                        self._initialize()
                    return self.driver.read()
                finally:
                    self.last_timings['sensor_io_ms'] = round((time.monotonic() - started) * 1000, 3)
        finally:
            if self.mux is not None:
                self.last_timings['mux_wait_ms'] = self.mux.last_wait_ms

    def _initialize(self, idle=False):
        self.started_at = time.monotonic()
        kind = self.config['type']
        if kind == 'bme690':
            import bme690
            sensor = bme_class(bme690)(i2c_addr=self.config['address'], i2c_device=self.bus)
            profile = self.config.get('heater_profile') or [
                {'temperature_c':320, 'duration_ms':150,
                 'profile_id':'pimoroni-standard-320C-150ms'}]
            for index, step in enumerate(profile):
                sensor.set_gas_heater_temperature(step['temperature_c'], index)
                sensor.set_gas_heater_duration(step['duration_ms'], index)
            sensor.select_gas_heater_profile(0)
            self.driver = BME690Driver(sensor, self.config['mux_channel'], profile)
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
            if not idle:
                sensor.start_measurement(OutputFormat(0x103))
            self.driver = SPS30Driver(sensor)
        elif kind == 'ens160':
            from sensor import Sensor
            self.driver = ENS160Driver(Sensor())
        else:
            raise ValueError('Unsupported driver')

    def shutdown(self, initialize=False):
        outcome = {'attempted': True, 'verified': False}
        try:
            if self.driver is None and initialize:
                with self._context():
                    self._initialize(idle=True)
            if self.driver is not None:
                with self._context():
                    outcome = self.driver.shutdown()
            return outcome
        except Exception as error:
            return {'attempted': True, 'verified': False,
                    'error': type(error).__name__ + ': ' + str(error)}
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

    def close(self):
        return self.shutdown()
