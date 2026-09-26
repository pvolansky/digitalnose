import json
from pathlib import Path
import tempfile
import unittest

from phase2.model import Observation
from phase2.outbox import Outbox
from phase2.publish import sync_once
from phase3.integration import Mirror
from phase3.publisher_timing import timed_sync_once


class MemoryBox:
    def __init__(self):
        self.row = dict(sequence=7, body=b'{"private":"BODY_SECRET"}', attempts=0)
        self.events = []

    def next(self, at):
        self.events.append(('next', at))
        return self.row

    def acknowledge(self, row):
        self.events.append(('ack', row.copy()))

    def fail(self, *args):
        self.events.append(('fail', args))


class PublisherPreservation(unittest.TestCase):
    def test_preservation_precedes_http_and_ack(self):
        box = MemoryBox()
        events = []

        def preserve(body):
            self.assertEqual(body, box.row['body'])
            events.append('preserve')

        def send(url, key, body):
            self.assertEqual(body, box.row['body'])
            events.append('http')
            return 200, {'ok': True, 'result': 'accepted'}

        original_ack = box.acknowledge

        def acknowledge(row):
            events.append('ack')
            original_ack(row)

        box.acknowledge = acknowledge
        sync_once(box, 'url', 'credential', 1, sender=send, preserve=preserve)
        self.assertEqual(events, ['preserve', 'http', 'ack'])

    def test_preservation_failure_keeps_original_queue_row(self):
        box = MemoryBox()

        def fail(_body):
            raise OSError('TOKEN_SECRET BODY_SECRET')

        with self.assertRaises(OSError):
            sync_once(box, 'url', 'credential', 1, sender=lambda *_: self.fail('sent'), preserve=fail)
        self.assertEqual(box.events, [('next', 1)])

    def test_timing_is_safe_and_does_not_change_retry(self):
        box = MemoryBox()
        logs = []

        def timeout(*_args):
            raise TimeoutError('TOKEN_SECRET')

        result = timed_sync_once(sync_once, box, 'URL_SECRET', 'TOKEN_SECRET', 100,
                                 lambda _body: None, logs.append,
                                 sender=timeout, jitter=lambda: 0)
        self.assertEqual(result['http_status'], 0)
        self.assertEqual(box.events[-1][1][2], 102)
        self.assertEqual(logs[0]['error_class'], 'TimeoutError')
        self.assertEqual(logs[0]['error_phase'], 'http')
        self.assertNotIn('SECRET', json.dumps(logs))

    def test_real_mirror_is_idempotent_across_retry(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            config = json.loads((Path(__file__).parent/'phase3/config.example.json').read_text())
            config.update(spool_root=str(root/'spool'), min_disk_free_bytes=128*1024**2)
            config_path = root/'config.json'
            config_path.write_text(json.dumps(config))
            box = Outbox(root/'outbox.sqlite3', 'collector', 'sgp41_01', 'sgp41')
            box.enqueue(Observation({'raw_voc_ticks': 30000, 'raw_nox_ticks': 16000}))
            mirror = Mirror(config_path, 'sgp41_01')
            try:
                body = bytes(box.next(0)['body'])
                sent = []
                def retrying(*args):
                    sent.append(args[2])
                    return 503, None
                def accepted(*args):
                    sent.append(args[2])
                    return 200, {'ok': True, 'result': 'duplicate'}
                sync_once(box, '', '', 0, preserve=mirror,
                          sender=retrying, jitter=lambda: 0)
                sync_once(box, '', '', 10, preserve=mirror,
                          sender=accepted)
                self.assertIsNone(box.next(10))
                self.assertEqual(sent, [body, body])
                self.assertEqual(mirror.spool.db.execute(
                    'select count(*) from records').fetchone()[0], 1)
            finally:
                mirror.close()
                box.close()


if __name__ == '__main__':
    unittest.main()
