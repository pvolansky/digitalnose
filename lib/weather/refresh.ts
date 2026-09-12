import { timingSafeEqual } from 'node:crypto';
import { validCoordinates } from './coordinates';
import { fetchWeather } from './open-meteo';
import type { WeatherObservation, WeatherSite } from './types';
export type WeatherRepository = {
  sites: () => Promise<WeatherSite[]>;
  upsert: (siteId: string, observation: WeatherObservation) => Promise<void>;
};
export async function handleWeatherRefresh(
  request: Request,
  secret: string | undefined,
  repository: () => WeatherRepository,
  acquire = fetchWeather,
) {
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const db = repository();
    const sites = await db.sites();
    const summary = { ok: true, sites: sites.length, upserted: 0, failed: 0, skipped: 0 };
    console.info(JSON.stringify({ event: 'weather_refresh_started', sites: sites.length }));
    // Four bounded workers; no retries and at most one provider call per distinct site.
    const unique = [...new Map(sites.map((site) => [site.id, site])).values()];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, unique.length) }, async () => {
        while (next < unique.length) {
          const site = unique[next++];
          if (!validCoordinates(site.latitude, site.longitude)) {
            summary.skipped++;
            continue;
          }
          let stage = 'provider';
          try {
            const observation = await acquire(site.latitude!, site.longitude!);
            console.info(
              JSON.stringify({
                event: 'weather_fetched',
                site_id: site.id,
                observed_at_utc: observation.observed_at_utc,
              }),
            );
            stage = 'database';
            await db.upsert(site.id, observation);
            summary.upserted++;
            console.info(
              JSON.stringify({
                event: 'weather_upserted',
                site_id: site.id,
                observed_at_utc: observation.observed_at_utc,
              }),
            );
          } catch {
            summary.failed++;
            console.error(
              JSON.stringify({ event: 'weather_refresh_failed', site_id: site.id, stage }),
            );
          }
        }
      }),
    );
    summary.ok = summary.failed === 0;
    console.info(JSON.stringify({ event: 'weather_refresh_finished', ...summary }));
    return Response.json(summary, { headers });
  } catch {
    console.error(JSON.stringify({ event: 'weather_refresh_unavailable' }));
    return Response.json(
      { ok: false, error: 'Weather refresh unavailable' },
      { status: 503, headers },
    );
  }
}
