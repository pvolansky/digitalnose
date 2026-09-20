import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { metricCatalogue, metricDescription, type SensorMetric } from '../lib/sensors/metric-info';
import { airQualityRating } from '../lib/domain/air-quality';
import { MetricInfo } from '../components/metric-info';

test('all sensor metrics have sourced structured explanations and units', () => {
  const displayed: SensorMetric[] = [
    'tvoc_mean',
    'eco2_mean',
    'aqi_max',
    'gas_resistance_ohm',
    'temperature_c',
    'humidity_pct',
    'pressure_pa',
    'raw_voc_ticks',
    'raw_nox_ticks',
    'pm1_ug_m3',
    'pm2_5_ug_m3',
    'pm4_ug_m3',
    'pm10_ug_m3',
  ];
  for (const key of displayed) {
    const m = metricCatalogue[key];
    for (const text of [
      m.label,
      m.unit,
      m.measures,
      m.interpretation,
      m.digitalNose,
      m.limitation,
      ...m.references,
    ])
      assert.ok(text.length);
    const html = renderToStaticMarkup(<MetricInfo metric={key} />);
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes('About '));
  }
});
test('raw signals have no absolute categories or concentration units', () => {
  for (const key of ['raw_voc_ticks', 'raw_nox_ticks', 'gas_resistance_ohm'] as const) {
    const m = metricCatalogue[key];
    assert.equal(m.classification, 'raw');
    assert.ok(!('reference' in m));
    assert.ok(!['ppb', 'ppm'].includes(m.unit));
    assert.ok(metricDescription(key).includes('Interpretation'));
  }
  // The ENS160 category API deliberately rejects raw sensor metrics at compile time.
  // Runtime callers also cannot obtain a health colour for these values.
  // @ts-expect-error raw VOC is not an ENS160 classification input
  assert.equal(airQualityRating('raw_voc_ticks', 13600).tone, 'neutral');
  // @ts-expect-error resistance is not an ENS160 classification input
  assert.equal(airQualityRating('gas_resistance_ohm', 30000).tone, 'neutral');
  assert.equal(metricCatalogue.raw_voc_ticks.unit, 'ticks');
  assert.ok(metricCatalogue.raw_voc_ticks.interpretation.includes('13,600'));
  assert.ok(metricCatalogue.raw_voc_ticks.interpretation.includes('no universal good/bad'));
});
test('PM guidance is explicitly time averaged and sourced', () => {
  assert.equal(metricCatalogue.pm2_5_ug_m3.reference.value, 15);
  assert.equal(metricCatalogue.pm10_ug_m3.reference.value, 45);
  for (const key of ['pm2_5_ug_m3', 'pm10_ug_m3'] as const) {
    assert.equal(metricCatalogue[key].reference.averagingPeriod, '24 hours');
    assert.equal(metricCatalogue[key].reference.provenance, 'WHO 2021 guideline');
  }
});
test('ENS160 manufacturer classifications retain their boundaries', () => {
  assert.equal(airQualityRating('eco2_mean', 599).label, 'Excellent');
  assert.equal(airQualityRating('eco2_mean', 600).label, 'Good');
  assert.equal(airQualityRating('eco2_mean', 800).label, 'Fair');
  assert.equal(airQualityRating('eco2_mean', 1000).label, 'Poor');
  assert.equal(airQualityRating('eco2_mean', 1501).label, 'Bad');
  assert.equal(airQualityRating('aqi_max', 5).label, 'Unhealthy');
  assert.equal(airQualityRating('tvoc_mean', 13600).tone, 'neutral');
});

// The component feeds its rendered panel dimensions into this placement function.
test('measured info panels fit mobile and short viewports', async () => {
  const { infoPosition } = await import('../lib/sensors/info-position');
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 320, height: 480 },
  ]) {
    for (const height of [180, 358, viewport.height - 32]) {
      const panel = { width: Math.min(300, viewport.width - 32), height };
      const p = infoPosition(
        { left: viewport.width - 30, bottom: viewport.height - 20 },
        panel,
        viewport,
      );
      assert.ok(p.left >= 16 && p.top >= 16);
      assert.ok(p.left + panel.width <= viewport.width - 16);
      assert.ok(p.top + panel.height <= viewport.height - 16);
    }
  }
});
