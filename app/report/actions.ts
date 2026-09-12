'use server';
import {revalidatePath} from 'next/cache';
import {requireUser} from '@/lib/auth/session';
import {validateReport} from '@/lib/domain/reports';
import type {ActionResult} from '@/lib/domain/types';
export async function reportSmell(_:ActionResult,form:FormData):Promise<ActionResult>{let values;try{values=validateReport(form)}catch(e){return {error:e instanceof Error?e.message:'Invalid report.'}}const {db,user}=await requireUser();const {error}=await db.from('smell_reports').insert({...values,site_id:String(form.get('site_id')),user_id:user.id});if(error)return {error:'Could not save the report. Check your connection and site membership.'};revalidatePath('/dashboard');revalidatePath('/report');return {message:'Report saved. Thank you for adding your observation.'};}
