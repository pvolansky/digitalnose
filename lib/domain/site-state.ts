import type { SupabaseClient } from '@supabase/supabase-js';
import type { StateEvent } from './types';
export async function loadState(db: SupabaseClient, siteId: string) {
  const queries = ['window_open', 'user_in_room'].map((type) => {
    const query = db
      .from('site_state_events')
      .select('*')
      .eq('site_id', siteId)
      .eq('event_type', type)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);
    return query;
  });
  const results = await Promise.all(queries);
  if (results.some((r) => r.error)) throw new Error('Unable to load current context.');
  return results.flatMap((r) => r.data || []) as StateEvent[];
}
export function currentState(events: StateEvent[]) {
  const latest = (type: StateEvent['event_type']) =>
    events
      .filter((e) => e.event_type === type)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at) || b.id.localeCompare(a.id))[0];
  return { window_open: latest('window_open')?.value, user_in_room: latest('user_in_room')?.value };
}
