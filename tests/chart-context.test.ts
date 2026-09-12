import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reportMarkers,
  weatherMarkers,
  weatherMarkerPosition,
  WIND_LABEL_WIDTH,
  WIND_LABEL_GAP,
} from '../lib/domain/chart-context';
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

test('wind labels never collide across bucket boundaries or clamped edges', () => {
  for (const hours of [6, 24, 168]) {
    const end = at + hours * 3600000;
    const weather = Array.from(
      { length: hours * 4 + 1 },
      (_, i) =>
        ({
          observed_at_utc: new Date(at + i * 15 * 60000).toISOString(),
        }) as WeatherObservation,
    );
    for (const width of [184, 320, 540, 980]) {
      const markers = weatherMarkers([...weather].reverse(), at, end, width);
      assert.equal(markers.at(-1), weather.at(-1));
      for (let i = 0; i < markers.length; i++) {
        assert.ok(weather.includes(markers[i]));
        const position = weatherMarkerPosition(
          Date.parse(markers[i].observed_at_utc),
          at,
          end,
          width,
        );
        assert.ok(position >= WIND_LABEL_WIDTH / 2 && position <= width - WIND_LABEL_WIDTH / 2);
        if (i) {
          const previous = weatherMarkerPosition(
            Date.parse(markers[i - 1].observed_at_utc),
            at,
            end,
            width,
          );
          assert.ok(position - previous >= WIND_LABEL_WIDTH + WIND_LABEL_GAP);
        }
      }
    }
  }
});
test('weather markers reject invalid ranges and timestamps', () => {
  const weather = [{ observed_at_utc: 'invalid' }] as WeatherObservation[];
  assert.deepEqual(weatherMarkers(weather, at, at + 3600000, 300), []);
  assert.deepEqual(weatherMarkers(weather, at, at, 300), []);
  assert.deepEqual(weatherMarkers(weather, at, at + 3600000, 0), []);
});
