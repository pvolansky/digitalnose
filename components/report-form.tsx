'use client';
import { useActionState, useRef, useState, useId } from 'react';
import { LuPlus, LuX, LuLoaderCircle } from 'react-icons/lu';
import { reportSmell } from '@/app/report/actions';
import { DateTimeField, localDateTime } from './date-time-field';
import { SelectField } from './select-field';
import { SmellTypeSelect } from './smell-type-select';
export function ReportForm({
  siteId,
  demo = false,
  onDone,
}: {
  siteId: string;
  demo?: boolean;
  onDone?: () => void;
}) {
  const fieldId = useId();
  const [intensity, setIntensity] = useState('');
  const [smellType, setSmellType] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('now');
  const [occurredAt, setOccurredAt] = useState('');
  const [zone, setZone] = useState('');
  const [state, action, pending] = useActionState(
    async (previous: import('@/lib/domain/types').ActionResult, form: FormData) => {
      try {
        if (when === 'earlier') {
          const date = new Date(occurredAt);
          if (!Number.isFinite(date.getTime())) return { error: 'Choose a valid date and time.' };
          if (
            date.getHours() !== Number(occurredAt.slice(11, 13)) ||
            date.getDate() !== Number(occurredAt.slice(8, 10))
          )
            return { error: 'This local time does not exist. Choose another time.' };
          form.set('reported_at', date.toISOString());
        }
        const result = await reportSmell(previous, form);
        if (result.message) window.dispatchEvent(new Event('digitalnose:updated'));
        return result;
      } catch {
        return {
          error:
            'We could not confirm the save. Check your reports before trying again. Your note is still here.',
        };
      }
    },
    {},
  );
  if (state.message)
    return (
      <div className="stack">
        <p role="status" className="success">
          {state.message}
        </p>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
    );
  return (
    <form
      action={demo ? undefined : action}
      onSubmit={demo ? (e) => e.preventDefault() : undefined}
      className="stack report-fields"
    >
      <input name="site_id" value={siteId} type="hidden" />
      <div>
        <label id={`${fieldId}-when-label`} htmlFor={`${fieldId}-when`}>
          When did you notice it?
        </label>
        <SelectField
          id={`${fieldId}-when`}
          value={when}
          options={[
            { value: 'now', label: 'Now' },
            { value: 'earlier', label: 'Earlier' },
          ]}
          onChange={(value) => {
            setWhen(value);
            if (value === 'earlier' && !occurredAt) setOccurredAt(localDateTime(Date.now()));
            setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
          }}
        />
        {when === 'earlier' && (
          <div className="report-observed-at">
            <DateTimeField label="Observation time" value={occurredAt} onChange={setOccurredAt} />
            <small className="muted">Your local time ({zone})</small>
          </div>
        )}
      </div>
      <fieldset className="report-intensity">
        <legend>How strong is it?</legend>
        <div className="intensity">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input
                type="radio"
                name="intensity"
                value={n}
                checked={intensity === String(n)}
                onChange={(e) => setIntensity(e.target.value)}
                required
                aria-label={`${n} out of 5`}
              />
              <span>{n}</span>
            </label>
          ))}
        </div>
        <div className="row spread muted report-scale-labels">
          <span>Faint</span>
          <span>Very strong</span>
        </div>
      </fieldset>
      <div>
        <label id={`${fieldId}-type-label`} htmlFor={`${fieldId}-type`}>
          Type <span className="muted">(optional)</span>
        </label>
        <SmellTypeSelect id={`${fieldId}-type`} value={smellType} onChange={setSmellType} />
      </div>
      <div>
        <label htmlFor={`${fieldId}-note`}>
          Note <span className="muted">(optional)</span>
        </label>
        <textarea
          id={`${fieldId}-note`}
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Anything you noticed…"
        />
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
      {demo ? (
        <p className="muted report-demo-note">Demo only. Sign in to save observations.</p>
      ) : (
        <button disabled={pending}>
          {pending && <LuLoaderCircle className="spin" aria-hidden="true" />}
          {pending ? 'Saving…' : 'Report smell'}
        </button>
      )}
    </form>
  );
}
export function ReportButton({ siteId, demo = false }: { siteId: string; demo?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const titleId = useId();
  return (
    <>
      <button
        className="mobile-report"
        onClick={() => {
          setFormKey((k) => k + 1);
          dialog.current?.showModal();
        }}
        style={{ minWidth: 220, padding: '17px 26px' }}
      >
        <LuPlus aria-hidden="true" /> Report a smell
      </button>
      <dialog className="report-dialog" ref={dialog} aria-labelledby={titleId}>
        <div className="row spread report-dialog-heading">
          <h2 id={titleId}>Record a smell</h2>
          <button
            className="secondary report-close"
            aria-label="Close report form"
            onClick={() => dialog.current?.close()}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
        <ReportForm
          key={formKey}
          siteId={siteId}
          demo={demo}
          onDone={() => dialog.current?.close()}
        />
      </dialog>
    </>
  );
}
