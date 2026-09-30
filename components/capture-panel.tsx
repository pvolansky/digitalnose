'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuCircleStop, LuLoaderCircle, LuPlay, LuX } from 'react-icons/lu';
import { requestCapture, stopCapture } from '@/app/captures/actions';
import type { CaptureConfiguration, CaptureSession } from '@/lib/captures/types';
import { captureLabel } from '@/lib/captures/types';
import type { ActionResult } from '@/lib/domain/types';

const statusText: Record<CaptureSession['status'], string> = {
  requested: 'Waiting for device',
  preparing: 'Preparing sensors',
  recording: 'Recording',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export function CapturePanel({
  siteId,
  deviceId,
  deviceReady,
  configuration,
  active,
}: {
  siteId: string;
  deviceId?: string;
  deviceReady: boolean;
  configuration: CaptureConfiguration | null;
  active: CaptureSession | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [label, setLabel] = useState<CaptureSession['label']>('smell_present');
  const [requestKey, setRequestKey] = useState('');
  const [state, action, pending] = useActionState<ActionResult, FormData>(requestCapture, {});
  const [stopState, stopAction, stopping] = useActionState<ActionResult, FormData>(stopCapture, {});
  const available = !!deviceId && !!configuration && !active;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return (
    <section className="capture-panel" aria-labelledby="capture-title">
      <div className="row spread">
        <h2 id="capture-title">Manual capture</h2>
        <span className={`capture-readiness ${available ? 'ready' : ''}`}>
          {deviceReady ? 'Device online' : 'Device offline'}
        </span>
      </div>
      {active ? (
        <div className="capture-active">
          <strong>{statusText[active.status]}</strong>
          <p>
            {captureLabel(active.label)} · up to{' '}
            {Math.round(active.requested_duration_seconds / 60)} minutes
          </p>
          <p className="muted">
            Recording appears only after the device acknowledges acquisition. Partial data is
            retained if stopped.
          </p>
          <form action={stopAction}>
            <input type="hidden" name="session_id" value={active.id} />
            <button className="secondary" disabled={stopping}>
              <LuCircleStop aria-hidden="true" />{' '}
              {stopping
                ? 'Sending request…'
                : active.status === 'requested'
                  ? 'Cancel request'
                  : 'Stop early'}
            </button>
          </form>
          {stopState.error && (
            <p className="error" role="alert">
              {stopState.error}
            </p>
          )}
        </div>
      ) : (
        <>
          {!configuration && (
            <p className="sync-notice" role="status">
              No verified capture configuration is enabled for this device. Pi settings must be
              audited before activation.
            </p>
          )}
          {!deviceReady && configuration && (
            <p className="sync-notice" role="status">
              The device is offline. You may queue one capture request; it remains requested until
              the device acknowledges it.
            </p>
          )}
          <button
            disabled={!available}
            onClick={() => {
              setRequestKey(crypto.randomUUID());
              dialog.current?.showModal();
            }}
          >
            <LuPlay aria-hidden="true" /> Start capture
          </button>
        </>
      )}
      <dialog className="report-dialog" ref={dialog} aria-labelledby={titleId}>
        <div className="row spread report-dialog-heading">
          <h2 id={titleId}>Confirm capture</h2>
          <button
            className="secondary report-close"
            aria-label="Close capture form"
            onClick={() => dialog.current?.close()}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
        <form action={action} className="stack report-fields">
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="device_id" value={deviceId || ''} />
          <input type="hidden" name="configuration_id" value={configuration?.id || ''} />
          <input type="hidden" name="request_key" value={requestKey} />
          <fieldset>
            <legend>Label</legend>
            {(['smell_present', 'low_odour', 'other'] as const).map((value) => (
              <label className="capture-label" key={value}>
                <input
                  type="radio"
                  name="label"
                  value={value}
                  checked={label === value}
                  onChange={() => setLabel(value)}
                />
                {captureLabel(value)}
              </label>
            ))}
          </fieldset>
          <label>
            Smell intensity <span className="muted">(optional)</span>
            <select name="intensity" defaultValue="">
              <option value="">Not recorded</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option value={n} key={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes <span className="muted">(optional)</span>
            <textarea name="notes" rows={3} maxLength={1000} />
          </label>
          <div className="capture-summary">
            <strong>{configuration?.version}</strong>
            <span>
              {Math.round((configuration?.duration_seconds || 120) / 60)} minute experimental
              capture
            </span>
            <span>
              {
                Object.keys(
                  (configuration?.snapshot.sensors as Record<string, unknown> | undefined) || {},
                ).length
              }{' '}
              configured sensors
            </span>
            <small>Configuration snapshot {configuration?.config_hash.slice(0, 12)}</small>
          </div>
          <p className="muted">
            Sensors prepare for about 2 minutes after device acknowledgement. The labelled
            2-minute recording begins after preparation; startup samples are retained separately.
          </p>
          {state.error && (
            <p className="error" role="alert">
              {state.error}
            </p>
          )}
          <button disabled={pending}>
            {pending && <LuLoaderCircle className="spin" aria-hidden="true" />}
            {pending ? 'Requesting…' : 'Confirm and request capture'}
          </button>
        </form>
      </dialog>
    </section>
  );
}
