import { Shell } from '@/components/shell';
import { ReportsFeed } from '@/components/reports-feed';
import { journalDay } from '@/lib/domain/journal';
import { ReportButton } from '@/components/report-form';
import { demoData } from '@/lib/domain/demo';
import { requestTime } from '@/lib/domain/time';
export const dynamic = 'force-dynamic';
export default async function DemoJournal() {
  const now = await requestTime();
  const { site, reports, weather } = demoData(now);
  return (
    <Shell site={site} demo>
      <div className="row spread page-heading">
        <div>
          <p className="eyebrow">{site.name}</p>
          <h1>Smell journal.</h1>
          <p className="muted">Example observations from fictional residents.</p>
        </div>
        <ReportButton siteId="demo" demo />
      </div>
      <ReportsFeed
        initial={reports}
        siteId={site.id}
        siteName={site.name}
        timezone={site.timezone}
        today={journalDay(now, site.timezone)}
        demoWeather={weather.history}
        demo
      />
    </Shell>
  );
}
