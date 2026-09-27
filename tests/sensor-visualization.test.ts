import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chartAxis,
  preparePlot,
  bucketGroups,
  coverageText,
  pointQuality,
  axisLabel,
} from '../lib/sensors/charts';
import type { Bucket } from '../lib/sensors/data';
const point = (overrides: Partial<Bucket> = {}): Bucket => ({
  sensor_id: 'sgp',
  metric: 'raw_voc_ticks',
  bucket: 0,
  at: '2026-09-27T10:00:00Z',
  mean: 31240,
  min: 31180,
  max: 31300,
  count: 60,
  first_observed_at: '2026-09-27T10:00:00Z',
  last_observed_at: '2026-09-27T10:01:00Z',
  acquisition_variants: 1,
  health: 'normal',
  expected_count: 60,
  valid_count: 60,
  missing_count: 0,
  ...overrides,
});
test('local axes preserve extrema with padding, readable ticks and constant-signal floors', () => {
  const axis = chartAxis(preparePlot([point()], 'absolute').points);
  assert.ok(axis.min > 31000 && axis.min < 31180);
  assert.ok(axis.max > 31300 && axis.max < 31500);
  assert.equal(new Set(axis.ticks.map((n) => axisLabel(n, axis.step))).size, axis.ticks.length);
  for (const [metric, value, floor] of [
    ['temperature_c', 24, 0.2],
    ['humidity_pct', 50, 1],
    ['pressure_pa', 101000, 1],
    ['gas_resistance_ohm', 80000, 1000],
  ] as const) {
    const a = chartAxis(
      preparePlot([point({ metric, mean: value, min: value, max: value })], 'absolute').points,
    );
    assert.ok(a.min > 0, metric);
    assert.ok(a.max - a.min >= floor, metric);
  }
  const pm = chartAxis(
    preparePlot([point({ metric: 'pm2_5_ug_m3', mean: 5, min: 4, max: 8 })], 'absolute').points,
  );
  assert.equal(pm.min, 0);
  assert.ok(pm.max > 8);
});
test('relative views use independent median bucket means and transform ranges without mutating raw data', () => {
  const raw = [
    point({ sensor_id: 'a', mean: 100, min: 90, max: 110 }),
    point({ sensor_id: 'a', bucket: 1, mean: 120, min: 110, max: 130, health: 'degraded' }),
    point({ sensor_id: 'b', mean: 1000, min: 900, max: 1100 }),
  ];
  const before = JSON.stringify(raw);
  const delta = preparePlot(raw, 'delta');
  assert.equal(delta.points[0].baseline, 110);
  assert.equal(delta.points[2].baseline, 1000);
  assert.equal(delta.points[0].mean, -10);
  assert.equal(delta.points[0].min, -20);
  assert.equal(delta.points[0].max, 0);
  const percent = preparePlot(raw, 'percent');
  assert.ok(Math.abs(percent.points[0].mean + 100 / 11) < 1e-9);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(preparePlot([point({ mean: 0, min: 0, max: 0 })], 'percent').points.length, 0);
});
test('quality exposes timing-slot discrepancies without discarding valid points; gaps are never joined', () => {
  const partial = point({ health: 'degraded', missing_count: 1 });
  assert.equal(pointQuality(partial), 'partial');
  assert.match(coverageText(partial), /60\/60 sensor readings valid/);
  assert.match(coverageText(partial), /59\/60 cadence slots occupied/);
  assert.equal(preparePlot([partial], 'absolute').points.length, 1);
  assert.equal(bucketGroups([point(), point({ bucket: 2 })]).length, 2);
  assert.equal(
    bucketGroups([point(), point({ bucket: 1, has_internal_gap: true }), point({ bucket: 2 })])
      .length,
    3,
  );
  assert.equal(
    bucketGroups([point(), point({ bucket: 1, mean: NaN }), point({ bucket: 2 })]).length,
    2,
  );
  assert.match(
    coverageText(point({ health: 'unknown', expected_count: null, missing_count: null })),
    /coverage unavailable/,
  );
});
