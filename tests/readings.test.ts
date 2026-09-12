import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, splitReadingGaps } from '../lib/domain/readings';
import { demoData } from '../lib/domain/demo';
test('history preserves missing-minute gaps and does not smooth values', () => {
  const rows = demoData(Date.now()).readings.slice(0, 4);
  const selected = [rows[0], rows[1], rows[3]];
  const groups = splitReadingGaps(selected);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flat(), selected);
  assert.equal(parseRange('invalid'), '24H');
});

test('7D history pages beyond the Supabase 1,000-row response cap', async () => {
  const { loadReadings } = await import('../lib/domain/readings');
  const rows = Array.from({ length: 10080 }, (_, i) => ({ id: String(i) }));
  const offsets: number[] = [];
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    range: async (start: number, end: number) => {
      offsets.push(start);
      return { data: rows.slice(start, end + 1), error: null };
    },
  };
  const db = { from: () => query } as unknown as import('@supabase/supabase-js').SupabaseClient;
  const result = await loadReadings(db, 'device', '7D');
  assert.equal(result.length, 10080);
  assert.equal(offsets.length, 11);
  assert.equal(result.at(-1)?.id, '10079');
});
