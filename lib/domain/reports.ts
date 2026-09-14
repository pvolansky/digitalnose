import type { SupabaseClient } from '@supabase/supabase-js';
import type { SmellReport } from './types';
export const smellTypes = ['Restaurant', 'Cooking', 'Smoke', 'Other'] as const;
export function validateReport(form: FormData, now = Date.now()) {
  const intensity = Number(form.get('intensity'));
  const note = String(form.get('note') || '').trim();
  const smell_type = String(form.get('smell_type') || '');
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5)
    throw new Error('Choose an intensity from 1 to 5.');
  if (note.length > 1000) throw new Error('Keep your note under 1,000 characters.');
  if (smell_type && !smellTypes.includes(smell_type as (typeof smellTypes)[number]))
    throw new Error('Choose a listed smell type.');
  const timestamp = String(form.get('reported_at') || '');
  let reportedAt: string | undefined;
  if (timestamp) {
    const value = Date.parse(timestamp);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || !Number.isFinite(value))
      throw new Error('Choose a valid date and time.');
    if (value > now) throw new Error('The observation cannot be in the future.');
    reportedAt = new Date(value).toISOString();
  }
  return {
    ...(reportedAt ? { reported_at: reportedAt } : {}),
    intensity,
    note: note || null,
    smell_type: smell_type || null,
  };
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
  const reports = data as SmellReport[];
  if (!reports.length) return reports;
  const { data: names, error: namesError } = await db.rpc('report_display_names', {
    report_ids: reports.map((report) => report.id),
  });
  if (namesError) throw new Error('Unable to load report display names.');
  const byReport = new Map<string, string | null>(
    (names || []).map((row: { report_id: string; display_name: string | null }) => [
      row.report_id,
      row.display_name,
    ]),
  );
  return reports.map((report) => ({
    ...report,
    reporter_display_name: byReport.get(report.id) ?? null,
  }));
}
