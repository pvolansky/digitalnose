import { Overview } from '@/components/overview';
import { requestTime } from '@/lib/domain/time';
import { ReportButton } from '@/components/report-form';
import { Shell } from '@/components/shell';
import { demoData } from '@/lib/domain/demo';
export const dynamic = 'force-dynamic';
export default async function Demo() {
  const now = await requestTime();
  const { site, device, readings, reports, events, weather } = demoData(now);
  return (
    <Shell site={site} demo>
      <div className="row spread page-heading">
        <div>
          <p className="eyebrow">{site.name}</p>
          <h1>Your air, in context.</h1>
          <p className="muted">
            See how your surroundings and observations line up with the readings.
          </p>
        </div>
        <ReportButton siteId="demo" demo />
      </div>
      <Overview
        initial={{
          now,
          lastSeenAt: device.last_seen_at,
          weather,
          readings,
          latest: readings.at(-1)!,
          events,
          currentEvents: events,
          reports,
          recentReports: reports,
        }}
        site={site}
        userId="demo-user"
        device={device}
        range="24H"
        demo
      />
    </Shell>
  );
}
