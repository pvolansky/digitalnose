import { ReportsFeed } from '@/components/reports-feed';
import { siteContext } from '@/lib/domain/sites';
import { loadJournal, journalDay } from '@/lib/domain/journal';
import { requestTime } from '@/lib/domain/time';
import { Shell } from '@/components/shell';
import { CreateSite } from '@/components/create-site';
import { ReportButton } from '@/components/report-form';
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const params = await searchParams;
  const { db, site, sites } = await siteContext(params.site);
  if (!site)
    return (
      <Shell>
        <CreateSite />
      </Shell>
    );
  const [result] = await Promise.allSettled([loadJournal(db, site.id)]);
  const initialError = result.status === 'rejected';
  const reports = result.status === 'fulfilled' ? result.value : [];
  return (
    <Shell site={site} sites={sites}>
      <div className="row spread page-heading">
        <div>
          <p className="eyebrow">{site.name}</p>
          <h1>Smell journal.</h1>
          <p className="muted">Resident observations</p>
        </div>
        <ReportButton siteId={site.id} />
      </div>
      <ReportsFeed
        key={site.id}
        initial={reports}
        initialError={initialError}
        siteId={site.id}
        siteName={site.name}
        timezone={site.timezone}
        today={journalDay(await requestTime(), site.timezone)}
      />
    </Shell>
  );
}
