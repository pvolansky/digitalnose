import type { SupabaseClient } from '@supabase/supabase-js';
import type { StateEvent, SmellReport } from './types';
import { currentState } from './site-state';

export function contextAt(events: StateEvent[], userId: string, at: number) {
  return currentState(
    events.filter((e) => Date.parse(e.recorded_at) <= at),
    userId,
  );
}
export function stateIntervals(
  events: StateEvent[],
  userId: string,
  type: StateEvent['event_type'],
  start: number,
  end: number,
) {
  const relevant = events
    .filter((e) => e.event_type === type && (type === 'window_open' || e.user_id === userId))
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
    value: contextAt(relevant, userId, from)[type],
  }));
}

export async function loadTimeline(
  db: SupabaseClient,
  siteId: string,
  userId: string,
  start: number,
  end: number,
) {
  const from = new Date(start).toISOString();
  const to = new Date(end).toISOString();
  const seedResults = await Promise.all(
    (['window_open', 'user_in_room'] as const).map((type) => {
      let q = db
        .from('site_state_events')
        .select('*')
        .eq('site_id', siteId)
        .eq('event_type', type)
        .lt('recorded_at', from)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false });
      if (type === 'user_in_room') q = q.eq('user_id', userId);
      return q.limit(1);
    }),
  );
  if (seedResults.some((r) => r.error)) throw new Error('Unable to load timeline context.');
  const events = seedResults.flatMap((r) => r.data || []) as StateEvent[];
  const reports: SmellReport[] = [];
  for (const table of ['site_state_events', 'smell_reports'] as const) {
    const time = table === 'site_state_events' ? 'recorded_at' : 'reported_at';
    for (let offset = 0; ; offset += 1000) {
      let q = db
        .from(table)
        .select('*')
        .eq('site_id', siteId)
        .gte(time, from)
        .lte(time, to)
        .order(time)
        .order('id');
      if (table === 'site_state_events') q = q.or(`event_type.eq.window_open,user_id.eq.${userId}`);
      const { data, error } = await q.range(offset, offset + 999);
      if (error) throw new Error('Unable to load timeline events.');
      if (table === 'site_state_events') events.push(...(data as StateEvent[]));
      else reports.push(...(data as SmellReport[]));
      if (data.length < 1000) break;
    }
  }
  return { events, reports };
}
