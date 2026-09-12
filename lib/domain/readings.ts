import type { SupabaseClient } from '@supabase/supabase-js';
import type { Reading } from './types';
export const ranges = { '6H': 6, '24H': 24, '7D': 168 } as const;
export type Range = keyof typeof ranges;
export function parseRange(value?: string): Range {
  return value && value in ranges ? (value as Range) : '24H';
}
export async function loadReadings(
  db: SupabaseClient,
  deviceId: string,
  range: Range,
  now = Date.now(),
) {
  const start = new Date(now - ranges[range] * 3600000).toISOString();
  const end = new Date(now).toISOString();
  const rows: Reading[] = [];
  // Supabase defaults to 1,000 rows per response. Page every minute, including the 7D range.
  for (let offset = 0; offset < 11000; offset += 1000) {
    const { data, error } = await db
      .from('minute_aggregates')
      .select('*')
      .eq('device_id', deviceId)
      .gte('minute_start_utc', start)
      .lte('minute_start_utc', end)
      .order('minute_start_utc')
      .range(offset, offset + 999);
    if (error) throw new Error('Unable to load sensor history.');
    rows.push(...(data as Reading[]));
    if (data.length < 1000) break;
  }
  return rows;
}
export async function loadLatestReading(db: SupabaseClient, deviceId: string) {
  const { data, error } = await db
    .from('minute_aggregates')
    .select('*')
    .eq('device_id', deviceId)
    .order('minute_start_utc', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Unable to load the latest reading.');
  return data as Reading | null;
}
export function splitReadingGaps(rows: Reading[]) {
  const groups: Reading[][] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (
      !last ||
      Date.parse(row.minute_start_utc) - Date.parse(last.at(-1)!.minute_start_utc) > 90000
    )
      groups.push([row]);
    else last.push(row);
  }
  return groups;
}
