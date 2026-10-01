'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuCircleStop, LuLoaderCircle, LuPlay, LuX } from 'react-icons/lu';
import { annotateCapture, requestCapture, stopCapture } from '@/app/captures/actions';
import type { CaptureConfiguration, CaptureSession } from '@/lib/captures/types';
import { captureOdour } from '@/lib/captures/types';
import type { ActionResult } from '@/lib/domain/types';
import { SelectField } from './select-field';

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
  episodes,
}: {
  siteId: string;
  deviceId?: string;
  deviceReady: boolean;
  configuration: CaptureConfiguration | null;
  active: CaptureSession | null;
  episodes: { id: string; label: string }[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [purpose, setPurpose] = useState('observation');
  const [odour, setOdour] = useState('restaurant_frying_oily');
  const [intensity, setIntensity] = useState(3);
  const [recordIntensity, setRecordIntensity] = useState(true);
  const [episode, setEpisode] = useState('');
  const [newEpisode, setNewEpisode] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [state, action, pending] = useActionState<ActionResult, FormData>(requestCapture, {});
  const [stopState, stopAction, stopping] = useActionState<ActionResult, FormData>(stopCapture, {});
  const [annotationState, annotationAction, annotating] = useActionState<ActionResult, FormData>(
    annotateCapture,
    {},
  );
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
            {captureOdour(active)} · up to {Math.round(active.requested_duration_seconds / 60)}{' '}
            minutes
          </p>
          <p className="muted">
            Recording appears only after the device acknowledges acquisition. Partial data is
            retained if stopped.
          </p>
          {['preparing', 'recording'].includes(active.status) && (
            <>
              <form action={annotationAction} className="capture-annotation-actions">
                <input type="hidden" name="session_id" value={active.id} />
                <button
                  className="secondary"
                  name="kind"
                  value="smell_changed"
                  disabled={annotating}
                >
                  Smell changed
                </button>
                <button className="secondary" name="kind" value="smell_gone" disabled={annotating}>
                  Smell gone
                </button>
              </form>
              {annotationState.message && <p className="success">{annotationState.message}</p>}
              {annotationState.error && <p className="error">{annotationState.error}</p>}
            </>
          )}
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
              setPurpose('observation');
              setOdour('restaurant_frying_oily');
              setIntensity(3);
              setRecordIntensity(true);
              setEpisode('');
              setNewEpisode(crypto.randomUUID());
              dialog.current?.showModal();
            }}
          >
            <LuPlay aria-hidden="true" /> Start capture
          </button>
        </>
      )}
      <dialog
        className="report-dialog capture-confirm-dialog"
        ref={dialog}
        aria-labelledby={titleId}
      >
        <div className="row spread report-dialog-heading">
          <div>
            <h2 id={titleId}>Confirm capture</h2>
            <p>Describe the observation without treating its source as verified.</p>
          </div>
          <button
            className="secondary report-close"
            aria-label="Close capture form"
            onClick={() => dialog.current?.close()}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
        <form action={action} className="stack report-fields capture-confirm-form">
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="device_id" value={deviceId || ''} />
          <input type="hidden" name="configuration_id" value={configuration?.id || ''} />
          <input type="hidden" name="request_key" value={requestKey} />
          <input type="hidden" name="episode_id" value={episode === 'new' ? newEpisode : episode} />
          <fieldset className="capture-label-field">
            <legend>Purpose</legend>
            <div className="capture-label-options capture-purpose-options">
              {[
                ['observation', 'Observation'],
                ['commissioning_test', 'Commissioning / test'],
              ].map(([value, text]) => (
                <label className="capture-label" key={value}>
                  <input
                    type="radio"
                    name="purpose"
                    value={value}
                    checked={purpose === value}
                    onChange={() => setPurpose(value)}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label id={`${titleId}-odour-label`} htmlFor={`${titleId}-odour`}>
              Odour observed
            </label>
            <SelectField
              id={`${titleId}-odour`}
              name="observed_odour"
              value={odour}
              onChange={setOdour}
              options={[
                { value: 'restaurant_frying_oily', label: 'Restaurant-like frying / oily odour' },
                { value: 'other_odour', label: 'Other odour' },
                { value: 'no_noticeable_odour', label: 'No noticeable odour' },
                { value: 'unsure_mixed', label: 'Unsure / mixed' },
              ]}
            />
          </div>
          <div className="capture-intensity-field">
            <div className="capture-field-heading">
              <label className="capture-optional-toggle">
                <input
                  type="checkbox"
                  checked={recordIntensity}
                  onChange={(event) => setRecordIntensity(event.target.checked)}
                />
                Record intensity
              </label>
              {recordIntensity && <output htmlFor={`${titleId}-intensity`}>{intensity} / 5</output>}
            </div>
            {recordIntensity && (
              <>
                <input
                  id={`${titleId}-intensity`}
                  name="intensity"
                  type="range"
                  min="0"
                  max="5"
                  step="1"
                  value={intensity}
                  onChange={(event) => setIntensity(Number(event.target.value))}
                  aria-valuetext={`${intensity} out of 5`}
                />
                <div className="capture-intensity-scale" aria-hidden="true">
                  <span>0</span>
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </>
            )}
          </div>
          <div>
            <label htmlFor={`${titleId}-source`}>
              Suspected source <span className="muted">(optional)</span>
            </label>
            <input
              id={`${titleId}-source`}
              name="suspected_source"
              maxLength={200}
              placeholder="Your observation, not a verified source"
            />
          </div>
          <div>
            <label id={`${titleId}-episode-label`} htmlFor={`${titleId}-episode`}>
              Episode <span className="muted">(optional)</span>
            </label>
            <SelectField
              id={`${titleId}-episode`}
              value={episode}
              onChange={setEpisode}
              placeholder="No episode"
              options={[
                { value: '', label: 'No episode' },
                { value: 'new', label: 'Start new episode' },
                ...episodes.map((item) => ({ value: item.id, label: item.label })),
              ]}
            />
          </div>
          <div>
            <label htmlFor={`${titleId}-notes`}>
              Notes <span className="muted">(optional)</span>
            </label>
            <textarea
              id={`${titleId}-notes`}
              name="notes"
              rows={3}
              maxLength={1000}
              placeholder="Anything useful about this capture…"
            />
          </div>
          <div className="capture-summary">
            <div>
              <span>Recording</span>
              <strong>{Math.round((configuration?.duration_seconds || 120) / 60)} min</strong>
            </div>
            <div>
              <span>Preparation</span>
              <strong>About 2 min</strong>
            </div>
            <div>
              <span>Sensors</span>
              <strong>
                {
                  Object.keys(
                    (configuration?.snapshot.sensors as Record<string, unknown> | undefined) || {},
                  ).length
                }
              </strong>
            </div>
          </div>
          {state.error && (
            <p className="error" role="alert">
              {state.error}
            </p>
          )}
          <button className="capture-confirm-submit" disabled={pending}>
            {pending && <LuLoaderCircle className="spin" aria-hidden="true" />}
            {pending ? 'Requesting…' : 'Confirm and request capture'}
          </button>
        </form>
      </dialog>
    </section>
  );
}
