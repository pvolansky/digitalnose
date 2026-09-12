import Link from 'next/link';
import {siteContext} from '@/lib/domain/sites';
import {loadReports} from '@/lib/domain/reports';
import {Shell} from '@/components/shell';
import {CreateSite} from '@/components/create-site';
import {ReportButton} from '@/components/report-form';
import {RecentReports} from '@/components/recent-reports';
export default async function Reports({searchParams}:{searchParams:Promise<{site?:string;before?:string}>}){const params=await searchParams;const {db,site,sites}=await siteContext(params.site);if(!site)return <Shell><CreateSite/></Shell>;const before=params.before&&Number.isFinite(Date.parse(params.before))?params.before:undefined;const reports=await loadReports(db,site.id,50,before);return <Shell site={site} sites={sites}><div className="row spread" style={{padding:'32px 0'}}><div><p className="eyebrow">{site.name}</p><h1>What you noticed.</h1><p className="muted">Resident observations · {site.timezone}</p></div><ReportButton siteId={site.id}/></div><RecentReports reports={reports} timezone={site.timezone}/>{reports.length===50&&<Link className="button secondary" href={`/report?site=${site.id}&before=${encodeURIComponent(reports.at(-1)!.reported_at)}`}>Older reports</Link>}{before&&<Link className="button secondary" href={`/report?site=${site.id}`}>Latest reports</Link>}</Shell>}
