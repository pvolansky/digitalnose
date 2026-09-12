import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('environment template never contains credentials', () => {
  const env = readFileSync('.env.example', 'utf8');
  assert.ok(!env.includes('sb_secret_'));
  assert.ok(env.includes('DEVICE_KEY_PEPPER='));
});
