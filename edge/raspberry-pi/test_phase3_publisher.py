import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from phase2.model import Observation
from phase2.outbox import Outbox
from phase2.publish import publish_mode, sync_once
from phase3.integration import Mirror
from phase3.publisher_timing import timed_sync_once
import phase2.runtime as runtime


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

    def close(self):
        self.events.append(('close',))


class PublisherPreservation(unittest.TestCase):
    def test_normal_mode_is_unchanged(self):
        box = MemoryBox()
        sent = []
        result = sync_once(box, 'url', 'credential', 1,
                           sender=lambda u, k, b: (sent.append((u, k, b)) or
                                                   (200, {'ok': True, 'result': 'accepted'})),
                           preserve=lambda _body: None)
        self.assertEqual(sent, [('url', 'credential', box.row['body'])])
        self.assertEqual(result, {'sequence_number': 7, 'http_status': 200,
                                  'retry_state': 'delivered', 'attempt': 1})
        self.assertEqual(box.events[-1][0], 'ack')

    def test_archive_only_preserves_then_acknowledges_without_sender(self):
        box = MemoryBox()
        order = []
        original_ack = box.acknowledge
        def acknowledge(row):
            order.append('ack')
            original_ack(row)
        box.acknowledge = acknowledge
        result = sync_once(box, 'URL_SECRET', 'TOKEN_SECRET', 1,
                           sender=lambda *_: self.fail('sender called'),
                           preserve=lambda body: order.append(('preserve', body)),
                           archive_only=True)
        self.assertEqual(order, [('preserve', box.row['body']), 'ack'])
        self.assertEqual(result['retry_state'], 'archived')
        self.assertIsNone(result['http_status'])

    def test_archive_only_requires_preservation_and_retains_row(self):
        box = MemoryBox()
        with self.assertRaises(ValueError):
            sync_once(box, '', '', 1, sender=lambda *_: self.fail('sender called'),
                      archive_only=True)
        self.assertEqual(box.events, [('next', 1)])

    def test_publish_mode_validation(self):
        self.assertEqual(publish_mode(None), 'normal')
        self.assertEqual(publish_mode('normal'), 'normal')
        self.assertEqual(publish_mode('archive_only'), 'archive_only')
        with self.assertRaises(ValueError):
            publish_mode('unexpected')

    def test_runtime_archive_only_missing_config_fails_closed_and_closes_queue(self):
        box = MemoryBox()
        with patch.dict(os.environ, {'DIGITALNOSE_PUBLISH_MODE': 'archive_only'}, clear=True):
            with self.assertRaises(ValueError):
                runtime.publish({'sensors': {'sgp41_01': {'type': 'sgp41'}}},
                                'sgp41_01', box, '', '', threading.Event())
        self.assertEqual(box.events, [('close',)])

    def test_runtime_archive_only_malformed_config_fails_closed_and_closes_queue(self):
        box = MemoryBox()
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'bad.json'
            path.write_text('{malformed')
            env = {'DIGITALNOSE_PUBLISH_MODE': 'archive_only',
                   'DIGITALNOSE_PHASE3_CONFIG': str(path)}
            with patch.dict(os.environ, env, clear=True):
                with self.assertRaises(ValueError):
                    runtime.publish({'sensors': {'sgp41_01': {'type': 'sgp41'}}},
                                    'sgp41_01', box, '', '', threading.Event())
        self.assertEqual(box.events, [('close',)])

    def test_switching_back_to_normal_restores_http_for_new_row(self):
        archived, normal = MemoryBox(), MemoryBox()
        sync_once(archived, '', '', 1, preserve=lambda _body: None,
                  sender=lambda *_: self.fail('sender called'), archive_only=True)
        sent = []
        sync_once(normal, 'url', 'credential', 2, preserve=lambda _body: None,
                  sender=lambda *args: (sent.append(args) or
                                        (200, {'ok': True, 'result': 'accepted'})))
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][2], normal.row['body'])

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

    def test_archive_only_timing_has_no_http_or_secret_leak(self):
        box = MemoryBox()
        logs = []
        result = timed_sync_once(sync_once, box, 'URL_SECRET', 'TOKEN_SECRET', 100,
                                 lambda _body: None, logs.append,
                                 sender=lambda *_: self.fail('sender called'),
                                 archive_only=True)
        self.assertEqual(result['retry_state'], 'archived')
        self.assertIsNone(logs[0]['http_started_at'])
        self.assertIsNone(logs[0]['http_status'])
        self.assertIsNotNone(logs[0]['acknowledgement_at'])
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

    def test_real_mirror_archive_only_duplicate_is_idempotent(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            config = json.loads((Path(__file__).parent/'phase3/config.example.json').read_text())
            config.update(spool_root=str(root/'spool'), min_disk_free_bytes=128*1024**2)
            config_path = root/'config.json'
            config_path.write_text(json.dumps(config))
            first = Outbox(root/'first.sqlite3', 'collector', 'sgp41_01', 'sgp41')
            second = Outbox(root/'second.sqlite3', 'collector', 'sgp41_01', 'sgp41')
            observation = Observation({'raw_voc_ticks': 30000, 'raw_nox_ticks': 16000})
            first.enqueue(observation)
            # Reuse the immutable identity/body as a lost-ack duplicate fixture.
            body = bytes(first.next(0)['body'])
            with second.db:
                second.db.execute('INSERT INTO outbox(sequence,body) VALUES(?,?)',
                                  (1, body))
                second.db.execute('UPDATE identity SET next_seq=2')
            mirror = Mirror(config_path, 'sgp41_01')
            try:
                for box in (first, second):
                    result = sync_once(box, '', '', 0, preserve=mirror,
                                       sender=lambda *_: self.fail('sender called'),
                                       archive_only=True)
                    self.assertEqual(result['retry_state'], 'archived')
                self.assertEqual(mirror.spool.db.execute(
                    'select count(*) from records').fetchone()[0], 1)
            finally:
                mirror.close(); first.close(); second.close()


if __name__ == '__main__':
    unittest.main()
