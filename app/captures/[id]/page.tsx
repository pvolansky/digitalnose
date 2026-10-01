import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { siteContext } from '@/lib/domain/sites';
import {
  captureOdour,
  type CaptureAnnotation,
  type CaptureConfiguration,
  type CaptureMeasurement,
  type CaptureSession,
} from '@/lib/captures/types';
import { CaptureMeasurements } from '@/components/capture-detail';
import { CaptureConfirmation } from '@/components/capture-confirmation';

export default async function CaptureDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ site?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { db, site, sites, role } = await siteContext(query.site);
  if (!site) notFound();
  const sessionResult = await db
    .from('capture_sessions')
    .select('*')
    .eq('id', id)
    .eq('site_id', site.id)
    .maybeSingle();
  if (sessionResult.error || !sessionResult.data) notFound();
  const session = sessionResult.data as CaptureSession;
  const [configurationResult, measurementsResult, shutdownResult, annotationsResult] =
    await Promise.all([
      db.from('capture_configurations').select('*').eq('id', session.configuration_id).single(),
      db
        .from('capture_measurements')
        .select('*')
        .eq('session_id', id)
        .order('acquired_at')
        .order('sequence_number'),
      db.from('capture_shutdown_outcomes').select('*').eq('session_id', id).order('sensor_key'),
      db.from('capture_annotations').select('*').eq('session_id', id).order('observed_at'),
    ]);
  if (
    configurationResult.error ||
    measurementsResult.error ||
    shutdownResult.error ||
    annotationsResult.error
  ) {
    throw new Error('Unable to load capture details.');
  }
  const configuration = configurationResult.data as CaptureConfiguration;
  const measurements = (measurementsResult.data || []) as CaptureMeasurement[];
  const annotations = (annotationsResult.data || []) as CaptureAnnotation[];
  const valid = measurements.filter((row) => row.validity.valid === true).length;
  const duration =
    session.device_started_at && session.completed_at
      ? Math.max(
          0,
          Math.round(
            (Date.parse(session.completed_at) - Date.parse(session.device_started_at)) / 1000,
          ),
        )
      : session.requested_duration_seconds;
  return (
    <Shell site={site} sites={sites}>
      <div className="capture-report-heading">
        <Link className="capture-back" href={`/captures?site=${site.id}`}>
          ← Captures
        </Link>
        <div className="row spread">
          <div>
            <p className="eyebrow">Capture report</p>
            <h1>{captureOdour(session)}</h1>
          </div>
          <span className={`capture-status ${session.status}`}>{session.status}</span>
        </div>
        <p className="capture-report-meta">
          {new Intl.DateTimeFormat('en-GB', {
            timeZone: site.timezone,
            dateStyle: 'full',
            timeStyle: 'short',
          }).format(new Date(session.requested_at))}
          {' · '}
          {duration} sec{' · '}
          {valid} of {measurements.length} valid samples
        </p>
      </div>
      <div className="capture-label-summary">
        <span>
          <small>Purpose</small>
          <strong>
            {session.purpose === 'commissioning_test'
              ? 'Commissioning / test'
              : session.purpose === 'observation'
                ? 'Observation'
                : 'Historical label'}
          </strong>
        </span>
        {session.suspected_source && (
          <span>
            <small>Suspected source</small>
            <strong>{session.suspected_source}</strong>
          </span>
        )}
        {session.episode_id && (
          <span>
            <small>Episode</small>
            <strong>{session.episode_id.slice(0, 8)}</strong>
          </span>
        )}
        <span>
          <small>Initial label</small>
          <strong>
            {session.observed_odour ? captureOdour(session) : `${captureOdour(session)} (legacy)`}
          </strong>
        </span>
      </div>
      {session.notes && <p className="capture-report-note">“{session.notes}”</p>}
      {annotations.length > 0 && (
        <div className="capture-annotations">
          <strong>During capture</strong>
          {annotations.map((annotation) => (
            <span key={annotation.id}>
              <time dateTime={annotation.observed_at}>
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: site.timezone,
                  timeStyle: 'medium',
                }).format(new Date(annotation.observed_at))}
              </time>
              {annotation.kind === 'smell_gone' ? 'Smell gone' : 'Smell changed'}
            </span>
          ))}
        </div>
      )}
      {role === 'owner' &&
        session.observed_odour &&
        ['completed', 'cancelled', 'failed'].includes(session.status) && (
          <CaptureConfirmation sessionId={session.id} value={session.persistence_confirmation} />
        )}
      <CaptureMeasurements
        measurements={measurements}
        exportData={{
          exported_at: new Date().toISOString(),
          session,
          immutable_configuration: configuration,
          measurements,
          shutdown_outcomes: shutdownResult.data || [],
          annotations,
          labelling: {
            purpose: session.purpose,
            observed_odour: session.observed_odour,
            suspected_source: session.suspected_source,
            intensity: session.intensity,
            episode_id: session.episode_id,
            persistence_confirmation: session.persistence_confirmation,
            persistence_confirmed_at: session.persistence_confirmed_at,
          },
        }}
      />
    </Shell>
  );
}
