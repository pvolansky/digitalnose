import type { SupabaseClient } from '@supabase/supabase-js';
import type { HistoryWindow } from './history-window';
import { loadOverview, type OverviewData } from './overview';
import type { Range } from './readings';
import type { SmellReport } from './types';

export async function addReportDisplayNames(db: SupabaseClient, reports: SmellReport[]) {
  if (!reports.length) return reports;
  const byReport = new Map<string, string | null>();
  for (let offset = 0; offset < reports.length; offset += 500) {
    const page = reports.slice(offset, offset + 500);
    const { data, error } = await db.rpc('report_display_names', {
      report_ids: page.map((report) => report.id),
    });
    if (error) throw new Error('Unable to load report display names.');
    for (const row of (data || []) as { report_id: string; display_name: string | null }[])
      byReport.set(row.report_id, row.display_name);
  }
  return reports.map((report) => ({
    ...report,
    reporter_display_name: byReport.get(report.id) ?? null,
  }));
}

export async function loadNamedOverview(
  db: SupabaseClient,
  siteId: string,
  deviceId: string | undefined,
  range: Range,
  now: number,
  window?: HistoryWindow,
): Promise<OverviewData> {
  const overview = await loadOverview(db, siteId, deviceId, range, now, window);
  return { ...overview, reports: await addReportDisplayNames(db, overview.reports) };
}
