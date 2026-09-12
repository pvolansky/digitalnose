import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeatherObservation } from './types';
export type WeatherContext = {
  latest: WeatherObservation | null;
  history: WeatherObservation[];
  unavailable: boolean;
};
export async function loadWeather(
  db: SupabaseClient,
  siteId: string,
  start: number,
  end: number,
): Promise<WeatherContext> {
  try {
    const latest = await db
      .from('weather_observations')
      .select(
        'observed_at_utc,temperature_c,relative_humidity_pct,surface_pressure_hpa,precipitation_mm,wind_speed_kmh,wind_direction_deg,wind_gust_kmh,weather_code,source,model',
      )
      .eq('site_id', siteId)
      .eq('source', 'open-meteo')
      .order('observed_at_utc', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw new Error('Weather unavailable');
    const history: WeatherObservation[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from('weather_observations')
        .select(
          'observed_at_utc,temperature_c,relative_humidity_pct,surface_pressure_hpa,precipitation_mm,wind_speed_kmh,wind_direction_deg,wind_gust_kmh,weather_code,source,model',
        )
        .eq('site_id', siteId)
        .eq('source', 'open-meteo')
        .gte('observed_at_utc', new Date(start - 15 * 60000).toISOString())
        .lte('observed_at_utc', new Date(end + 15 * 60000).toISOString())
        .order('observed_at_utc')
        .range(offset, offset + 999);
      if (error) throw new Error('Weather unavailable');
      history.push(...data);
      if (data.length < 1000) break;
    }
    return { latest: latest.data, history, unavailable: false };
  } catch {
    // Optional weather must never reject the telemetry/dashboard loader.
    return { latest: null, history: [], unavailable: true };
  }
}
