import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase IV keeps manual capture controls owner-gated on Captures and preserves ENS160', () => {
  const dashboard = readFileSync('app/dashboard/page.tsx', 'utf8');
  const captures = readFileSync('app/captures/page.tsx', 'utf8');
  assert.doesNotMatch(dashboard, /<CapturePanel/);
  assert.match(captures, /role === 'owner'/);
  assert.match(captures, /<CapturePanel/);
  assert.match(captures, /captureResult\?\.configuration \|\| null/);
  assert.match(dashboard, /<Overview/);
  assert.match(dashboard, /<ReportButton/);
  const overview = readFileSync('components/overview.tsx', 'utf8');
  assert.doesNotMatch(overview, /LiveSensorAnalysis|Sensor detail|showParticulate/);
  assert.match(overview, /recentReports\.slice\(0, 3\)/);
  const chart = readFileSync('components/reading-chart.tsx', 'utf8');
  for (const text of [
    'ENS160',
    'TVOC',
    'eCO₂',
    'AQI',
    'Consolidated',
    'Sensor reading',
    'Window open',
    'Window closed',
    'Resident in the room',
    'Smell report',
    'Wind',
  ])
    assert.ok(chart.includes(text), text);
});

test('capture confirmation exposes required labels, optional details and explicit acknowledgement copy', () => {
  const panel = readFileSync('components/capture-panel.tsx', 'utf8');
  const types = readFileSync('lib/captures/types.ts', 'utf8');
  for (const text of ['Smell present', 'Low odour', 'Other']) assert.ok(types.includes(text), text);
  for (const text of [
    'Record intensity',
    'Notes',
    'Purpose',
    'Odour observed',
    'Suspected source',
    'Episode',
    'Smell changed',
    'Smell gone',
    'Confirm and request capture',
    'Recording appears only after the device acknowledges acquisition',
  ])
    assert.ok(panel.includes(text), text);
  assert.match(panel, /showModal/);
  assert.match(panel, /Cancel request/);
  assert.match(panel, /useState\(3\)/);
  assert.match(panel, /type="range"/);
  assert.match(panel, /min="1"/);
  assert.match(panel, /max="5"/);
  const confirmation = readFileSync('components/capture-confirmation.tsx', 'utf8');
  for (const text of ['Same throughout', 'Changed', 'Unsure', 'Unanswered remains unconfirmed'])
    assert.ok(confirmation.includes(text), text);
});

test('capture report separates heater steps and exports the complete immutable session', () => {
  const detail = readFileSync('components/capture-detail.tsx', 'utf8');
  const page = readFileSync('app/captures/[id]/page.tsx', 'utf8');
  assert.match(detail, /heater_step_index === step/);
  assert.match(detail, /sort\(\(a, b\) => a - b\)/);
  assert.match(detail, /heater_target_temperature_c/);
  assert.match(detail, /JSON\.stringify\(exportData/);
  assert.match(page, /immutable_configuration: configuration/);
  assert.match(page, /measurements,\s*shutdown_outcomes:/);
  assert.match(page, /annotations,/);
  assert.match(page, /persistence_confirmation/);
  assert.match(detail, /row\.phase === 'recording'/);
  assert.match(detail, /Include startup/);
});
