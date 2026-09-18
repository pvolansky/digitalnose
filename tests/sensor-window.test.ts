import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSensorWindow } from '../lib/sensors/data';

test('research windows page raw rows, preserve invalid/null measurements and never interpolate missing streams', async () => {
  const source = Array.from({ length: 1001 }, (_, n) => ({
    id: `row${n}`,
    sensor_id: 'bme',
    observed_at: new Date(1700000000000 + n).toISOString(),
    valid: n % 2 === 0,
    readings: { gas_resistance_ohm: n % 2 === 0 ? n : null },
    sequence_number: n,
  }));
  const calls: { sensor: string | undefined; offset: number }[] = [];
  const db = {
    from: (table: string) => {
      let sensor: string | undefined;
      const q = {
        select: () => q,
        eq: (key: string, value: string) => {
          if (key === 'sensor_id') sensor = value;
          return q;
        },
        gte: () => q,
        lte: () => q,
        order: () => q,
        then: (resolve: (value: unknown) => void) =>
          resolve({
            error: null,
            data: [
              { id: 'bme', sensor_type: 'bme690' },
              { id: 'sps', sensor_type: 'sps30' },
            ],
          }),
        range: async (offset: number, last: number) => {
          assert.equal(table, 'sensor_observations');
          calls.push({ sensor, offset });
          return { error: null, data: sensor === 'bme' ? source.slice(offset, last + 1) : [] };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  const result = await getSensorWindow(db, 'collector', 1700000000000, 1700003600000);
  assert.deepEqual(result.streams[0].observations, source);
  assert.deepEqual(result.streams[1].observations, []);
  assert.ok(calls.some((c) => c.sensor === 'bme' && c.offset === 1000));
  await assert.rejects(getSensorWindow(db, 'collector', 0, 1000));
  await assert.rejects(getSensorWindow(db, 'collector', 0, 8 * 86400000));
});
