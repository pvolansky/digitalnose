import { loadOverview } from '@/lib/domain/overview';
import { Overview } from '@/components/overview';
import { requestTime } from '@/lib/domain/time';
import { ReportButton } from '@/components/report-form';
import Link from 'next/link';
import { siteContext } from '@/lib/domain/sites';
import { parseRange } from '@/lib/domain/readings';
import { Shell } from '@/components/shell';
import { CreateSite } from '@/components/create-site';
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; range?: string; device?: string }>;
}) {
  const params = await searchParams;
  const { db, user, site, sites, devices } = await siteContext(params.site);
  if (!site)
    return (
      <Shell>
        <CreateSite />
      </Shell>
    );
  const range = parseRange(params.range);
  const device = devices.find((d) => d.id === params.device) || devices[0];
  const now = await requestTime();
  const [result] = await Promise.allSettled([
    loadOverview(db, site.id, user.id, device?.id, range, now),
  ]);
  const initialError = result.status === 'rejected';
  const initial =
    result.status === 'fulfilled'
      ? result.value
      : {
          now,
          lastSeenAt: device?.last_seen_at ?? null,
          weather: { latest: null, history: [], unavailable: true },
          readings: [],
          latest: null,
          events: [],
          currentEvents: [],
          reports: [],
          recentReports: [],
        };
  return (
    <Shell site={site} sites={sites}>
      <div className="row spread page-heading">
        <div>
          <p className="eyebrow">{site.name}</p>
          <h1 style={{ margin: '14px 0' }}>Your air, in context.</h1>
          <p className="muted">
            See how your surroundings and observations line up with the readings.
          </p>
        </div>
        <div className="heading-actions">
          <ReportButton siteId={site.id} />
        </div>
      </div>
      {devices.length > 1 && (
        <div className="row">
          {devices.map((d) => (
            <Link
              key={d.id}
              className="tag"
              aria-current={d.id === device?.id ? 'page' : undefined}
              href={`/dashboard?site=${site.id}&device=${d.id}&range=${range}`}
            >
              {d.name}
            </Link>
          ))}
        </div>
      )}
      <Overview
        key={`${site.id}:${device?.id}:${range}`}
        initial={initial}
        initialError={initialError}
        site={site}
        userId={user.id}
        device={device}
        range={range}
      />
    </Shell>
  );
}
