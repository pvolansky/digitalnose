import test from 'node:test';
import assert from 'node:assert/strict';
import { particulateRating } from '../lib/domain/particulate-quality';

test('recent PM display bands preserve boundaries and do not label exposure as healthy', () => {
  for (const value of [null, undefined, NaN, Infinity, -1])
    assert.equal(particulateRating(value).tone, 'neutral');
  for (const [value, tone] of [
    [0, 'green'],
    [35.9, 'green'],
    [36, 'amber'],
    [53.9, 'amber'],
    [54, 'red'],
    [70.9, 'red'],
    [71, 'purple'],
  ] as const)
    assert.equal(particulateRating(value).tone, tone);
  assert.equal(particulateRating(0).label, 'Low reading');
});
