import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceHealth, healthTimeAgo } from '../lib/domain/device-health';
const now = Date.parse('2026-09-12T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();
test('device health separates heartbeat from valid sensor timestamps', () => {
  for (const [heartbeat, aggregate, expected] of [
    [1000, 38000, 'live'],
    [1000, 1200000, 'warming_up'],
    [240000, 840000, 'offline'],
    [1000, null, 'warming_up'],
    [null, null, 'no_data'],
    [240000, 1000, 'offline'],
    [180000, 180000, 'live'],
    [180001, 180001, 'offline'],
    [0, 180001, 'warming_up'],
  ] as const) {
    assert.equal(
      getDeviceHealth({
        lastSeenAt: heartbeat === null ? null : ago(heartbeat),
        latestAggregateAt: aggregate === null ? null : ago(aggregate),
        now,
      }).state,
      expected,
    );
  }
});
test('fresh sensor data remains distinct from an offline device', () => {
  const health = getDeviceHealth({ lastSeenAt: ago(240000), latestAggregateAt: ago(1000), now });
  assert.equal(health.deviceLabel, 'Offline');
  assert.equal(health.sensorLabel, 'Live');
});
test('missing and invalid timestamps are unknown; future clock skew is clamped', () => {
  assert.equal(
    getDeviceHealth({ lastSeenAt: 'invalid', latestAggregateAt: 'invalid', now }).state,
    'no_data',
  );
  assert.equal(
    getDeviceHealth({ lastSeenAt: ago(-1000), latestAggregateAt: ago(-1000), now }).state,
    'live',
  );
  assert.equal(healthTimeAgo(ago(38000), now), '38 sec ago');
  assert.equal(healthTimeAgo(ago(1200000), now), '20 min ago');
  assert.equal(healthTimeAgo(null, now), 'Not yet');
});
