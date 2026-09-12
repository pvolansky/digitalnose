import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { handleWeatherRefresh } from '@/lib/weather/refresh';
import type { WeatherSite } from '@/lib/weather/types';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  return handleWeatherRefresh(request, process.env.CRON_SECRET, () => {
    const db = adminClient();
    return {
      async sites() {
        const sites: WeatherSite[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await db
            .from('sites')
            .select('id,latitude,longitude')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .order('id')
            .range(offset, offset + 999);
          if (error) throw new Error('Unable to load weather sites');
          sites.push(...data);
          if (data.length < 1000) return sites;
        }
      },
      async upsert(siteId, observation) {
        const { error } = await db
          .from('weather_observations')
          .upsert(
            { ...observation, site_id: siteId },
            { onConflict: 'site_id,observed_at_utc,source' },
          );
        if (error) throw new Error('Unable to store weather');
      },
    };
  });
}
