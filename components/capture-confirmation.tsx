'use client';
import { useActionState } from 'react';
import { confirmCapture } from '@/app/captures/actions';
import type { ActionResult } from '@/lib/domain/types';

const labels = {
  same_throughout: 'Same throughout',
  changed: 'Changed',
  unsure: 'Unsure',
} as const;

export function CaptureConfirmation({
  sessionId,
  value,
}: {
  sessionId: string;
  value: keyof typeof labels | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(confirmCapture, {});
  if (value)
    return (
      <p className="capture-confirmed">
        <span>After capture</span>
        <strong>{labels[value]}</strong>
      </p>
    );
  if (state.message) return <p className="success">{state.message}</p>;
  return (
    <form action={action} className="capture-after-confirmation">
      <input type="hidden" name="session_id" value={sessionId} />
      <div>
        <strong>Was the odour the same throughout?</strong>
        <span className="muted">Optional. Unanswered remains unconfirmed.</span>
      </div>
      <div className="capture-confirmation-options">
        {Object.entries(labels).map(([value, label]) => (
          <button
            className="secondary"
            name="confirmation"
            value={value}
            disabled={pending}
            key={value}
          >
            {label}
          </button>
        ))}
      </div>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
