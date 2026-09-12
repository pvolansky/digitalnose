'use client';
import { useActionState, useRef, useState, useId } from 'react';
import { LuPlus, LuX, LuLoaderCircle } from 'react-icons/lu';
import { reportSmell } from '@/app/report/actions';
import { smellTypes } from '@/lib/domain/reports';
export function ReportForm({
  siteId,
  demo = false,
  onDone,
}: {
  siteId: string;
  demo?: boolean;
  onDone?: () => void;
}) {
  const [intensity, setIntensity] = useState('');
  const [smellType, setSmellType] = useState('');
  const [note, setNote] = useState('');
  const [state, action, pending] = useActionState(
    async (previous: import('@/lib/domain/types').ActionResult, form: FormData) => {
      try {
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
      className="stack"
    >
      <input name="site_id" value={siteId} type="hidden" />
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend style={{ marginBottom: 14 }}>How strong is it?</legend>
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
        <div className="row spread muted" style={{ fontSize: 12 }}>
          <span>Faint</span>
          <span>Very strong</span>
        </div>
      </fieldset>
      <div>
        <label htmlFor="smell_type">
          Type <span className="muted">(optional)</span>
        </label>
        <select
          id="smell_type"
          name="smell_type"
          value={smellType}
          onChange={(e) => setSmellType(e.target.value)}
        >
          <option value="">Choose a type</option>
          {smellTypes.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="note">
          Note <span className="muted">(optional)</span>
        </label>
        <textarea
          id="note"
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
        <p className="muted">Demo only. Sign in to save observations.</p>
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
      <dialog ref={dialog} aria-labelledby={titleId}>
        <div className="row spread">
          <h2 id={titleId}>Record a smell</h2>
          <button
            className="secondary"
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
