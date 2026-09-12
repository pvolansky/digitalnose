import tempfile
import unittest
from pathlib import Path
from urllib.error import URLError
from aggregator import aggregate_once
from database import connect
from sync import sync_once

class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = connect(str(Path(self.temp.name) / 'test.sqlite3'))
        self.minute = 1789179000

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def raw(self, minute, count=12):
        with self.db:
            self.db.executemany('INSERT INTO sensor_readings VALUES (?,?,?,?)', [(minute+i*5,100+i,600+i,2) for i in range(count)])

    def test_closed_minutes_and_long_gaps(self):
        self.raw(self.minute)
        self.raw(self.minute+7200, 3)
        self.assertEqual(aggregate_once(self.db, self.minute+65), 0)
        self.assertEqual(aggregate_once(self.db, self.minute+70), 1)
        self.assertEqual(aggregate_once(self.db, self.minute+7300), 1)
        self.assertEqual(aggregate_once(self.db, self.minute+7300), 0)
        rows=self.db.execute('SELECT * FROM minute_aggregates ORDER BY minute_start_utc').fetchall()
        self.assertEqual(rows[0]['sample_count'],12)
        self.assertEqual(rows[0]['tvoc_mean'],105.5)
        self.assertEqual(rows[1]['sample_count'],3)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM sensor_readings').fetchone()[0],15)

    def test_offline_and_lost_ack_retries_only_minutes(self):
        self.raw(self.minute)
        aggregate_once(self.db,self.minute+70)
        received=[]
        def lost_ack(url,key,payload):
            self.assertFalse(self.db.in_transaction)
            received.append(payload)
            raise URLError('offline or lost acknowledgement')
        self.assertEqual(sync_once(self.db,'https://example.invalid/api/ingest','key','device',sender=lost_ack,now=self.minute+100),0)
        self.assertIsNone(self.db.execute('SELECT synced_at FROM minute_aggregates').fetchone()[0])
        def success(url,key,payload):
            self.assertEqual(payload,received[0])
            self.assertNotIn('observed_at',payload)
            self.assertNotIn('synced_at',payload)
            return True
        self.assertEqual(sync_once(self.db,'https://example.invalid/api/ingest','key','device',sender=success,now=self.minute+4000),1)
        self.assertEqual(sync_once(self.db,'https://example.invalid/api/ingest','key','device',sender=success,now=self.minute+5000),0)

    def test_batch_limits_and_rejected_rows_do_not_block_later_rows(self):
        for offset in [0,60,120]: self.raw(self.minute+offset)
        aggregate_once(self.db,self.minute+300)
        calls=[]
        def sender(url,key,payload):
            calls.append(payload)
            return len(calls)>1
        self.assertEqual(sync_once(self.db,'https://example.invalid/api/ingest','key','device',batch_size=2,sender=sender,now=self.minute+400),1)
        self.assertEqual(len(calls),2)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM minute_aggregates WHERE synced_at IS NULL').fetchone()[0],2)

if __name__=='__main__': unittest.main()
