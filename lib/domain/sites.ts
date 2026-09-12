import 'server-only';
import {requireUser} from '@/lib/auth/session';
import type {Site,Device} from './types';
export async function siteContext(requested?:string){
 const {db,user}=await requireUser();
 const {data,error}=await db.from('sites').select('*').order('created_at');
 if(error)throw new Error('Unable to load sites. Check that the Supabase migrations have been applied.');
 const sites=(data||[]) as Site[];
 const site=sites.find(s=>s.id===requested)||sites[0];
 if(!site)return {db,user,sites,site:undefined,role:undefined,devices:[] as Device[]};
 const [members,devices]=await Promise.all([db.from('site_members').select('role').eq('site_id',site.id).eq('user_id',user.id).single(),db.from('devices').select('*').eq('site_id',site.id).order('created_at')]);
 if(members.error||devices.error)throw new Error('Unable to load site details.');
 return {db,user,sites,site,role:members.data.role as 'owner'|'resident',devices:devices.data as Device[]};
}
