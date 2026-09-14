import { ReportsFeed } from '@/components/reports-feed';
import { siteContext } from '@/lib/domain/sites';
import { loadReports } from '@/lib/domain/reports';
import { Shell } from '@/components/shell';
import { CreateSite } from '@/components/create-site';
import { ReportButton } from '@/components/report-form';
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; before?: string }>;
}) {
  const params = await searchParams;
  const { db, site, sites } = await siteContext(params.site);
  if (!site)
    return (
      <Shell>
        <CreateSite />
      </Shell>
    );
  const before =
    params.before && Number.isFinite(Date.parse(params.before)) ? params.before : undefined;
  const [result] = await Promise.allSettled([loadReports(db, site.id, 50, before)]);
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
        key={`${site.id}:${before || ''}`}
        initial={reports}
        initialError={initialError}
        siteId={site.id}
        timezone={site.timezone}
        before={before}
      />
    </Shell>
  );
}
