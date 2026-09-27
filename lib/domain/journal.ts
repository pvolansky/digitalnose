import type { SupabaseClient } from '@supabase/supabase-js';
import type { SmellReport } from './types';

// Keyset paging avoids the API row cap and timestamp ties. Never use a service key.
export async function loadJournal(db: SupabaseClient, siteId: string) {
  const reports: SmellReport[] = [];
  let after: string | undefined;
  for (;;) {
    let query = db
      .from('smell_reports')
      .select('*')
      .eq('site_id', siteId)
      .order('id', { ascending: true })
      .limit(500);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) throw new Error('Unable to load the complete journal.');
    const page = (data || []) as SmellReport[];
    if (!page.length) break;
    const { data: names, error: namesError } = await db.rpc('report_display_names', {
      report_ids: page.map((r) => r.id),
    });
    if (namesError) throw new Error('Unable to load resident names.');
    const byReport = new Map<string, string | null>(
      (names || []).map((r: { report_id: string; display_name: string | null }) => [
        r.report_id,
        r.display_name,
      ]),
    );
    reports.push(...page.map((r) => ({ ...r, reporter_display_name: byReport.get(r.id) ?? null })));
    const next = page.at(-1)!.id;
    if (next === after) throw new Error('Unable to finish loading the journal.');
    after = next;
  }
  return reports.sort(
    (a, b) => b.reported_at.localeCompare(a.reported_at) || b.id.localeCompare(a.id),
  );
}

export function journalDay(at: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validJournalDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function journalRangeError(from: string, to: string, earliest: string, today: string) {
  if (!validJournalDate(from) || !validJournalDate(to)) return 'Choose a valid start and end date.';
  if (from < earliest || to < earliest) return `The first observation is on ${earliest}.`;
  if (from > to) return 'The end date must be on or after the start date.';
  if (to > today) return 'The end date cannot be in the future.';
  return '';
}
export function filterJournal(
  reports: SmellReport[],
  timezone: string,
  from: string,
  to: string,
  resident = '',
) {
  return reports.filter((r) => {
    const day = journalDay(r.reported_at, timezone);
    return day >= from && day <= to && (!resident || r.user_id === resident);
  });
}
export function journalResidents(reports: SmellReport[]) {
  const names = new Map<string, string>();
  for (const r of reports)
    if (!names.has(r.user_id)) names.set(r.user_id, r.reporter_display_name?.trim() || 'Resident');
  const entries = [...names].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const seen = new Map<string, number>();
  return entries.map(([id, name]) => {
    const duplicate = entries.filter((e) => e[1] === name).length > 1;
    const index = (seen.get(name) || 0) + 1;
    seen.set(name, index);
    return { id, label: duplicate ? `${name} (${index})` : name };
  });
}
export function calendarMonth(month: string) {
  const start = new Date(`${month}-01T12:00:00Z`);
  const offset = (start.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) =>
    i < offset || i >= offset + count
      ? null
      : `${month}-${String(i - offset + 1).padStart(2, '0')}`,
  );
}
export function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
