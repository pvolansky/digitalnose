import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashDeviceKey, readBoundedJson, validateAggregate } from '../lib/domain/ingest';
const sample = {
  device_identifier: 'diginose-001',
  minute_start_utc: '2026-09-12T02:10:00Z',
  tvoc_mean: 180.2,
  tvoc_min: 165,
  tvoc_max: 201,
  eco2_mean: 651.3,
  eco2_min: 630,
  eco2_max: 670,
  aqi_max: 2,
  sample_count: 12,
};
test('accepts valid minute data and rejects malformed, impossible and future readings', () => {
  const now = Date.parse('2026-09-12T02:15:00Z');
  assert.deepEqual(validateAggregate(sample, now), sample);
  for (const patch of [
    { tvoc_mean: '180' },
    { aqi_max: 6 },
    { sample_count: 13 },
    { eco2_mean: 1 },
    { tvoc_min: 200 },
    { sample_count: 1.5 },
    { minute_start_utc: '2026-09-12T02:10:05Z' },
    { minute_start_utc: '2026-09-12T02:20:00Z' },
    { minute_start_utc: '2026-02-30T02:10:00Z' },
    { device_identifier: '../x' },
  ])
    assert.throws(() => validateAggregate({ ...sample, ...patch }, now));
});
test('key hashes are peppered and deterministic', () => {
  const pepper = 'a'.repeat(32);
  assert.equal(hashDeviceKey('secret', pepper), hashDeviceKey('secret', pepper));
  assert.notEqual(hashDeviceKey('secret', pepper), hashDeviceKey('secret', 'b'.repeat(32)));
  assert.throws(() => hashDeviceKey('secret', ''));
});
test('bounds streamed bodies even without Content-Length', async () => {
  await assert.rejects(
    readBoundedJson(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(5000) })),
    /too large/,
  );
  assert.deepEqual(
    await readBoundedJson(new Request('http://localhost', { method: 'POST', body: '{"ok":true}' })),
    { ok: true },
  );
});
