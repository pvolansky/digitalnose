import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
// Exercise the actual server action with Supabase and redirects stubbed; no emails are sent.
function action(
  auth: object,
  env: Record<string, string> = { NEXT_PUBLIC_APP_URL: 'https://example.test' },
) {
  const output = ts.transpileModule(readFileSync('app/login/actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: {
    authenticate?: (
      state: object,
      form: FormData,
    ) => Promise<{
      confirmationRequired?: boolean;
      existingAccount?: boolean;
      accountReady?: boolean;
      error?: string;
    }>;
  } = {};
  runInNewContext(output, {
    exports,
    process: { env },
    require: (name: string) => {
      if (name === '@/lib/supabase/server') return { serverClient: async () => ({ auth }) };
      if (name === 'next/navigation')
        return {
          redirect: (url: string) => {
            throw new Error(`redirect:${url}`);
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return (mode: string, confirmation = 'test-password') => {
    const form = new FormData();
    form.set('mode', mode);
    form.set('email', 'person@example.test');
    form.set('password', 'test-password');
    form.set('confirm_password', confirmation);
    return exports.authenticate!({}, form);
  };
}
test('signup without a session explicitly requires activation and sets the confirmation callback', async () => {
  let callback = '';
  const run = action({
    signUp: async (input: { options: { emailRedirectTo: string } }) => {
      callback = input.options.emailRedirectTo;
      return { data: { session: null }, error: null };
    },
  });
  assert.equal((await run('signup')).confirmationRequired, true);
  assert.equal(callback, 'https://example.test/auth/confirm');
});
test('unconfirmed login and successful resend show the activation step; failed resend is an error', async () => {
  assert.equal(
    (
      await action({
        signInWithPassword: async () => ({ error: { code: 'email_not_confirmed' } }),
      })('login')
    ).confirmationRequired,
    true,
  );
  assert.equal(
    (await action({ resend: async () => ({ error: null }) })('resend')).confirmationRequired,
    true,
  );
  const failed = await action({
    resend: async () => ({ error: { code: 'over_email_send_rate_limit' } }),
  })('resend');
  assert.ok(failed.error);
  assert.equal(failed.confirmationRequired, undefined);
});
test('authenticated signup stays on an account-ready screen and incorrect passwords do not claim activation is needed', async () => {
  assert.equal(
    (await action({ signUp: async () => ({ data: { session: {} }, error: null }) })('signup'))
      .accountReady,
    true,
  );
  assert.equal(
    (
      await action({
        signInWithPassword: async () => ({ error: { code: 'invalid_credentials' } }),
      })('login')
    ).confirmationRequired,
    false,
  );
});

test('duplicate signup responses direct users to sign in without claiming activation is required', async () => {
  for (const response of [
    { data: { session: null, user: { identities: [] } }, error: null },
    { data: { session: null, user: null }, error: { code: 'user_already_exists' } },
  ]) {
    const result = await action({ signUp: async () => response })('signup');
    assert.equal(result.existingAccount, true);
    assert.equal(result.confirmationRequired, undefined);
  }
});

test('signup rejects mismatched or missing confirmation before contacting Supabase', async () => {
  let calls = 0;
  const run = action({
    signUp: async () => {
      calls++;
      throw new Error('Should not sign up');
    },
  });
  for (const confirmation of ['', 'different-password']) {
    assert.match((await run('signup', confirmation)).error ?? '', /Passwords do not match/);
  }
  assert.equal(calls, 0);
});

test('email throttling never claims signup succeeded or an activation email was sent', async () => {
  const result = await action({
    signUp: async () => ({
      data: { session: null },
      error: { code: 'over_email_send_rate_limit' },
    }),
  })('signup');
  assert.match(result.error ?? '', /email limit has been reached/);
  assert.equal(result.confirmationRequired, undefined);
});

test('production APP_URL takes precedence for signup and resend callbacks', async () => {
  const callbacks: string[] = [];
  const capture = async (input: { options: { emailRedirectTo: string } }) => {
    callbacks.push(input.options.emailRedirectTo);
    return { data: { session: null }, error: null };
  };
  const run = action(
    { signUp: capture, resend: capture },
    {
      APP_URL: 'https://digitalnose.ai/',
      NEXT_PUBLIC_APP_URL: 'https://example.test',
    },
  );
  await run('signup');
  await run('resend');
  assert.deepEqual(callbacks, [
    'https://digitalnose.ai/auth/confirm',
    'https://digitalnose.ai/auth/confirm',
  ]);
});
