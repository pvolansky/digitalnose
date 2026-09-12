'use client';
import { useActionState } from 'react';
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
  const [state, submit, pending] = useActionState(manageSettings, {});
  return (
    <form action={submit} className="stack" style={{ marginBottom: 20 }}>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="site_id" value={siteId || ''} />
      {children}
      <div>
        <button
          className={action === 'revoke-key' || action === 'remove-resident' ? 'secondary' : ''}
          disabled={pending}
        >
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
      {state.key && (
        <div>
          <label htmlFor="new-key">Device API key</label>
          <input
            id="new-key"
            readOnly
            value={state.key}
            onFocus={(e) => e.target.select()}
            autoComplete="off"
          />
          <p className="muted">Store this in the Pi’s environment file. Keep it private.</p>
        </div>
      )}
    </form>
  );
}
