import Link from 'next/link';
import { Shell } from '@/components/shell';
import { siteContext } from '@/lib/domain/sites';
import { captureLabel, type CaptureSession } from '@/lib/captures/types';
import { CapturePanel } from '@/components/capture-panel';
import { loadCaptureOverview } from '@/lib/captures/read';
import { requestTime } from '@/lib/domain/time';

export default async function CapturesPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const params = await searchParams;
  const { db, site, sites, devices, role } = await siteContext(params.site);
  if (!site)
    return (
      <Shell>
        <p>Create a site before recording captures.</p>
      </Shell>
    );
  const device = devices[0];
  const now = await requestTime();
  const [sessionsResult, captureResult] = await Promise.all([
    db
      .from('capture_sessions')
      .select('*')
      .eq('site_id', site.id)
      .order('requested_at', { ascending: false }),
    role === 'owner'
      ? loadCaptureOverview(db, site.id, device?.id).catch(() => null)
      : Promise.resolve(null),
  ]);
  const { data, error } = sessionsResult;
  const sessions = (data || []) as CaptureSession[];
  return (
    <Shell site={site} sites={sites}>
      <div className="captures-heading">
        <div className="page-heading">
          <p className="eyebrow">{site.name}</p>
          <h1>Captures</h1>
        </div>
        {role === 'owner' && (
          <CapturePanel
            siteId={site.id}
            deviceId={device?.id}
            deviceReady={
              !!device?.last_seen_at && now - Date.parse(device.last_seen_at) <= 5 * 60_000
            }
            configuration={captureResult?.configuration || null}
            active={captureResult?.active || null}
          />
        )}
      </div>
      {error && (
        <p className="sync-notice" role="status">
          Capture storage is not active yet. The start control will become available after the Phase
          IV database and verified Pi configuration are installed.
        </p>
      )}
      <section className="capture-list" aria-label="Capture history">
        {sessions.length ? (
          <div className="capture-items">
            {sessions.map((session) => {
              const duration =
                session.device_started_at && session.completed_at
                  ? `${Math.max(0, Math.round((Date.parse(session.completed_at) - Date.parse(session.device_started_at)) / 1000))} sec`
                  : `${session.requested_duration_seconds} sec requested`;
              const label =
                session.label === 'other' ? 'Sensor capture' : captureLabel(session.label);
              return (
                <Link
                  className="capture-item"
                  href={`/captures/${session.id}?site=${site.id}`}
                  key={session.id}
                  aria-label={`Open ${label}`}
                >
                  <div className="capture-item-main">
                    <strong>{label}</strong>
                    <span>
                      {new Intl.DateTimeFormat('en-GB', {
                        timeZone: site.timezone,
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(session.requested_at))}
                    </span>
                  </div>
                  <span className="capture-item-detail">
                    {session.intensity ? `Intensity ${session.intensity} / 5` : 'No intensity'}
                  </span>
                  <span className="capture-item-detail">{duration}</span>
                  <span className={`capture-status ${session.status}`}>{session.status}</span>
                  <span className="capture-item-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="muted">No captures yet.</p>
        )}
      </section>
    </Shell>
  );
}
