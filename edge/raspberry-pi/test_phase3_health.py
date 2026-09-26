import json
from pathlib import Path
import tempfile
import unittest
from phase3.archive import atomic
from phase3.core import canonical
from phase3.device_health import aggregate
from phase3.spool import Spool
from phase3.summary import summarize

class DeviceHealth(unittest.TestCase):
    def test_missing_stale_error_and_independent_workers(self):
        with tempfile.TemporaryDirectory() as root:
            config = {'spool_root':root,'device_id':'device','sensors':{
                'one':{'sensor_id':'one','type':'sgp41'},'two':{'sensor_id':'two','type':'sgp41'}}}
            a = Spool(Path(root)/'one',min_free_bytes=0)
            b = Spool(Path(root)/'two',min_free_bytes=0)
            try:
                report = aggregate(config,'2026-09-25T10:05:00Z')
                self.assertFalse(report['all_sensors_confirmed_healthy'])
                for name,spool in [('one',a),('two',b)]:
                    atomic(Path(root)/name/'heartbeat.json', canonical(dict(sensor_id=name,
                        observed_at='2026-09-25T10:04:30Z',health='normal')).encode())
                    summary = summarize([], 'device', name, 'sgp41','2026-09-25T10:04:00Z',1)
                    summary.update(health='normal',observed_samples=60,valid_samples=60,missing_samples=0)
                    spool.save_summary(summary)
                self.assertTrue(aggregate(config,'2026-09-25T10:05:00Z')['all_sensors_confirmed_healthy'])
                atomic(Path(root)/'two'/'heartbeat.json', canonical(dict(sensor_id='two',
                    observed_at='2026-09-25T10:00:00Z',health='normal')).encode())
                report = aggregate(config,'2026-09-25T10:05:00Z')
                self.assertEqual(report['sensors']['one']['health'],'normal')
                self.assertEqual(report['sensors']['two']['worker_state'],'stale')
                self.assertEqual(report['health'],'unknown')
                atomic(Path(root)/'two'/'heartbeat.json', b'corrupt')
                self.assertEqual(aggregate(config,'2026-09-25T10:05:00Z')['sensors']['one']['health'],'normal')
            finally:
                a.close(); b.close()

    def test_future_clock_and_missing_coverage_never_healthy(self):
        with tempfile.TemporaryDirectory() as root:
            config={'spool_root':root,'device_id':'device','sensors':{'one':{'sensor_id':'one','type':'sgp41'}}}
            atomic(Path(root)/'one'/'heartbeat.json',canonical(dict(sensor_id='one',
                observed_at='2026-09-25T11:00:00Z',health='normal')).encode())
            self.assertEqual(aggregate(config,'2026-09-25T10:05:00Z')['sensors']['one']['worker_state'],'clock_discontinuity')
