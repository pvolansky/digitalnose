import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { siteContext } from '@/lib/domain/sites';
import {
  captureLabel,
  type CaptureConfiguration,
  type CaptureMeasurement,
  type CaptureSession,
} from '@/lib/captures/types';
import { CaptureMeasurements } from '@/components/capture-detail';

export default async function CaptureDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ site?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { db, site, sites } = await siteContext(query.site);
  if (!site) notFound();
  const sessionResult = await db
    .from('capture_sessions')
    .select('*')
    .eq('id', id)
    .eq('site_id', site.id)
    .maybeSingle();
  if (sessionResult.error || !sessionResult.data) notFound();
  const session = sessionResult.data as CaptureSession;
  const [configurationResult, measurementsResult, shutdownResult] = await Promise.all([
    db.from('capture_configurations').select('*').eq('id', session.configuration_id).single(),
    db
      .from('capture_measurements')
      .select('*')
      .eq('session_id', id)
      .order('acquired_at')
      .order('sequence_number'),
    db.from('capture_shutdown_outcomes').select('*').eq('session_id', id).order('sensor_key'),
  ]);
  if (configurationResult.error || measurementsResult.error || shutdownResult.error)
    throw new Error('Unable to load capture details.');
  const configuration = configurationResult.data as CaptureConfiguration;
  const measurements = (measurementsResult.data || []) as CaptureMeasurement[];
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
            <h1>{session.label === 'other' ? 'Sensor capture' : captureLabel(session.label)}</h1>
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
      {session.notes && <p className="capture-report-note">“{session.notes}”</p>}
      <CaptureMeasurements
        measurements={measurements}
        exportData={{
          exported_at: new Date().toISOString(),
          session,
          immutable_configuration: configuration,
          measurements,
          shutdown_outcomes: shutdownResult.data || [],
        }}
      />
    </Shell>
  );
}
