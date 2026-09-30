import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from phase2.model import Observation
from phase4.spool import CaptureSpool
from phase4.worker import CaptureWorker


class Clock:
    def __init__(self): self.value = 0
    def now(self): return self.value
    def sleep(self, seconds): self.value += seconds


class Driver:
    def read(self):
        return Observation({'gas_resistance_ohm':123.0},acquisition={
            'gas_valid':True,'heater_stable':True,'heater_step':0,
            'heater_target_temperature_c':320,'heater_duration_ms':150})
    def close(self): pass


class Hardware:
    def __init__(self, _item, _root, _compensation=None):
        self.driver = Driver(); self.started_at = 0
    def read(self): return self.driver.read()
    def close(self): self.driver.close()
    def shutdown(self, initialize=False):
        return {'attempted':True,'verified':True,'readback':{'mode':0,'run_gas':0,'heater_control':1}}


class Client:
    def __init__(self, stop_after=None, fail_upload=False):
        self.events, self.rows, self.cleanups, self.commands = [], [], [], 0
        self.stop_after, self.fail_upload = stop_after, fail_upload
    def event(self, session, event, **fields): self.events.append((session,event,fields)); return {'ok':True}
    def measurements(self, _session, rows):
        if self.fail_upload:
            self.fail_upload = False
            raise OSError('offline')
        self.rows.extend(rows); return {'ok':True}
    def command(self):
        self.commands += 1
        if self.stop_after is not None and self.commands >= self.stop_after:
            return {'command':'stop','session':{'id':'session'}}
        return {'command':'capture','session':{'id':'session'}}
    def cleanup(self, session, outcomes, completed_at):
        self.cleanups.append((session,outcomes,completed_at)); return {'ok':True}


def fixture(root, duration=2):
    snapshot = {'schema_version':1,'sensors':{'bme690_01':{
        'type':'bme690','enabled':True,'preparation_seconds':0,
        'settings':{'operating_mode':'forced','heater_profile_id':'pimoroni-standard-320C-150ms',
                    'requested':True,'applied':'reported-per-sample','verified_by_readback':False}}}}
    digest = hashlib.sha256(json.dumps(snapshot,separators=(',',':'),sort_keys=True).encode()).hexdigest()
    config = {'state_path':str(Path(root)/'capture.sqlite3'),'poll_seconds':5,'hardware':{},
              'sensor_runtime':{'bme690_01':{'type':'bme690'}}}
    session = {'id':'session','requested_duration_seconds':duration,
               'capture_configurations':{'snapshot':snapshot,'config_hash':digest}}
    return config, session


class Phase4Test(unittest.TestCase):
    def test_spool_is_idempotent_and_survives_reopen(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'spool.sqlite3'; row = {'sensor_key':'bme','sequence_number':0}
            spool = CaptureSpool(path); spool.append('s',row); spool.append('s',row); spool.close()
            spool = CaptureSpool(path); self.assertEqual(len(spool.pending('s')),1); spool.close()

    def test_capture_acknowledges_recording_only_after_preparation_and_completes(self):
        with tempfile.TemporaryDirectory() as root:
            config, session = fixture(root); clock = Clock(); client = Client()
            worker = CaptureWorker(config,client,clock.now,clock.sleep,Hardware)
            worker.run_capture(session); worker.close()
            self.assertEqual([event for _session,event,_fields in client.events],
                             ['preparing','recording','completed'])
            self.assertEqual(len(client.rows),2)
            self.assertTrue(all(row['phase']=='recording' for row in client.rows))
            self.assertTrue(all(row['validity']['gas_valid'] for row in client.rows))
            self.assertEqual(client.rows[0]['applied_settings']['heater_step'],0)
            self.assertGreaterEqual(client.rows[0]['sensor_startup_elapsed_seconds'],0)
            self.assertTrue(client.cleanups[0][1]['bme690_01']['verified'])

    def test_early_stop_keeps_partial_data(self):
        with tempfile.TemporaryDirectory() as root:
            config, session = fixture(root,10); clock = Clock(); client = Client(stop_after=2)
            worker = CaptureWorker(config,client,clock.now,clock.sleep,Hardware)
            worker.run_capture(session); worker.close()
            self.assertEqual(client.events[-1][1],'cancelled')
            self.assertGreaterEqual(len(client.rows),1)

    def test_restart_flushes_spool_before_marking_session_failed(self):
        with tempfile.TemporaryDirectory() as root:
            config, _session = fixture(root); client = Client(); spool = CaptureSpool(config['state_path'])
            spool.append('session',{'sensor_key':'bme690_01','sequence_number':0}); spool.set_active('session'); spool.close()
            worker = CaptureWorker(config,client,hardware=Hardware); worker.recover(); worker.close()
            self.assertEqual(client.rows[0]['sequence_number'],0)
            self.assertEqual(client.events[-1][1],'failed')
            self.assertEqual(client.events[-1][2]['failure_code'],'device_service_restart')


if __name__ == '__main__': unittest.main()
