import { Shell } from '@/components/shell';
import { RecentReports } from '@/components/recent-reports';
import { ReportButton } from '@/components/report-form';
import { demoData } from '@/lib/domain/demo';
import { requestTime } from '@/lib/domain/time';
export const dynamic = 'force-dynamic';
export default async function DemoJournal() {
  const { site, reports } = demoData(await requestTime());
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
      <RecentReports compact reports={reports} timezone={site.timezone} />
    </Shell>
  );
}
