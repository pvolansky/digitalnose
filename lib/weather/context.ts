import type { WeatherObservation } from './types';
import { degreesToCompass } from './wind';
export function weatherFreshness(observation: WeatherObservation | null, now: number) {
  if (!observation) return 'missing';
  return now - Date.parse(observation.observed_at_utc) <= 30 * 60000 ? 'fresh' : 'stale';
}
export function nearestWeather(observations: WeatherObservation[], at: number) {
  let nearest: WeatherObservation | null = null;
  let distance = 15 * 60000 + 1;
  for (const row of observations) {
    const delta = Math.abs(Date.parse(row.observed_at_utc) - at);
    if (delta <= 15 * 60000 && delta < distance) {
      nearest = row;
      distance = delta;
    }
  }
  return nearest;
}
export function weatherValue(value: number | null | undefined, unit: string) {
  return value == null
    ? '—'
    : `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${unit}`.trim();
}
export function windDescription(observation: WeatherObservation) {
  const speed = weatherValue(observation.wind_speed_kmh, 'km/h');
  const direction = observation.wind_direction_deg;
  return `${speed}${direction == null ? ' · direction unavailable' : ` from ${degreesToCompass(direction)} (${Math.round(direction)}°)`}`;
}
