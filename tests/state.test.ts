import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentState } from '../lib/domain/site-state';
test('occupancy is shared; unrecorded state is unknown', () => {
  assert.deepEqual(currentState([]), {
    window_open: undefined,
    user_in_room: undefined,
    maintenance: undefined,
  });
  assert.equal(
    currentState([
      {
        id: '1',
        site_id: 's',
        user_id: 'b',
        event_type: 'user_in_room',
        value: true,
        recorded_at: '2026-01-01T00:00:00Z',
      },
    ]).user_in_room,
    true,
  );
});
