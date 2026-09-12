import {siteContext} from '@/lib/domain/sites';
import {Shell} from '@/components/shell';
import {CreateSite} from '@/components/create-site';
export default async function Dashboard({searchParams}:{searchParams:Promise<{site?:string}>}){const context=await siteContext((await searchParams).site);return <Shell site={context.site} sites={context.sites}>{context.site?<><p className="eyebrow">{context.site.name}</p><h1>A little more clarity.</h1><p className="muted">Your sensor readings and observations, together.</p><section className="panel"><h2>Waiting for your first reading</h2><p>Add a device in Settings, then connect your Raspberry Pi.</p></section></>:<CreateSite/>}</Shell>}
