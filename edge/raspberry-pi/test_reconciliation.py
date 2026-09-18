import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from database import connect,SCHEMA,utc,epoch,insert_reading,create_minute_aggregate
from sensor import Observation,RecoveringSensor
from sync import upload,NoRedirect
from aggregator import aggregate_once

class ReconciliationTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.tmp.name)/'db')
        self.start=int(epoch('2026-09-18T17:31:00Z'))
        self.db=connect(self.path,aggregation_start=self.start)
    def tearDown(self):
        self.db.close(); self.tmp.cleanup()
    def add(self,offset,status=0x82,values=(2,100,600)):
        insert_reading(self.db,utc(self.start+offset),Observation(status,*values))
    def aggregate(self,offset=0):
        return create_minute_aggregate(self.db,utc(self.start+offset),utc(self.start+offset+60))
    def test_incident(self):
        for i in range(4): self.add(i,0,(0,0,0))
        for i in range(9): self.add(10+i*5,0x86)
        for base in (60,120):
            for i in range(12): self.add(base+i*5,0x86)
        for i in range(4): self.add(180+i*5,0x86)
        for i in range(8): self.add(200+i*5)
        self.assertEqual([self.aggregate(i) for i in (0,60,120,180)],['no_eligible_samples']*3+['created'])
        self.assertEqual(self.db.execute('SELECT sample_count FROM minute_aggregates').fetchone()[0],8)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM sensor_readings').fetchone()[0],49)
    def test_outcomes_immutable_and_concurrent_connection(self):
        self.assertEqual(self.aggregate(),'no_samples')
        self.add(0)
        self.assertEqual(self.aggregate(),'created')
        with self.db: self.db.execute("UPDATE minute_aggregates SET synced_at_utc='ack'")
        before=tuple(self.db.execute('SELECT * FROM minute_aggregates').fetchone())
        other=connect(self.path)
        try: self.assertEqual(create_minute_aggregate(other,utc(self.start),utc(self.start+60)),'already_exists')
        finally: other.close()
        self.assertEqual(tuple(self.db.execute('SELECT * FROM minute_aggregates').fetchone()),before)
    def test_status_and_diagnostics(self):
        for validity in range(4):
            ob=Observation(0x82|(validity<<2),2,0,400)
            self.assertEqual(ob.validity,validity)
            self.assertEqual(ob.eligible,validity==0)
        for status in (0,0x80,0xc2,0x02): self.assertFalse(Observation(status,2,100,600).eligible)
        self.assertFalse(Observation(0x82,0,0,0).eligible)
        self.assertFalse(Observation(0x82,2,65001,600).eligible)
    def test_grace_late_arrival_and_no_backfill(self):
        self.add(-60)
        self.assertEqual(aggregate_once(self.db,self.start+69),0)
        self.add(0)
        self.assertEqual(aggregate_once(self.db,self.start+70),1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM minute_aggregates').fetchone()[0],1)
    def test_schema_guard(self):
        p=str(Path(self.tmp.name)/'legacy')
        raw=sqlite3.connect(p); raw.executescript(SCHEMA); raw.close()
        with self.assertRaises(ValueError): connect(p)
        with self.assertRaises(ValueError): connect(p,upgrade=True)
        upgraded=connect(p,upgrade=True,aggregation_start=self.start); upgraded.close()
        p2=str(Path(self.tmp.name)/'wrong')
        raw=sqlite3.connect(p2); raw.execute('CREATE TABLE sensor_readings(observed_at INTEGER)'); raw.close()
        with self.assertRaises(ValueError): connect(p2,upgrade=True,aggregation_start=self.start)
    def test_upgrade_preserves_existing_rows_and_logging(self):
        p=str(Path(self.tmp.name)/'preserve')
        old=sqlite3.connect(p)
        old.executescript(SCHEMA)
        old.execute("INSERT INTO minute_aggregates VALUES (?,100,100,100,600,600,600,2,1,'already-acknowledged')",(utc(self.start-60),))
        old.commit()
        before=old.execute('SELECT * FROM minute_aggregates').fetchall()
        old.close()
        upgraded=connect(p,upgrade=True,aggregation_start=self.start)
        self.assertEqual([tuple(r) for r in upgraded.execute('SELECT * FROM minute_aggregates')],before)
        upgraded.close()
        self.add(0,0x86)
        with self.assertLogs(level='INFO') as logs:
            aggregate_once(self.db,self.start+70)
        self.assertTrue(any('no_eligible_samples' in line for line in logs.output))
        self.assertFalse(any(': created' in line for line in logs.output))

    def test_slot_selection_count_matches_values(self):
        for i in range(60): self.add(i,values=(2,i,600))
        self.aggregate()
        row=self.db.execute('SELECT * FROM minute_aggregates').fetchone()
        self.assertEqual(row['sample_count'],12)
        self.assertEqual(row['tvoc_mean'],27.5)
    def test_upload_response_contract(self):
        class Response:
            status=200
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,size): return self.body[:size]
        response=Response()
        with patch('sync.build_opener') as factory:
            factory.return_value.open.return_value=response
            for body,expected in [(b'{"ok":true}',True),(b'{"ok":false}',False),(b'{}',False),(b' '*4097,False)]:
                response.body=body
                self.assertEqual(upload('https://example.invalid','test',{}),expected)
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere.invalid'))

class RecoveryTest(unittest.TestCase):
    def test_failures_reopen_and_warmup_does_not_loop(self):
        now=[0]; instances=[]
        class Fake:
            closed=False
            def observe(self):
                if len(instances)==1: raise OSError('offline')
                return Observation(0x86,2,100,600)
            def close(self): self.closed=True
        def factory():
            obj=Fake();instances.append(obj);return obj
        worker=RecoveringSensor(factory,lambda:now[0])
        for stamp in (0,5,10): now[0]=stamp;worker.observe()
        self.assertTrue(instances[0].closed)
        for stamp in (15,60,120,180): now[0]=stamp;worker.observe()
        self.assertEqual(len(instances),2)
        worker.close()
    def test_unusable_and_startup_deadlines(self):
        now=[0]
        class Fake:
            def observe(self): return Observation(0x82,0,0,0)
            def close(self): pass
        worker=RecoveringSensor(Fake,lambda:now[0])
        worker.observe();now[0]=61;worker.observe()
        self.assertIsNone(worker.sensor)
        class Startup(Fake):
            def observe(self): return Observation(0x8a,2,100,600)
        worker=RecoveringSensor(Startup,lambda:now[0])
        worker.observe();now[0]=3600;worker.observe()
        self.assertIsNotNone(worker.sensor)

if __name__=='__main__': unittest.main()
