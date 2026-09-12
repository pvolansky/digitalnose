import type { SupabaseClient } from '@supabase/supabase-js';
import type { SmellReport } from './types';
export const smellTypes = ['Restaurant', 'Cooking', 'Smoke', 'Other'] as const;
export function validateReport(form: FormData) {
  const intensity = Number(form.get('intensity'));
  const note = String(form.get('note') || '').trim();
  const smell_type = String(form.get('smell_type') || '');
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5)
    throw new Error('Choose an intensity from 1 to 5.');
  if (note.length > 1000) throw new Error('Keep your note under 1,000 characters.');
  if (smell_type && !smellTypes.includes(smell_type as (typeof smellTypes)[number]))
    throw new Error('Choose a listed smell type.');
  return { intensity, note: note || null, smell_type: smell_type || null };
}
export async function loadReports(db: SupabaseClient, siteId: string, limit = 5, before?: string) {
  let query = db
    .from('smell_reports')
    .select('*')
    .eq('site_id', siteId)
    .order('reported_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('reported_at', before);
  const { data, error } = await query;
  if (error) throw new Error('Unable to load smell reports.');
  return data as SmellReport[];
}
