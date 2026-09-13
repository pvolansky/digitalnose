import { loadWeather, type WeatherContext } from '@/lib/weather/read';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadReadings, loadLatestReading, ranges, type Range } from './readings';
import { loadTimeline } from './timeline';
import { loadState } from './site-state';
import { loadReports } from './reports';
import type { Reading, StateEvent, SmellReport } from './types';
export type OverviewData = {
  now: number;
  weather: WeatherContext;
  lastSeenAt: string | null;
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
  deviceId: string | undefined,
  range: Range,
  now: number,
): Promise<OverviewData> {
  const [readings, latest, timeline, currentEvents, recentReports, heartbeat, weather] =
    await Promise.all([
      deviceId ? loadReadings(db, deviceId, range, now) : [],
      deviceId ? loadLatestReading(db, deviceId) : null,
      loadTimeline(db, siteId, now - ranges[range] * 3600000, now),
      loadState(db, siteId),
      loadReports(db, siteId),
      deviceId
        ? db
            .from('devices')
            .select('last_seen_at')
            .eq('site_id', siteId)
            .eq('id', deviceId)
            .maybeSingle()
        : { data: null, error: null },
      loadWeather(db, siteId, now - ranges[range] * 3600000, now),
    ]);
  if (heartbeat.error) throw new Error('Unable to load device heartbeat.');
  return {
    now,
    weather,
    lastSeenAt: heartbeat.data?.last_seen_at ?? null,
    readings,
    latest,
    ...timeline,
    currentEvents,
    recentReports,
  };
}
