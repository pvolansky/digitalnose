"""Coverage restart regression tests; synthetic temporary journals only."""
import json
import tempfile
import unittest
from unittest.mock import patch

from phase3.core import stamp
from phase3.spool import Spool
from phase3.worker import summarize_due
from test_phase3 import DEVICE, SENSOR, observation as original_observation

START = '2026-09-25T13:50:00Z'
END = '2026-09-25T13:53:00Z'
OLD = '2026-09-24T23:29:00Z'


def observation(seq, at):
    return original_observation(seq, at=stamp(at))


class CoverageCursor(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.spool = Spool(self.temp.name, min_free_bytes=0)
        self.key = 'summary_cursor:' + SENSOR
        self.config = dict(device_id=DEVICE, coverage_start=START,
                           sensors={'sgp': dict(sensor_id=SENSOR, type='sgp41', interval_seconds=1)})

    def tearDown(self):
        self.spool.close()
        self.temp.cleanup()

    def rows(self, table):
        return sorted(tuple(r) for r in self.spool.db.execute('SELECT * FROM '+table))

    def minutes(self):
        return [r[0] for r in self.spool.db.execute('SELECT minute FROM summaries ORDER BY minute')]

    def run_due(self, before=END):
        return summarize_due(self.spool, self.config, 'sgp', before)

    def assert_start(self, saved, expected):
        if saved is not None:
            self.spool.checkpoint(self.key, saved)
        self.run_due()
        self.assertEqual(self.minutes(), [stamp(v) for v in expected])
        self.assertEqual(self.spool.checkpoint(self.key), stamp(END))

    def test_no_saved_cursor(self):
        self.assert_start(None, [START, '2026-09-25T13:51:00Z', '2026-09-25T13:52:00Z'])

    def test_older_saved_cursor(self):
        self.assert_start(OLD, [START, '2026-09-25T13:51:00Z', '2026-09-25T13:52:00Z'])

    def test_equal_saved_cursor(self):
        self.assert_start(START, [START, '2026-09-25T13:51:00Z', '2026-09-25T13:52:00Z'])

    def test_newer_saved_cursor(self):
        self.assert_start('2026-09-25T13:52:00Z', ['2026-09-25T13:52:00Z'])

    def test_equivalent_offset_cursor_and_coverage(self):
        self.config['coverage_start'] = '2026-09-25T15:50:00+02:00'
        self.assert_start('2026-09-25T09:50:00-04:00',
                          [START, '2026-09-25T13:51:00Z', '2026-09-25T13:52:00Z'])

    def test_newer_offset_cursor_compares_instants_not_strings(self):
        self.assert_start('2026-09-25T09:52:00-04:00', ['2026-09-25T13:52:00Z'])

    def test_dirty_late_after_coverage_revises_behind_cursor(self):
        self.run_due()
        self.spool.db.execute('UPDATE summaries SET published_revision=revision')
        self.spool.db.commit()
        self.spool.append(observation(1, at='2026-09-25T13:51:10Z'))
        self.run_due()
        row = self.spool.db.execute('SELECT * FROM summaries WHERE minute=?',
                                    (stamp('2026-09-25T13:51:00Z'),)).fetchone()
        self.assertEqual((row['revision'], row['published_revision']), (2, 1))
        self.assertEqual(json.loads(row['body'])['valid_samples'], 1)
        self.assertEqual(len(self.minutes()), 3)
        self.assertEqual(self.rows('dirty'), [])
        self.assertEqual(self.spool.checkpoint(self.key), stamp(END))

    def test_dirty_before_new_coverage_retained_without_historical_rewrite(self):
        self.config['coverage_start'] = '2026-09-25T13:49:00Z'
        self.run_due(START)
        history = self.rows('summaries')
        self.spool.append(observation(1, at='2026-09-25T13:49:10Z'))
        self.spool.append(observation(2, at=OLD))
        dirty = self.rows('dirty')
        raw = self.rows('records')
        self.config['coverage_start'] = START
        self.run_due()
        self.assertEqual(self.rows('summaries')[0], history[0])
        self.assertNotIn(stamp(OLD), self.minutes())
        self.assertEqual(self.rows('dirty'), dirty)
        self.assertEqual(self.rows('records'), raw)

    def test_restart_retained_previous_trial_journal(self):
        self.config['coverage_start'] = '2026-09-24T23:28:00Z'
        self.spool.append(observation(1, at='2026-09-24T23:28:38Z'))
        self.run_due(OLD)
        history = self.rows('summaries')
        raw = self.rows('records')
        self.spool.close()
        self.spool = Spool(self.temp.name, min_free_bytes=0)
        self.config['coverage_start'] = START
        self.run_due('2026-09-25T13:51:00Z')
        self.assertEqual(self.minutes(), [stamp('2026-09-24T23:28:00Z'), stamp(START)])
        self.assertEqual(self.rows('summaries')[0], history[0])
        self.assertEqual(self.rows('records'), raw)

    def test_repeat_and_restart_do_not_reemit_or_increment_revisions(self):
        self.spool.append(observation(1, at='2026-09-25T13:50:10Z'))
        self.run_due()
        before = self.rows('summaries')
        self.spool.close()
        self.spool = Spool(self.temp.name, min_free_bytes=0)
        with patch.object(self.spool, 'save_summary', wraps=self.spool.save_summary) as save:
            self.assertEqual(self.run_due(), 0)
            save.assert_not_called()
        self.assertEqual(self.rows('summaries'), before)
        self.assertTrue(all(r[3] == 1 for r in before))

    def test_raw_records_and_archive_eligibility_unchanged(self):
        for i, at in enumerate(['2026-09-24T23:28:38Z', '2026-09-25T08:59:59Z',
                                '2026-09-25T09:00:00Z', '2026-09-25T13:50:10Z',
                                '2026-09-25T22:54:59Z', '2026-09-25T22:55:00Z'], 1):
            self.spool.append(observation(i, at=at))
        raw = self.rows('records')
        flags = [r[0] for r in self.spool.db.execute('SELECT eligible FROM records ORDER BY minute')]
        self.assertEqual(flags, [0, 0, 1, 1, 1, 0])
        self.spool.checkpoint(self.key, OLD)
        self.run_due()
        self.assertEqual(self.rows('records'), raw)
        self.assertEqual(self.rows('parts'), [])

    def test_original_120_precoverage_reproduction(self):
        self.spool.checkpoint(self.key, OLD)
        self.assertEqual(self.run_due('2026-09-25T13:51:00Z'), 1)
        self.assertEqual(self.minutes(), [stamp(START)])
        self.assertEqual(self.spool.checkpoint(self.key), stamp('2026-09-25T13:51:00Z'))

    def test_no_due_minute_does_not_rewrite_checkpoint(self):
        self.spool.checkpoint(self.key, OLD)
        checkpoints = self.rows('checkpoints')
        self.assertEqual(self.run_due(START), 0)
        self.assertEqual(self.rows('checkpoints'), checkpoints)
        self.assertEqual(self.minutes(), [])


if __name__ == '__main__':
    unittest.main()
