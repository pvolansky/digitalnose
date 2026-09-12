import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { degreesToCompass, oppositeBearing } from '../lib/weather/wind';
import { parseCoordinates } from '../lib/weather/coordinates';
import { fetchWeather, mapWeather, weatherUrl, weatherVariables } from '../lib/weather/open-meteo';
import { handleWeatherRefresh } from '../lib/weather/refresh';
import { loadWeather } from '../lib/weather/read';
import { nearestWeather, weatherFreshness } from '../lib/weather/context';
import { WeatherCard, WeatherAtMoment } from '../components/weather-card';
import type { SupabaseClient } from '@supabase/supabase-js';
const fixture = () => ({
  utc_offset_seconds: 0,
  latitude: 51.5,
  longitude: 0,
  elevation: 10,
  current: {
    time: '2026-09-12T12:00',
    temperature_2m: 16.8,
    relative_humidity_2m: 71,
    surface_pressure: 1014,
    precipitation: 0,
    wind_speed_10m: 18,
    wind_direction_10m: 225,
    wind_gusts_10m: 31,
    weather_code: 3,
  },
  current_units: {
    time: 'iso8601',
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    surface_pressure: 'hPa',
    precipitation: 'mm',
    wind_speed_10m: 'km/h',
    wind_direction_10m: '°',
    wind_gusts_10m: 'km/h',
    weather_code: 'wmo code',
  },
});
const observation = mapWeather(fixture());
const now = Date.parse(observation.observed_at_utc);
test('wind bearings use meteorological compass directions and opposites', () => {
  for (const [degrees, direction] of [
    [0, 'N'],
    [22.5, 'NNE'],
    [45, 'NE'],
    [90, 'E'],
    [180, 'S'],
    [225, 'SW'],
    [270, 'W'],
    [359, 'N'],
    [360, 'N'],
  ] as const)
    assert.equal(degreesToCompass(degrees), direction);
  for (const [degrees, opposite] of [
    [0, 180],
    [180, 0],
    [225, 45],
  ])
    assert.equal(oppositeBearing(degrees), opposite);
  assert.throws(() => degreesToCompass(NaN));
});
test('coordinates require both finite values, allow zero and can be cleared together', () => {
  assert.deepEqual(parseCoordinates('0', '0'), { latitude: 0, longitude: 0 });
  assert.deepEqual(parseCoordinates('', ''), { latitude: null, longitude: null });
  for (const pair of [
    ['91', '0'],
    ['0', '181'],
    ['1', ''],
    ['NaN', '2'],
  ])
    assert.throws(() => parseCoordinates(...(pair as [string, string])));
});
test('Open-Meteo requests exactly the eight current variables, UTC and Best Match on the free endpoint', () => {
  const url = weatherUrl(51.5, 0);
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('current'), weatherVariables.join(','));
  assert.equal(url.searchParams.get('models'), 'best_match');
  assert.equal(url.searchParams.get('timezone'), 'UTC');
  for (const key of ['apikey', 'hourly', 'daily']) assert.equal(url.searchParams.has(key), false);
});
test('mapper preserves zero, null, returned UTC timestamp and provider metadata', () => {
  assert.equal(observation.observed_at_utc, '2026-09-12T12:00:00.000Z');
  assert.equal(observation.precipitation_mm, 0);
  assert.equal(observation.wind_direction_deg, 225);
  assert.equal(observation.metadata?.latitude, undefined);
  assert.equal(observation.metadata?.longitude, undefined);
  assert.equal(observation.metadata?.elevation, undefined);
  const nullable = fixture();
  (nullable.current as Record<string, unknown>).wind_speed_10m = null;
  assert.equal(mapWeather(nullable).wind_speed_kmh, null);
});
test('mapper rejects missing current, missing fields, invalid numbers, wrong units and invalid dates', () => {
  assert.throws(() => mapWeather({}));
  for (const invalid of [361, -1, NaN, '225']) {
    const payload = fixture();
    (payload.current as Record<string, unknown>).wind_direction_10m = invalid;
    assert.throws(() => mapWeather(payload));
  }
  const missing = fixture();
  delete (missing.current as Record<string, unknown>).wind_speed_10m;
  assert.throws(() => mapWeather(missing));
  const units = fixture();
  units.current_units.wind_speed_10m = 'm/s';
  assert.throws(() => mapWeather(units));
  const date = fixture();
  date.current.time = '2026-02-31T12:00';
  assert.throws(() => mapWeather(date));
});
test('fetch succeeds once, rejects HTTP failures and aborts on timeout without retry', async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return Response.json(fixture());
  }) as typeof fetch;
  assert.equal((await fetchWeather(51.5, 0, fake)).wind_speed_kmh, 18);
  assert.equal(calls, 1);
  await assert.rejects(
    fetchWeather(51.5, 0, (async () => new Response('', { status: 503 })) as typeof fetch),
    /HTTP 503/,
  );
  const blocked = ((_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
    )) as typeof fetch;
  await assert.rejects(fetchWeather(51.5, 0, blocked, 5), /timeout/);
});
test('cron rejects missing/wrong/unconfigured secrets before opening the database', async () => {
  let opened = false;
  const repository = () => {
    opened = true;
    throw new Error('must not open');
  };
  for (const [header, secret] of [
    ['', 'secret'],
    ['Bearer wrong', 'secret'],
    ['Bearer undefined', undefined],
  ] as const) {
    const response = await handleWeatherRefresh(
      new Request('https://local/api/weather/refresh', { headers: { authorization: header } }),
      secret,
      repository,
    );
    assert.equal(response.status, 401);
  }
  assert.equal(opened, false);
});
test('cron skips missing coordinates, deduplicates sites, isolates upstream and write failures', async () => {
  const rows = new Map();
  let calls = 0;
  const request = new Request('https://local/api/weather/refresh', {
    headers: { authorization: 'Bearer secret' },
  });
  const sites = [
    { id: 'ok', latitude: 1, longitude: 1 },
    { id: 'upstream', latitude: 2, longitude: 2 },
    { id: 'write', latitude: 3, longitude: 3 },
    { id: 'missing', latitude: null, longitude: null },
    { id: 'later', latitude: 4, longitude: 4 },
    { id: 'ok', latitude: 1, longitude: 1 },
  ];
  const repository = () => ({
    sites: async () => sites,
    upsert: async (site: string) => {
      if (site === 'write') throw new Error('database');
      rows.set(site, observation);
    },
  });
  const acquire = async (lat: number) => {
    calls++;
    if (lat === 2) throw new Error('upstream');
    return observation;
  };
  const response = await handleWeatherRefresh(request, 'secret', repository, acquire);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false,
    sites: 6,
    upserted: 2,
    failed: 2,
    skipped: 1,
  });
  assert.equal(calls, 4);
  assert.equal(rows.size, 2);
  await handleWeatherRefresh(request, 'secret', repository, acquire);
  assert.equal(rows.size, 2);
});
test('optional weather query failure produces unavailable context without rejecting dashboard data', async () => {
  const db = {
    from: () => {
      throw new Error('missing migration');
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(await loadWeather(db, 'site', now - 1000, now), {
    latest: null,
    history: [],
    unavailable: true,
  });
});
test('weather freshness and nearest row use exact boundaries without inventing readings', () => {
  assert.equal(weatherFreshness(observation, now + 30 * 60000), 'fresh');
  assert.equal(weatherFreshness(observation, now + 30 * 60000 + 1), 'stale');
  assert.equal(weatherFreshness(null, now), 'missing');
  assert.equal(nearestWeather([observation], now + 15 * 60000), observation);
  assert.equal(nearestWeather([observation], now - 15 * 60000), observation);
  assert.equal(nearestWeather([observation], now + 15 * 60000 + 1), null);
});
test('weather UI distinguishes fresh, stale, missing and unavailable values with source attribution', () => {
  const render = (row: typeof observation | null, clock = now, unavailable = false) =>
    renderToStaticMarkup(
      React.createElement(WeatherCard, {
        observation: row,
        now: clock,
        timezone: 'Europe/London',
        configured: true,
        unavailable,
      }),
    );
  const fresh = render(observation);
  assert.match(fresh, /from SW/);
  assert.match(fresh, /Weather data by Open-Meteo/);
  assert.match(fresh, /https:\/\/open-meteo.com/);
  assert.doesNotMatch(fresh, /Stale/);
  assert.match(render(observation, now + 31 * 60000), /Stale/);
  assert.match(render(null), /No weather observations yet/);
  assert.match(render(null, now, true), /temporarily unavailable/);
  assert.doesNotMatch(render(null), /0 km\/h/);
  assert.match(
    renderToStaticMarkup(React.createElement(WeatherAtMoment, { observation: null })),
    /within 15 minutes/,
  );
});
