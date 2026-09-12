import type { SupabaseClient } from '@supabase/supabase-js';
import { loadReadings, loadLatestReading, ranges, type Range } from './readings';
import { loadTimeline } from './timeline';
import { loadState } from './site-state';
import { loadReports } from './reports';
import type { Reading, StateEvent, SmellReport } from './types';
export type OverviewData = {
  now: number;
  readings: Reading[];
  latest: Reading | null;
  events: StateEvent[];
  currentEvents: StateEvent[];
  reports: SmellReport[];
  recentReports: SmellReport[];
};
export async function loadOverview(
  db: SupabaseClient,
  siteId: string,
  userId: string,
  deviceId: string | undefined,
  range: Range,
  now: number,
): Promise<OverviewData> {
  const [readings, latest, timeline, currentEvents, recentReports] = await Promise.all([
    deviceId ? loadReadings(db, deviceId, range, now) : [],
    deviceId ? loadLatestReading(db, deviceId) : null,
    loadTimeline(db, siteId, userId, now - ranges[range] * 3600000, now),
    loadState(db, siteId, userId),
    loadReports(db, siteId),
  ]);
  return { now, readings, latest, ...timeline, currentEvents, recentReports };
}
