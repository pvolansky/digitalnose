import {loadState} from '@/lib/domain/site-state';
import {ContextToggles} from '@/components/context-toggles';
import {requestTime} from '@/lib/domain/time';
import {loadReports} from '@/lib/domain/reports';
import {RecentReports} from '@/components/recent-reports';
import {ReportButton} from '@/components/report-form';
import Link from 'next/link';
import {siteContext} from '@/lib/domain/sites';
import {loadReadings,loadLatestReading,parseRange,ranges} from '@/lib/domain/readings';
import {Shell} from '@/components/shell';
import {CreateSite} from '@/components/create-site';
import {LiveReading} from '@/components/live-reading';
import {ReadingChart} from '@/components/reading-chart';
export default async function Dashboard({searchParams}:{searchParams:Promise<{site?:string;range?:string;device?:string}>}){
 const params=await searchParams;const {db,user,site,sites,devices}=await siteContext(params.site);
 if(!site)return <Shell><CreateSite/></Shell>;
 const range=parseRange(params.range);const device=devices.find(d=>d.id===params.device)||devices[0];const now=await requestTime();
 const [readings,latest]=device?await Promise.all([loadReadings(db,device.id,range,now),loadLatestReading(db,device.id)]):[[],null];
 const [reports,events]=await Promise.all([loadReports(db,site.id),loadState(db,site.id,user.id)]);
 return <Shell site={site} sites={sites}><div className="row spread" style={{padding:'32px 0'}}><div><p className="eyebrow">{site.name}</p><h1 style={{margin:'14px 0'}}>A little more clarity.</h1><p className="muted">Your air, measured. Your experience, recorded.</p></div><span className="tag">{site.continuous_ventilation?'Continuous ventilation':'Ventilation not continuous'}</span></div>{devices.length>1&&<div className="row">{devices.map(d=><Link key={d.id} className="tag" aria-current={d.id===device?.id?'page':undefined} href={`/dashboard?site=${site.id}&device=${d.id}&range=${range}`}>{d.name}</Link>)}</div>}<LiveReading reading={latest} initialNow={now}/><div className="row spread"><span className="muted">{device?.name||'Add a device in Settings'}</span><div className="row" aria-label="Time range">{Object.keys(ranges).map(r=><Link className={`button ${range===r?'':'secondary'}`} key={r} href={`/dashboard?site=${site.id}&device=${device?.id||''}&range=${r}`} aria-current={range===r?'page':undefined}>{r}</Link>)}</div></div><ReadingChart readings={readings} timezone={site.timezone} start={now-ranges[range]*3600000} end={now}/><ContextToggles siteId={site.id} userId={user.id} events={events}/><ReportButton siteId={site.id}/><RecentReports reports={reports} timezone={site.timezone}/></Shell>
}
