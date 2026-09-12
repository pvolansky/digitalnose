'use server';
import {requireUser} from '@/lib/auth/session';
import {redirect} from 'next/navigation';
import type {ActionResult} from '@/lib/domain/types';
export async function createSite(_:ActionResult,form:FormData):Promise<ActionResult>{const name=String(form.get('name')||'').trim();if(!name||name.length>100)return {error:'Enter a site name of 1–100 characters.'};const {db}=await requireUser();const {data,error}=await db.rpc('create_site',{site_name:name});if(error)return {error:'Could not create the site. Please try again.'};redirect(`/dashboard?site=${data}`)}
