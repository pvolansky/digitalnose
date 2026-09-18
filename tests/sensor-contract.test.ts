import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSensorPayload } from '../lib/sensors/contract';
const base = {
  schema_version: 1,
  device_identifier: 'test',
  sensor_key: 'bme690_01',
  sensor_type: 'bme690',
  observed_at: '2026-01-01T00:00:00.123456Z',
  status: 'ok',
  valid: true,
  readings: { gas_resistance_ohm: 12345 },
};
test('independent sensor contracts preserve raw measurements and timestamp precision', () => {
  assert.equal(validateSensorPayload(base).observed_at, base.observed_at);
  assert.equal(validateSensorPayload(base).sequence_number, 0);
  assert.doesNotThrow(() =>
    validateSensorPayload({
      ...base,
      sensor_type: 'sgp41',
      readings: { raw_voc_ticks: 30000, raw_nox_ticks: 18000 },
    }),
  );
  assert.doesNotThrow(() =>
    validateSensorPayload({
      ...base,
      sensor_type: 'sps30',
      readings: { pm1_ug_m3: 0, pm2_5_ug_m3: 1, pm4_ug_m3: 2, pm10_ug_m3: 3 },
    }),
  );
  assert.doesNotThrow(() =>
    validateSensorPayload({
      ...base,
      status: 'warming_up',
      valid: false,
      readings: {},
      acquisition: { conditioning: true },
    }),
  );
  assert.doesNotThrow(() =>
    validateSensorPayload({
      ...base,
      status: 'error',
      valid: false,
      readings: {},
      error_code: 'I2C',
    }),
  );
});
test('malformed values, dates, versions, unknown fields and false validity are rejected', () => {
  for (const n of [NaN, Infinity, -Infinity, '123', -1, null])
    assert.throws(() => validateSensorPayload({ ...base, readings: { gas_resistance_ohm: n } }));
  for (const change of [
    { schema_version: 2 },
    { sensor_type: 'unknown' },
    { observed_at: '2026-02-30T00:00:00Z' },
    { observed_at: '2099-01-01T00:00:00Z' },
    { sequence_number: -1 },
    { sequence_number: null },
    { acquisition: null },
    { metadata: null },
    { readings: { gas_resistance_ohm: 1, unknown: 2 } },
    { extra: 1 },
    { status: 'warming_up' },
    { acquisition: { gas_valid: false } },
    { metadata: { nested: Infinity } },
    { acquisition: { mux_channel: 9 } },
  ])
    assert.throws(() => validateSensorPayload({ ...base, ...change }));
  assert.doesNotThrow(() => validateSensorPayload(base));
});

test('endpoint enforces credentials and size, reports retries/conflicts, and isolates requests', async () => {
  const { handleSensorIngest } = await import('../lib/sensors/ingest');
  const request = (payload: unknown, auth = true) =>
    new Request('https://example.invalid/api/ingest/sensors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer dn_${'a'.repeat(43)}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  let calls = 0;
  const ingest = async () => {
    calls++;
    return { data: 'accepted', error: null };
  };
  assert.equal(
    (await handleSensorIngest(request(base, false), ingest, 'p'.repeat(32))).status,
    401,
  );
  assert.equal(
    (
      await handleSensorIngest(
        request({ ...base, readings: { gas_resistance_ohm: 'NaN' } }),
        ingest,
        'p'.repeat(32),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleSensorIngest(
        request({ ...base, metadata: { large: 'x'.repeat(17000) } }),
        ingest,
        'p'.repeat(32),
      )
    ).status,
    413,
  );
  assert.equal(calls, 0);
  for (const [data, status] of [
    ['accepted', 200],
    ['duplicate', 200],
    ['conflict', 409],
    ['unauthorized', 401],
    ['unknown_sensor', 422],
  ] as const)
    assert.equal(
      (await handleSensorIngest(request(base), async () => ({ data, error: null }), 'p'.repeat(32)))
        .status,
      status,
    );
  assert.equal(
    (
      await handleSensorIngest(
        request(base),
        async () => {
          throw new Error('network');
        },
        'p'.repeat(32),
      )
    ).status,
    503,
  );
  assert.equal((await handleSensorIngest(request(base), ingest, 'p'.repeat(32))).status, 200);
  assert.equal(calls, 1);
});
