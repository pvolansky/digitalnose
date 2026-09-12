import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function harness(session: object | null) {
  let reads = 0;
  let redirected = '';
  let work: () => Promise<void> = async () => {};
  let authEvent: (event: string) => void = () => {};
  let cleanup: () => void = () => {};
  let cancelled = false;
  const exports: { useLiveData?: (initial: object, load: () => Promise<object>) => void } = {};
  const source = ts.transpileModule(readFileSync('components/use-live-data.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      if (name === 'react')
        return {
          useState: (initial: unknown) => [initial, () => {}],
          useRef: (current: unknown) => ({ current }),
          useEffect: (effect: () => () => void) => {
            cleanup = effect();
          },
          useCallback: (callback: unknown) => callback,
        };
      if (name === 'next/navigation')
        return {
          useRouter: () => ({
            replace: (url: string) => {
              redirected = url;
            },
          }),
        };
      if (name === '@/lib/supabase/client')
        return {
          browserClient: () => ({
            auth: {
              getSession: async () => ({ data: { session }, error: null }),
              onAuthStateChange: (callback: typeof authEvent) => {
                authEvent = callback;
                return { data: { subscription: { unsubscribe: () => {} } } };
              },
            },
          }),
        };
      if (name === '@/lib/domain/refresh-queue')
        return {
          createRefreshQueue: (callback: typeof work) => {
            work = callback;
            return {
              request: () => {},
              dispose: () => {
                cancelled = true;
              },
            };
          },
        };
      throw new Error(name);
    },
  });
  exports.useLiveData!({}, async () => {
    reads++;
    return {};
  });
  return {
    refresh: () => work(),
    signOut: () => authEvent('SIGNED_OUT'),
    cleanup: () => cleanup(),
    result: () => ({ reads, redirected, cancelled }),
  };
}
test('missing sessions redirect before any private data queries', async () => {
  const h = harness(null);
  await h.refresh();
  assert.deepEqual(h.result(), { reads: 0, redirected: '/login?session=expired', cancelled: true });
});
test('authenticated refresh works and sign-out prevents all later refreshes', async () => {
  const h = harness({ access_token: 'test' });
  await h.refresh();
  assert.equal(h.result().reads, 1);
  h.signOut();
  await h.refresh();
  assert.equal(h.result().reads, 1);
  assert.equal(h.result().cancelled, true);
});
