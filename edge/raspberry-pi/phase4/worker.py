import time
import hashlib
import json
from datetime import datetime, timezone
from phase2.drivers import Hardware
from .spool import CaptureSpool


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')


UNITS = {
    'bme690': {'temperature_c':'degC','humidity_pct':'percent','pressure_pa':'Pa','gas_resistance_ohm':'ohm'},
    'sgp41': {'raw_voc_ticks':'ticks','raw_nox_ticks':'ticks','compensation_temperature_c':'degC','compensation_humidity_pct':'percent'},
    'sps30': {'pm1_ug_m3':'ug/m3','pm2_5_ug_m3':'ug/m3','pm4_ug_m3':'ug/m3','pm10_ug_m3':'ug/m3',
              'number_pm0_5_cm3':'1/cm3','number_pm1_cm3':'1/cm3','number_pm2_5_cm3':'1/cm3',
              'number_pm4_cm3':'1/cm3','number_pm10_cm3':'1/cm3','typical_particle_size_um':'um'},
}


class CaptureWorker:
    def __init__(self, config, client, clock=time.monotonic, sleep=time.sleep, hardware=Hardware):
        self.config, self.client, self.clock, self.sleep, self.hardware = config, client, clock, sleep, hardware
        self.spool = CaptureSpool(config['state_path'])
        self.stop = False

    def flush(self, session_id):
        pending = self.spool.pending(session_id)
        if not pending:
            return True
        self.client.measurements(session_id,[row for _key,_sequence,row in pending])
        self.spool.acknowledge(session_id,[(key,sequence) for key,sequence,_row in pending])
        return not self.spool.pending(session_id)

    def measurement(self, key, item, observation, sequence, phase, hardware=None, previous=None):
        acquisition = dict(observation.acquisition)
        startup_elapsed = None
        hardware_started = getattr(hardware, 'started_at', None)
        if hardware_started is not None:
            startup_elapsed = max(0.0, self.clock() - hardware_started)
        return {
            'sensor_key':key,'sensor_type':item['type'],'acquired_at':observation.observed_at,
            'sequence_number':sequence,'phase':phase,
            'sensor_startup_elapsed_seconds':startup_elapsed,
            'scan_cycle_index':(sequence // len(item.get('settings',{}).get('heater_steps',[]))
                                if item['type']=='bme690' and item.get('settings',{}).get('heater_steps')
                                else acquisition.get('scan_cycle_index')),
            'heater_step_index':acquisition.get('heater_step'),
            'readings':observation.readings,'units':UNITS.get(item['type'],{}),
            'validity':{'status':observation.status,'valid':observation.valid,
                        'fresh_data':bool(observation.readings),
                        'gas_valid':acquisition.get('gas_valid'),
                        'heater_stable':acquisition.get('heater_stable'),
                        'heater_profile_match':observation.metadata.get('heater_profile_match'),
                        'error_code':observation.error_code or None},
            'applied_settings':{**item.get('settings',{}),**observation.metadata,**acquisition,
                                'sensor_startup_elapsed_seconds':startup_elapsed,
                                'previous_capture':previous or {}},
        }

    def run_capture(self, session):
        session_id = session['id']
        configuration = session['capture_configurations']
        snapshot = configuration['snapshot']
        digest = hashlib.sha256(json.dumps(snapshot,separators=(',',':'),sort_keys=True).encode()).hexdigest()
        if digest != configuration['config_hash']:
            self.client.event(session_id,'failed',at=now(),failure_code='configuration_hash_mismatch')
            return
        configured = snapshot.get('sensors',{})
        runtime = self.config['sensor_runtime']
        keys = [key for key,item in configured.items() if item.get('enabled')]
        if not keys or any(key not in runtime for key in keys):
            self.client.event(session_id,'failed',at=now(),failure_code='configuration_unavailable')
            return
        self.spool.set_active(session_id)
        drivers = {}
        environment = {'value':None}
        def compensation(): return environment['value']
        sequence = {key:0 for key in keys}
        previous = self.spool.state('previous_capture', {})
        if previous.get('ended_at'):
            try:
                ended = datetime.fromisoformat(previous['ended_at'].replace('Z','+00:00'))
                previous['seconds_since_previous_capture'] = max(
                    0.0, (datetime.now(timezone.utc) - ended).total_seconds())
            except (TypeError, ValueError):
                previous['seconds_since_previous_capture'] = None
        final_status, failure_code = 'completed', None
        try:
            self.client.event(session_id,'preparing',at=now())
            for key in keys:
                drivers[key] = self.hardware(runtime[key],self.config['hardware'],compensation)
            preparation = max(int(configured[key].get('preparation_seconds',0)) for key in keys)
            started = self.clock()
            while self.clock()-started < preparation and not self.stop:
                for key in keys:
                    if self.stop or self.clock()-started >= preparation: break
                    observation = drivers[key].read()
                    if key == 'bme690_01': self.update_environment(environment, key, observation)
                    phase = 'settling' if observation.status == 'warming_up' else 'preparing'
                    row = self.measurement(key,configured[key],observation,sequence[key],phase,
                                           drivers[key],previous)
                    self.spool.append(session_id,row); sequence[key] += 1
                if self.command_stop(session_id):
                    final_status = 'cancelled'; break
                self.sleep(1)
            if self.stop:
                final_status, failure_code = 'failed', 'service_stopped'
            elif final_status != 'cancelled' and self.command_stop(session_id):
                final_status = 'cancelled'
            if final_status == 'completed':
                self.client.event(session_id,'recording',at=now())
                started = self.clock()
                duration = int(session['requested_duration_seconds'])
                while self.clock()-started < duration and not self.stop:
                    for key in keys:
                        if self.stop or self.clock()-started >= duration: break
                        try:
                            observation = drivers[key].read()
                            if key == 'bme690_01': self.update_environment(environment, key, observation)
                            row = self.measurement(key,configured[key],observation,sequence[key],
                                                   'recording',drivers[key],previous)
                        except Exception as error:
                            from phase2.model import Observation
                            row = self.measurement(key,configured[key],Observation({},'error',False,error_code=type(error).__name__),sequence[key],'recording',drivers[key],previous)
                        self.spool.append(session_id,row); sequence[key] += 1
                    if self.command_stop(session_id):
                        final_status = 'cancelled'; break
                    self.sleep(1)
                if self.stop:
                    final_status, failure_code = 'failed', 'service_stopped'
        except Exception as error:
            final_status, failure_code = 'failed', type(error).__name__[:100]
        finally:
            outcomes = self.cleanup(drivers)
            ended_at = now()
            self.spool.set_state('previous_capture', {
                'session_id': session_id, 'ended_at': ended_at,
                'sensor_state': {key: ('sleep_verified' if value.get('verified') else
                                       'shutdown_attempted' if value.get('attempted') else 'shutdown_failed')
                                 for key,value in outcomes.items()}})
            try: self.client.cleanup(session_id, outcomes, ended_at)
            except Exception: pass
            drained = True
            try:
                while not self.flush(session_id): pass
            except Exception:
                drained = False
                if final_status == 'completed':
                    final_status, failure_code = 'failed', 'upload_failed_after_acquisition'
            try:
                self.client.event(session_id,final_status,at=ended_at,
                                  **({'failure_code':failure_code} if failure_code else {}))
            except Exception: pass
            if drained:
                self.spool.set_active(None)
            else:
                self.stop = True

    def cleanup(self, drivers):
        outcomes = {}
        for key, driver in drivers.items():
            try: outcomes[key] = driver.shutdown()
            except Exception as error:
                outcomes[key] = {'attempted':True,'verified':False,
                                 'error':type(error).__name__+': '+str(error)}
            outcomes[key]['timestamp'] = now()
        return outcomes

    def establish_idle(self):
        outcomes = {}
        for key, runtime in self.config['sensor_runtime'].items():
            driver = self.hardware(runtime,self.config['hardware'])
            try: outcomes[key] = driver.shutdown(initialize=True)
            finally: driver.close()
            outcomes[key]['timestamp'] = now()
        self.spool.set_state('startup_idle', outcomes)
        return outcomes

    @staticmethod
    def update_environment(environment, key, observation):
        temperature = observation.readings.get('temperature_c')
        humidity = observation.readings.get('humidity_pct')
        if isinstance(temperature,(int,float)) and isinstance(humidity,(int,float)):
            environment['value'] = (temperature,humidity,key,observation.observed_at)

    def command_stop(self, session_id):
        try: command = self.client.command()
        except Exception: return False
        return command.get('command') == 'stop' and command.get('session',{}).get('id') == session_id

    def recover(self, idle_outcomes=None):
        interrupted = self.spool.active()
        if not interrupted:
            return
        try:
            if idle_outcomes:
                self.client.cleanup(interrupted,idle_outcomes,now())
            self.flush(interrupted)
            self.client.event(interrupted,'failed',at=now(),failure_code='device_service_restart')
            self.spool.set_active(None)
        except Exception:
            return

    def run(self):
        idle_outcomes = self.establish_idle()
        self.recover(idle_outcomes)
        while not self.stop:
            try:
                command = self.client.command()
                if command.get('command') == 'capture': self.run_capture(command['session'])
            except Exception:
                pass
            self.sleep(self.config['poll_seconds'])

    def close(self):
        self.spool.close()
