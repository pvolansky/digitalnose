import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SensorAnalysis, SensorPlot } from '../components/sensor-analysis';
import {
  sensorHealth,
  loadSensorArray,
  type Sensor,
  type Observation,
  type Bucket,
} from '../lib/sensors/data';
import { bucketGroups } from '../lib/sensors/charts';
import type { SupabaseClient } from '@supabase/supabase-js';
const now = Date.parse('2026-01-01T12:00:00Z');
function sensor(type: Sensor['sensor_type'], key: string = type): Sensor {
  return {
    id: key,
    device_id: 'collector',
    sensor_key: key,
    sensor_type: type,
    label: key,
    manufacturer: 'test',
    model: type,
    location: 'room_main',
    connection_type: 'i2c',
    mux_channel: null,
    enabled: true,
    freshness_seconds: 180,
    metadata: {},
    last_seen_at: null,
    last_valid_reading_at: null,
    latest_observation: null,
  };
}
const sensors = [
  sensor('ens160'),
  sensor('bme690', 'bme690_01'),
  sensor('bme690', 'bme690_02'),
  sensor('sgp41'),
  sensor('sps30'),
];
function observation(status: Observation['status'] = 'ok'): Observation {
  return {
    id: 'test',
    sensor_id: 'bme690_01',
    sensor_type: 'bme690',
    observed_at: new Date(now - 1000).toISOString(),
    received_at: new Date(now).toISOString(),
    sequence_number: 0,
    status,
    valid: status === 'ok',
    readings: { gas_resistance_ohm: 100 },
    acquisition: {},
    metadata: {},
    error_code: null,
    last_error: null,
  };
}
const shared = {
  start: now - 3600000,
  end: now,
  selectedAt: null,
  onSelect: () => {},
  events: [],
  reports: [],
  timezone: 'Europe/London',
};
test('health is driven by observation time and explicit acquisition state, never registration', () => {
  assert.equal(sensorHealth(sensors[4], now), 'AWAITING_DATA');
  for (const [status, expected] of [
    ['ok', 'LIVE'],
    ['warming_up', 'WARMING_UP'],
    ['error', 'ERROR'],
    ['disconnected', 'DISCONNECTED'],
    ['invalid', 'ERROR'],
  ] as const) {
    const o = observation(status);
    const s = { ...sensors[1], latest_observation: o, last_valid_reading_at: o.observed_at };
    assert.equal(sensorHealth(s, now), expected);
    assert.equal(sensorHealth(s, now + 181000), 'STALE');
  }
  assert.equal(
    sensorHealth({ ...sensors[1], last_seen_at: new Date(now).toISOString() }, now),
    'AWAITING_DATA',
  );
});
test('empty array shows intentional empty sections with no zero-filled plots', () => {
  const html = renderToStaticMarkup(
    <SensorAnalysis
      {...shared}
      data={{ sensors, points: [], bucket_seconds: 10, unavailable: false }}
      now={now}
      readings={[]}
      weather={[]}
      updating={false}
      onRetry={() => {}}
    />,
  );
  for (const text of [
    'BME690 gas response',
    'SGP41 · Raw VOC',
    'SGP41 · Raw NOx',
    'Particulate matter',
    'Environment',
    'AWAITING DATA',
    'Awaiting sensor data',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes('<polyline'));
  assert.ok(!html.includes('0 µg/m³'));
});
test('partial gas/PM series preserve zero measurements, extrema and missing bucket gaps', () => {
  const points: Bucket[] = [0, 2].map((bucket) => ({
    sensor_id: 'bme690_01',
    metric: 'gas_resistance_ohm',
    bucket,
    at: new Date(now - 30000 + bucket * 10000).toISOString(),
    mean: 50,
    min: 0,
    max: 200,
    count: 3,
    first_observed_at: new Date(now - 30000).toISOString(),
    last_observed_at: new Date(now - 10000).toISOString(),
    acquisition_variants: 1,
  }));
  assert.equal(bucketGroups(points).length, 2);
  const html = renderToStaticMarkup(
    <SensorPlot
      {...shared}
      title="BME690 gas response"
      unit="Ω"
      sensors={sensors.slice(1, 3)}
      series={sensors
        .slice(1, 3)
        .map((s) => ({ id: s.id, label: s.label, sensorId: s.id, metric: 'gas_resistance_ohm' }))}
      points={points}
    />,
  );
  assert.ok(html.includes('bme690_01'));
  assert.ok(html.includes('bme690_02'));
  assert.ok(html.includes('min 0, max 200'));
  const pm = renderToStaticMarkup(
    <SensorPlot
      {...shared}
      title="PM"
      unit="µg/m³"
      sensors={[sensors[4]]}
      series={['pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3'].map((metric) => ({
        id: metric,
        label: metric,
        sensorId: 'sps30',
        metric,
      }))}
      points={points.map((p) => ({ ...p, sensor_id: 'sps30', metric: 'pm1_ug_m3' }))}
    />,
  );
  for (const metric of ['pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3'])
    assert.ok(pm.includes(metric));
});
test('query errors are isolated from ENS160 and sensor refresh avoids duplicate inspection', async () => {
  const db = {
    rpc: async () => ({ data: null, error: { message: 'offline' } }),
  } as unknown as SupabaseClient;
  assert.equal((await loadSensorArray(db, 'collector', now - 3600000, now)).unavailable, true);
  const html = renderToStaticMarkup(
    <SensorAnalysis
      {...shared}
      data={{ sensors, points: [], bucket_seconds: 10, unavailable: true }}
      now={now}
      readings={[]}
      weather={[]}
      updating={false}
      onRetry={() => {}}
    />,
  );
  assert.ok(html.includes('temporarily unavailable'));
  assert.ok(!html.includes('Awaiting sensor data'));
  const loading = renderToStaticMarkup(
    <SensorAnalysis
      {...shared}
      selectedAt={now}
      data={{ sensors, points: [], bucket_seconds: 10, unavailable: false }}
      now={now}
      readings={[]}
      weather={[]}
      updating
      onRetry={() => {}}
    />,
  );
  assert.ok(!loading.includes('Inspect selected moment'));
  assert.ok(loading.includes('Updating…'));
  assert.ok(!loading.includes('No nearby reading'));
});

test('an invalid observation cannot inherit LIVE from an earlier valid reading', () => {
  const row = observation('ok');
  assert.equal(
    sensorHealth(
      {
        ...sensors[1],
        last_valid_reading_at: row.observed_at,
        latest_observation: { ...row, valid: false },
      },
      now,
    ),
    'ERROR',
  );
});
test('database-filtered valid buckets survive a maintenance period at their start', () => {
  const point: Bucket = {
    sensor_id: 'bme690_01',
    metric: 'gas_resistance_ohm',
    bucket: 0,
    at: new Date(shared.start).toISOString(),
    mean: 500,
    min: 500,
    max: 500,
    count: 1,
    first_observed_at: new Date(shared.start + 120000).toISOString(),
    last_observed_at: new Date(shared.start + 120000).toISOString(),
    acquisition_variants: 1,
  };
  const events = [
    {
      id: 'm1',
      site_id: 'test',
      user_id: null,
      event_type: 'maintenance' as const,
      value: true,
      recorded_at: point.at,
    },
    {
      id: 'm2',
      site_id: 'test',
      user_id: null,
      event_type: 'maintenance' as const,
      value: false,
      recorded_at: new Date(shared.start + 60000).toISOString(),
    },
  ];
  const html = renderToStaticMarkup(
    <SensorPlot
      {...shared}
      events={events}
      title="Gas"
      unit="Ω"
      sensors={[sensors[1]]}
      series={[{ id: 'bme', label: 'BME', sensorId: 'bme690_01', metric: 'gas_resistance_ohm' }]}
      points={[point]}
    />,
  );
  assert.ok(html.includes('mean 500'));
  assert.ok(!html.includes('No valid readings'));
});
