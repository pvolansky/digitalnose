import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationDestination, confirmationNotice } from '../lib/auth/confirmation';
const ok = {
  verifyOtp: async () => ({ error: null }),
  exchangeCodeForSession: async () => ({ error: null }),
};
test('token-hash and PKCE confirmation success reach the dashboard', async () => {
  assert.equal(
    await confirmationDestination(new URLSearchParams('token_hash=test'), ok),
    '/dashboard',
  );
  assert.equal(await confirmationDestination(new URLSearchParams('code=test'), ok), '/dashboard');
});
test('failed PKCE exchange offers password sign-in instead of declaring confirmation failed', async () => {
  const auth = {
    ...ok,
    exchangeCodeForSession: async () => ({ error: { code: 'bad_code_verifier' } }),
  };
  assert.equal(
    await confirmationDestination(new URLSearchParams('code=test'), auth),
    '/login?confirmation=signin',
  );
  assert.match(confirmationNotice('signin')!, /email may already be confirmed/);
});
test('expired, used and missing links have an actionable recovery message', async () => {
  const auth = { ...ok, verifyOtp: async () => ({ error: { code: 'otp_expired' } }) };
  assert.equal(
    await confirmationDestination(new URLSearchParams('token_hash=test'), auth),
    '/login?confirmation=expired',
  );
  assert.equal(
    await confirmationDestination(new URLSearchParams(), ok),
    '/login?confirmation=failed',
  );
  assert.match(confirmationNotice('failed')!, /already used/);
  assert.match(confirmationNotice('expired')!, /new confirmation email/);
  assert.equal(confirmationNotice('untrusted-value'), null);
});
