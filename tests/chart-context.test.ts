import test from 'node:test';
import assert from 'node:assert/strict';
import { reportMarkers, weatherMarkers } from '../lib/domain/chart-context';
import type { SmellReport } from '../lib/domain/types';
import type { WeatherObservation } from '../lib/weather/types';
const at = Date.parse('2026-09-12T12:00:00Z');
const report = (id: string, seconds: number, intensity: number): SmellReport => ({
  id,
  site_id: 'site',
  user_id: id,
  reported_at: new Date(at + seconds * 1000).toISOString(),
  intensity,
  smell_type: 'Smoke',
  note: null,
});
test('overlapping reports from different people preserve every rating and timestamp', () => {
  const reports = [report('a', 0, 1), report('b', 10, 5), report('c', 1800, 3)];
  const groups = reportMarkers(reports, at, at + 3600000, 900);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].reports.map((r) => r.intensity),
    [1, 5],
  );
  assert.equal(groups[0].reports[1].reported_at, reports[1].reported_at);
  assert.equal(reportMarkers([report('outside', -1, 4)], at, at + 3600000, 900).length, 0);
});
test('weather display keeps actual observations and leaves empty time buckets empty', () => {
  const weather = [0, 15, 180].map(
    (minutes) =>
      ({
        observed_at_utc: new Date(at + minutes * 60000).toISOString(),
        wind_direction_deg: 225,
        wind_speed_kmh: 0,
      }) as WeatherObservation,
  );
  const markers = weatherMarkers(weather, at, at + 6 * 3600000, 540);
  assert.equal(markers.length, 2);
  assert.ok(markers.every((row) => weather.includes(row)));
  assert.equal(markers[1].observed_at_utc, weather[2].observed_at_utc);
  assert.deepEqual(weatherMarkers([], at, at + 3600000, 300), []);
});
