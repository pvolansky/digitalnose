import assert from 'node:assert/strict';
import test from 'node:test';
import { airQualityRating } from '../lib/domain/air-quality';

test('eCO2 categories cover sensor boundaries without implying safety outside the range', () => {
  for (const [value, label] of [
    [399, 'Outside sensor range'],
    [400, 'Excellent'],
    [599, 'Excellent'],
    [600, 'Good'],
    [800, 'Fair'],
    [1000, 'Poor'],
    [1500, 'Poor'],
    [1501, 'Bad'],
    [65000, 'Bad'],
    [65001, 'Outside sensor range'],
  ] as const) {
    assert.equal(airQualityRating('eco2_mean', value).label, label);
  }
});
test('AQI uses the five sensor categories and rejects invalid indices', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((value) => airQualityRating('aqi_max', value).tone),
    ['green', 'teal', 'amber', 'orange', 'red'],
  );
  for (const value of [0, 6, 2.5]) assert.equal(airQualityRating('aqi_max', value).tone, 'neutral');
});
test('missing, stale and TVOC readings never receive a risk colour', () => {
  for (const metric of ['eco2_mean', 'aqi_max', 'tvoc_mean'] as const) {
    for (const value of [null, undefined, NaN, Infinity])
      assert.equal(airQualityRating(metric, value).tone, 'neutral');
    assert.equal(airQualityRating(metric, 2, true).label, 'Out of date');
  }
  for (const value of [0, 500, 30000])
    assert.equal(airQualityRating('tvoc_mean', value).tone, 'neutral');
});
