import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHistoryWindow,
  historyWindowError,
  shiftHistoryWindow,
  MAX_HISTORY_WINDOW,
} from '../lib/domain/history-window';
const now = Date.parse('2026-09-14T12:00:00Z');
test('custom history URLs preserve exact instants and reject incomplete, future and oversized windows', () => {
  assert.equal(parseHistoryWindow(undefined, undefined, now).window, undefined);
  const result = parseHistoryWindow('2026-09-13T08:30:00Z', '2026-09-13T09:45:00Z', now);
  assert.deepEqual(result.window, {
    start: Date.parse('2026-09-13T08:30:00Z'),
    end: Date.parse('2026-09-13T09:45:00Z'),
  });
  for (const pair of [
    ['2026-09-13', undefined],
    ['garbage', 'garbage'],
    ['2026-09-13T08:30:00Z', '2026-09-15T09:45:00Z'],
    ['2026-09-01T08:30:00Z', '2026-09-13T09:45:00Z'],
  ]) {
    assert.ok(parseHistoryWindow(pair[0], pair[1], now).error);
  }
  assert.ok(historyWindowError({ start: now, end: now }, now));
  assert.equal(historyWindowError({ start: now - MAX_HISTORY_WINDOW, end: now }, now), null);
});
test('stepping preserves duration and clamps the next period to the present', () => {
  const window = { start: now - 7200000, end: now - 3600000 };
  assert.deepEqual(shiftHistoryWindow(window, -1, now), {
    start: now - 10800000,
    end: now - 7200000,
  });
  assert.deepEqual(shiftHistoryWindow(window, 1, now), { start: now - 3600000, end: now });
  assert.deepEqual(shiftHistoryWindow({ start: now - 5400000, end: now - 1800000 }, 1, now), {
    start: now - 3600000,
    end: now,
  });
});
test('sensor history queries exact custom bounds while preserving rows and gaps', async () => {
  const { loadReadings } = await import('../lib/domain/readings');
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: () => query,
    gte: (_key: string, value: string) => {
      filters.start = value;
      return query;
    },
    lte: (_key: string, value: string) => {
      filters.end = value;
      return query;
    },
    order: () => query,
    range: async () => ({ data: [], error: null }),
  };
  await loadReadings({ from: () => query } as never, 'device', '24H', now, {
    start: now - 7200000,
    end: now - 3600000,
  });
  assert.deepEqual(filters, { start: '2026-09-14T10:00:00.000Z', end: '2026-09-14T11:00:00.000Z' });
});
