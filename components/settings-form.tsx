'use client';
import { startTransition, useActionState, useId, useState } from 'react';
import { LuCopy, LuCheck, LuLoaderCircle } from 'react-icons/lu';
import { unstable_rethrow } from 'next/navigation';
import type { ActionResult } from '@/lib/domain/types';
import { manageSettings } from '@/app/settings/actions';
export function SettingsForm({
  action,
  siteId,
  children,
  label = 'Save',
}: {
  action: string;
  siteId?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: ActionResult, data: FormData): Promise<ActionResult> => {
      try {
        return await manageSettings(previous, data);
      } catch (error) {
        unstable_rethrow(error);
        return {
          error:
            'We could not confirm this save. Your entries are still here. Check your connection and sign-in session before trying again.',
        };
      }
    },
    {},
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        // Dispatch explicitly so React does not reset edits to stale default values.
        startTransition(() => submit(data));
      }}
      className="stack"
      style={{ marginBottom: 20 }}
      aria-busy={pending}
    >
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="site_id" value={siteId || ''} />
      {children}
      <div>
        <button
          className={action === 'revoke-key' || action === 'remove-resident' ? 'secondary' : ''}
          disabled={pending}
        >
          {pending && <LuLoaderCircle className="spin" aria-hidden="true" />}
          {pending ? 'Saving…' : label}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="success">
          {state.message}
        </p>
      )}
      {state.key && <DeviceKey key={state.key} value={state.key} />}
    </form>
  );
}

function DeviceKey({ value }: { value: string }) {
  const id = useId();
  const [copyState, setCopyState] = useState('');
  return (
    <div className="key-result">
      <label htmlFor={id}>Device API key</label>
      <input
        id={id}
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopyState('Copied to clipboard.');
          } catch {
            setCopyState('Select the key above and copy it manually.');
          }
        }}
      >
        {copyState === 'Copied to clipboard.' ? (
          <LuCheck aria-hidden="true" />
        ) : (
          <LuCopy aria-hidden="true" />
        )}{' '}
        Copy key
      </button>
      {copyState && (
        <p role="status" className="muted">
          {copyState}
        </p>
      )}
      <p className="muted">Store this in the Pi’s environment file. Keep it private.</p>
    </div>
  );
}
