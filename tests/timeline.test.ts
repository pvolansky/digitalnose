import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextAt, stateIntervals, loadTimeline } from '../lib/domain/timeline';
import type { StateEvent } from '../lib/domain/types';
const event = (
  id: string,
  type: StateEvent['event_type'],
  value: boolean,
  time: number,
  user = 'me',
): StateEvent => ({
  id,
  site_id: 'site',
  user_id: user,
  event_type: type,
  value,
  recorded_at: new Date(time).toISOString(),
});
test('timeline carries state into the range, keeps unknowns and isolates personal presence', () => {
  const events = [
    event('1', 'window_open', true, 10),
    event('2', 'window_open', false, 40),
    event('3', 'user_in_room', true, 20, 'other'),
    event('4', 'user_in_room', true, 60),
  ];
  assert.deepEqual(contextAt(events, 'me', 30), { window_open: true, user_in_room: undefined });
  assert.deepEqual(stateIntervals(events, 'me', 'window_open', 30, 80), [
    { start: 30, end: 40, value: true },
    { start: 40, end: 80, value: false },
  ]);
  assert.deepEqual(stateIntervals(events, 'me', 'user_in_room', 30, 80), [
    { start: 30, end: 60, value: undefined },
    { start: 60, end: 80, value: true },
  ]);
  assert.equal(contextAt(events, 'me', 40).window_open, false);
});
test('timeline fetch includes prior context and all report pages', async () => {
  const reports = Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }));
  const filters: string[] = [];
  const db = {
    from: (table: string) => {
      let seed = false;
      const q = {
        select: () => q,
        eq: (key: string, value: string) => {
          filters.push(`${key}:${value}`);
          return q;
        },
        lt: () => {
          seed = true;
          return q;
        },
        gte: () => q,
        lte: () => q,
        order: () => q,
        or: (filter: string) => {
          filters.push(filter);
          return q;
        },
        limit: async () => ({ data: [event('seed', 'window_open', true, 0)], error: null }),
        range: async (a: number, b: number) => ({
          data: seed ? [] : table === 'smell_reports' ? reports.slice(a, b + 1) : [],
          error: null,
        }),
      };
      return q;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  const timeline = await loadTimeline(db, 'site', 'me', 100, 200);
  assert.equal(timeline.reports.length, 1001);
  assert.ok(timeline.events.some((e) => e.id === 'seed'));
  assert.ok(filters.includes('user_id:me'));
  assert.ok(filters.includes('event_type.eq.window_open,user_id.eq.me'));
});
