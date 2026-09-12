import { ContextToggles } from '@/components/context-toggles';
import { requestTime } from '@/lib/domain/time';
import { RecentReports } from '@/components/recent-reports';
import { ReportButton } from '@/components/report-form';
import { Shell } from '@/components/shell';
import { LiveReading } from '@/components/live-reading';
import { ReadingChart } from '@/components/reading-chart';
import { demoData } from '@/lib/domain/demo';
export const dynamic = 'force-dynamic';
export default async function Demo() {
  const now = await requestTime();
  const { site, readings, reports, events } = demoData(now);
  return (
    <Shell site={site} demo>
      <div style={{ padding: '24px 0' }}>
        <p className="eyebrow">{site.name}</p>
        <h1>A little more clarity.</h1>
        <p className="muted">Your air, measured. Your experience, recorded.</p>
      </div>
      <LiveReading reading={readings.at(-1)!} initialNow={now} demo />
      <ReadingChart
        readings={readings}
        timezone={site.timezone}
        start={now - 24 * 3600000}
        end={now}
      />
      <ContextToggles siteId="demo" userId="demo-user" events={events} demo />
      <ReportButton siteId="demo" demo />
      <RecentReports reports={reports} timezone={site.timezone} />
    </Shell>
  );
}
