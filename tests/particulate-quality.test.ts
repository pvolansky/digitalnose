import test from 'node:test';
import assert from 'node:assert/strict';
import { particulateRating } from '../lib/domain/particulate-quality';
test('instantaneous PM values never receive health colours', () => {
  for (const value of [0, 15, 35, 36, 54, 71, 500, null, undefined, NaN, -1])
    assert.equal(particulateRating(value).tone, 'neutral');
  assert.equal(particulateRating(35).label, 'Recent concentration');
});
