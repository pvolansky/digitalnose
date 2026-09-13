import type { SupabaseClient } from '@supabase/supabase-js';
import type { StateEvent, SmellReport } from './types';
import { currentState } from './site-state';

export function contextAt(events: StateEvent[], at: number) {
  return currentState(events.filter((e) => Date.parse(e.recorded_at) <= at));
}
export function stateIntervals(
  events: StateEvent[],
  type: StateEvent['event_type'],
  start: number,
  end: number,
) {
  const relevant = events
    .filter((e) => e.event_type === type)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.id.localeCompare(b.id));
  const points = [
    ...new Set([
      start,
      ...relevant.map((e) => Date.parse(e.recorded_at)).filter((t) => t > start && t < end),
      end,
    ]),
  ].sort((a, b) => a - b);
  return points.slice(0, -1).map((from, i) => ({
    start: from,
    end: points[i + 1],
    value: contextAt(relevant, from)[type],
  }));
}

export async function loadTimeline(db: SupabaseClient, siteId: string, start: number, end: number) {
  const from = new Date(start).toISOString();
  const to = new Date(end).toISOString();
  const seedResults = await Promise.all(
    (['window_open', 'user_in_room'] as const).map((type) => {
      const q = db
        .from('site_state_events')
        .select('*')
        .eq('site_id', siteId)
        .eq('event_type', type)
        .lt('recorded_at', from)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false });
      return q.limit(1);
    }),
  );
  if (seedResults.some((r) => r.error)) throw new Error('Unable to load timeline context.');
  const events = seedResults.flatMap((r) => r.data || []) as StateEvent[];
  const reports: SmellReport[] = [];
  for (const table of ['site_state_events', 'smell_reports'] as const) {
    const time = table === 'site_state_events' ? 'recorded_at' : 'reported_at';
    for (let offset = 0; ; offset += 1000) {
      const q = db
        .from(table)
        .select('*')
        .eq('site_id', siteId)
        .gte(time, from)
        .lte(time, to)
        .order(time)
        .order('id');
      const { data, error } = await q.range(offset, offset + 999);
      if (error) throw new Error('Unable to load timeline events.');
      if (table === 'site_state_events') events.push(...(data as StateEvent[]));
      else reports.push(...(data as SmellReport[]));
      if (data.length < 1000) break;
    }
  }
  return { events, reports };
}
