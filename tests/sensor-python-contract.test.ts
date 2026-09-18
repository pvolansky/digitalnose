import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateSensorPayload } from '../lib/sensors/contract';

test('Python physical adapters emit observations accepted by the unchanged API contract', () => {
  const result = spawnSync(
    'python3',
    ['-c', 'import json; from test_phase2 import contract_samples; print(json.dumps(contract_samples()))'],
    { cwd: 'edge/raspberry-pi', encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const payloads = JSON.parse(result.stdout);
  assert.equal(payloads.length, 6);
  for (const payload of payloads) {
    const validated = validateSensorPayload(payload);
    assert.deepEqual(validated, payload);
  }
  assert.equal(payloads[0].readings.pressure_pa, 101325);
  assert.equal(payloads[1].status, 'warming_up');
  assert.equal(payloads[1].readings.raw_nox_ticks, undefined);
  assert.equal(payloads[2].readings.raw_nox_ticks, 3333);
  assert.equal(payloads[3].readings.number_pm0_5_cm3, 5);
});
