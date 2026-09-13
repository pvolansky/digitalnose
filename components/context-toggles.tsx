'use client';
import { useState, useTransition } from 'react';
import { changeState } from '@/app/dashboard/actions';
import { currentState } from '@/lib/domain/site-state';
import type { StateEvent } from '@/lib/domain/types';
export function ContextToggles({
  siteId,
  canEdit = false,
  events,
  demo = false,
  onDemoChange,
}: {
  siteId: string;
  canEdit?: boolean;
  events: StateEvent[];
  demo?: boolean;
  onDemoChange?: (type: StateEvent['event_type'], value: boolean) => void;
}) {
  const current = currentState(events);
  const [demoState, setDemoState] = useState(current);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{
    baseline: StateEvent[];
    values: ReturnType<typeof currentState>;
  } | null>(null);
  const values = demo ? demoState : saved?.baseline === events ? saved.values : current;
  return (
    <section className="panel">
      <h2>What’s happening now</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        {canEdit
          ? 'Record window and room occupancy changes to compare with the chart.'
          : 'Room context is updated by the owner.'}
      </p>
      <div className="context-grid">
        {(['window_open', 'user_in_room'] as const).map((type) => (
          <div className="row spread" key={type}>
            <div>
              <p style={{ margin: '4px 0' }}>
                {type === 'window_open' ? 'Window open' : 'Resident in the room'}
              </p>
              <span className="muted" style={{ fontSize: 12 }}>
                {values[type] === undefined
                  ? 'Not recorded yet'
                  : type === 'window_open'
                    ? 'Shared site context'
                    : 'Room occupancy'}
              </span>
            </div>
            {canEdit ? (
              <button
                className="toggle"
                role="switch"
                aria-label={type === 'window_open' ? 'Window open' : 'Resident in the room'}
                aria-checked={values[type] === true}
                disabled={pending}
                onClick={() => {
                  if (demo) {
                    setDemoState({ ...values, [type]: !values[type] });
                    onDemoChange?.(type, !values[type]);
                    return;
                  }
                  startTransition(async () => {
                    setError('');
                    try {
                      const result = await changeState(siteId, type, !values[type]);
                      if (result.error) setError(result.error);
                      else {
                        setSaved({
                          baseline: events,
                          values: { ...values, [type]: !values[type] },
                        });
                        window.dispatchEvent(new Event('digitalnose:updated'));
                      }
                    } catch {
                      setError('Could not confirm the change. Please check your connection.');
                    }
                  });
                }}
              >
                <span />
              </button>
            ) : (
              <span className="tag">
                {values[type] === undefined
                  ? 'Not recorded'
                  : values[type]
                    ? type === 'window_open'
                      ? 'Open'
                      : 'Present'
                    : type === 'window_open'
                      ? 'Closed'
                      : 'Absent'}
              </span>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
