import type { WeatherObservation } from './types';
import { validCoordinates } from './coordinates';
export const weatherVariables = [
  'temperature_2m',
  'relative_humidity_2m',
  'surface_pressure',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
] as const;
export function weatherUrl(latitude: number, longitude: number) {
  if (!validCoordinates(latitude, longitude)) throw new Error('Invalid coordinates');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: weatherVariables.join(','),
    models: 'best_match',
    timezone: 'UTC',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  }).toString();
  return url;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid weather object');
  return value as Record<string, unknown>;
}
export function mapWeather(payload: unknown): WeatherObservation {
  const root = object(payload),
    current = object(root.current),
    units = object(root.current_units);
  if (root.utc_offset_seconds !== 0) throw new Error('Expected UTC weather');
  if (
    typeof current.time !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(current.time)
  )
    throw new Error('Invalid weather timestamp');
  const timestamp = new Date(`${current.time}Z`);
  if (!Number.isFinite(timestamp.getTime()) || !timestamp.toISOString().startsWith(current.time))
    throw new Error('Invalid weather timestamp');
  const expectedUnits: Record<string, string> = {
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    surface_pressure: 'hPa',
    precipitation: 'mm',
    wind_speed_10m: 'km/h',
    wind_direction_10m: '°',
    wind_gusts_10m: 'km/h',
    weather_code: 'wmo code',
  };
  function number(key: string, min = -Infinity, max = Infinity, integer = false): number | null {
    if (!(key in current) || units[key] !== expectedUnits[key])
      throw new Error('Missing weather field or invalid units');
    const value = current[key];
    if (value === null) return null;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw new Error('Invalid weather value');
    return value;
  }
  const observation: WeatherObservation = {
    observed_at_utc: timestamp.toISOString(),
    temperature_c: number('temperature_2m'),
    relative_humidity_pct: number('relative_humidity_2m', 0, 100),
    surface_pressure_hpa: number('surface_pressure'),
    precipitation_mm: number('precipitation', 0),
    wind_speed_kmh: number('wind_speed_10m', 0),
    wind_direction_deg: number('wind_direction_10m', 0, 360),
    wind_gust_kmh: number('wind_gusts_10m', 0),
    weather_code: number('weather_code', 0, 99, true),
    source: 'open-meteo',
    model: 'best_match',
    metadata: {},
  };
  for (const key of ['utc_offset_seconds']) {
    if (typeof root[key] === 'number' && Number.isFinite(root[key]))
      observation.metadata![key] = root[key];
  }
  // Best Match is the requested selection strategy, not a claim about the underlying model.
  if (typeof root.model === 'string') observation.metadata!.provider_model = root.model;
  if (weatherVariables.every((key) => current[key] === null))
    throw new Error('Empty weather observation');
  return observation;
}
// Imported only by the protected server refresh service; never by dashboard/client code.
export async function fetchWeather(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(weatherUrl(latitude, longitude), {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    return mapWeather(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
