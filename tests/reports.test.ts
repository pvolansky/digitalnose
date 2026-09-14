import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport } from '../lib/domain/reports';
test('requires an intensity and validates optional report labels', () => {
  const f = new FormData();
  assert.throws(() => validateReport(f));
  f.set('intensity', '4');
  assert.deepEqual(validateReport(f), { intensity: 4, note: null, smell_type: null });
  f.set('note', 'x'.repeat(1001));
  assert.throws(() => validateReport(f));
  f.set('note', 'fine');
  f.set('smell_type', 'invented');
  assert.throws(() => validateReport(f));
});

test('historical reports preserve occurrence time and reject invalid or future timestamps', () => {
  const form = new FormData();
  form.set('intensity', '3');
  const now = Date.parse('2026-09-14T12:00:00.000Z');
  form.set('reported_at', '2026-09-12T08:30:00.000Z');
  assert.equal(validateReport(form, now).reported_at, '2026-09-12T08:30:00.000Z');
  for (const value of ['invalid', '2026-09-15T08:30:00.000Z']) {
    form.set('reported_at', value);
    assert.throws(() => validateReport(form, now));
  }
});
