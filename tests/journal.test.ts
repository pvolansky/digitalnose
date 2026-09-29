import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SmellReport } from '../lib/domain/types';
import {
  calendarMonth,
  filterJournal,
  journalDay,
  journalRangeError,
  journalResidents,
  loadJournal,
  shiftMonth,
} from '../lib/domain/journal';
import { createJournalPdf } from '../lib/journal-pdf';
const report = (id: string, at = '2026-09-26T23:30:00Z', user = 'a'): SmellReport => ({
  id,
  site_id: 'site',
  user_id: user,
  reported_at: at,
  intensity: 4,
  smell_type: 'Cooking',
  note: 'Noticeable by the window.',
  reporter_display_name: 'Alex',
});
test('journal date selection is inclusive in site time, including both DST transitions', () => {
  assert.equal(journalDay('2026-09-26T23:30:00Z', 'Europe/London'), '2026-09-27');
  const rows = [
    report('1', '2026-03-29T00:30:00Z'),
    report('2', '2026-03-29T22:59:59Z'),
    report('3', '2026-03-29T23:00:00Z'),
    report('4', '2026-03-29T12:00:00Z', 'b'),
  ];
  assert.deepEqual(
    filterJournal(rows, 'Europe/London', '2026-03-29', '2026-03-29', 'a').map((r) => r.id),
    ['1', '2'],
  );
  assert.equal(
    filterJournal(
      [report('1', '2026-10-25T00:30:00Z'), report('2', '2026-10-25T01:30:00Z')],
      'Europe/London',
      '2026-10-25',
      '2026-10-25',
    ).length,
    2,
  );
  assert.match(
    journalRangeError('2026-09-01', '2026-09-27', '2026-09-12', '2026-09-27'),
    /first observation/,
  );
  assert.match(
    journalRangeError('2026-09-27', '2026-09-26', '2026-09-12', '2026-09-27'),
    /end date/,
  );
  assert.ok(journalRangeError('2026-02-30', '2026-09-27', '2026-01-01', '2026-09-27'));
  assert.ok(journalRangeError('', '2026-09-27', '2026-01-01', '2026-09-27'));
  assert.ok(journalRangeError('2026-09-12', '2026-09-28', '2026-09-12', '2026-09-27'));
  assert.equal(journalRangeError('2026-09-12', '2026-09-27', '2026-09-12', '2026-09-27'), '');
});
test('calendar aligns Monday-first, handles leap years and year boundaries', () => {
  const month = calendarMonth('2026-09');
  assert.equal(month[0], null);
  assert.equal(month[1], '2026-09-01');
  assert.equal(month.filter(Boolean).length, 30);
  assert.equal(calendarMonth('2024-02').filter(Boolean).length, 29);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
test('resident filtering uses identity, with distinguishable duplicate display names', () => {
  const rows = [report('1'), report('2', undefined, 'b')];
  assert.deepEqual(
    journalResidents(rows).map((r) => r.label),
    ['Alex (1)', 'Alex (2)'],
  );
  assert.deepEqual(
    filterJournal(rows, 'Europe/London', '2026-09-27', '2026-09-27', 'b').map((r) => r.id),
    ['2'],
  );
});
test('complete journal pages beyond 1,000 rows and retains timestamp ties, scoping every query', async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => report(String(i).padStart(5, '0')));
  const cursors: string[] = [];
  let fail = false;
  const db = {
    from(table: string) {
      assert.equal(table, 'smell_reports');
      let after = '';
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: string) {
          assert.equal(key, 'site_id');
          assert.equal(value, 'site');
          return query;
        },
        order(key: string) {
          assert.equal(key, 'id');
          return query;
        },
        limit() {
          return query;
        },
        gt(key: string, value: string) {
          assert.equal(key, 'id');
          after = value;
          cursors.push(value);
          return query;
        },
        then(resolve: (result: unknown) => void) {
          resolve({
            data: rows.filter((r) => r.id > after).slice(0, 500),
            error: fail && after ? new Error('offline') : null,
          });
        },
      };
      return query;
    },
    async rpc(name: string, args: { report_ids: string[] }) {
      assert.equal(name, 'report_display_names');
      assert.ok(args.report_ids.length <= 500);
      return {
        data: args.report_ids.map((id) => ({ report_id: id, display_name: 'Alex' })),
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const result = await loadJournal(db, 'site');
  assert.equal(result.length, 1203);
  assert.equal(new Set(result.map((r) => r.id)).size, 1203);
  assert.deepEqual(cursors, ['00499', '00999', '01202']);
  fail = true;
  await assert.rejects(loadJournal(db, 'site'), /complete journal/);
});
test('PDF export produces multiple pages for long notes with embedded resident-name font', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    ...report(String(i)),
    reporter_display_name: 'Łukasz Żółć',
    note: 'Café - strong smell near the window. '.repeat(26),
  }));
  const doc = createJournalPdf(
    {
      siteName: 'Test home',
      timezone: 'Europe/London',
      from: '2026-09-27',
      to: '2026-09-27',
      residentLabel: 'All residents',
      reports: rows,
    },
    readFileSync('public/fonts/NotoSans-Regular.ttf').toString('base64'),
  );
  assert.ok(doc.getNumberOfPages() > 2);
  assert.ok(doc.output().startsWith('%PDF-'));
  assert.ok(doc.getFontList().Journal.includes('normal'));
});

test('export wind uses nearby historical weather, preserves calm and rejects distant readings', async () => {
  const { journalWind } = await import('../lib/journal-pdf');
  const { demoData } = await import('../lib/domain/demo');
  const at = Date.parse('2026-09-29T12:00:00Z');
  const sample = {
    ...demoData(at).weather.history[0],
    observed_at_utc: '2026-09-29T11:50:00Z',
    wind_speed_kmh: 0,
    wind_direction_deg: 270,
  };
  assert.match(
    journalWind(new Date(at).toISOString(), [sample], 'Europe/London'),
    /0 km\/h from W \(270°\)/,
  );
  assert.match(journalWind(new Date(at).toISOString(), [sample], 'Europe/London'), /12:50/);
  assert.equal(journalWind('2026-09-29T12:06:00Z', [sample], 'Europe/London'), 'Unavailable');
  assert.equal(journalWind(new Date(at).toISOString(), [], 'Europe/London'), 'Unavailable');
  assert.match(
    journalWind(
      new Date(at).toISOString(),
      [{ ...sample, wind_speed_kmh: null, wind_direction_deg: null }],
      'Europe/London',
    ),
    /direction unavailable/,
  );
  const closer = {
    ...sample,
    observed_at_utc: '2026-09-29T12:01:00Z',
    wind_speed_kmh: 12.5,
    wind_direction_deg: 22.5,
  };
  assert.match(
    journalWind(new Date(at).toISOString(), [sample, closer], 'Europe/London'),
    /12.5 km\/h from NNE/,
  );
});
