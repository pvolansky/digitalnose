import React from 'react';
import { LuWind } from 'react-icons/lu';
import type { WeatherObservation } from '@/lib/weather/types';
import { weatherFreshness, weatherValue, windDescription } from '@/lib/weather/context';
import { healthTimeAgo } from '@/lib/domain/device-health';
export function WeatherCard({
  observation,
  now,
  timezone,
  configured,
  unavailable = false,
  demo = false,
}: {
  observation: WeatherObservation | null;
  now: number;
  timezone: string;
  configured: boolean;
  unavailable?: boolean;
  demo?: boolean;
}) {
  const freshness = weatherFreshness(observation, now);
  return (
    <section className="panel weather-panel" aria-label="Current weather">
      <div className="row spread">
        <h2>Current weather</h2>
        <span className="muted">{demo ? 'Illustrative weather' : 'External model data'}</span>
      </div>
      {observation ? (
        <>
          <p className="weather-wind">
            <LuWind aria-hidden="true" />
            <span>
              Wind <strong>{windDescription(observation)}</strong>
            </span>
          </p>
          <dl className="weather-facts">
            {[
              ['Gusts', weatherValue(observation.wind_gust_kmh, 'km/h')],
              ['Temperature', weatherValue(observation.temperature_c, '°C')],
              ['Humidity', weatherValue(observation.relative_humidity_pct, '%')],
              ['Pressure', weatherValue(observation.surface_pressure_hpa, 'hPa')],
              ['Rain', weatherValue(observation.precipitation_mm, 'mm')],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted weather-note">
            <time
              dateTime={observation.observed_at_utc}
              title={new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(observation.observed_at_utc))}
            >
              Updated {healthTimeAgo(observation.observed_at_utc, now)}
            </time>
            {freshness === 'stale' ? ' · Stale — last known weather' : ''}
            {unavailable ? ' · Updates unavailable' : ''}
          </p>
        </>
      ) : (
        <p className="muted">
          {unavailable
            ? 'Weather is temporarily unavailable. Sensor readings and reports are unaffected.'
            : !configured
              ? 'Weather location is not configured. A site owner can add latitude and longitude in Settings.'
              : 'No weather observations yet. Weather will appear after a scheduled refresh.'}
        </p>
      )}
      {demo ? (
        <p className="weather-note muted">Example weather for exploring the demo.</p>
      ) : (
        <p className="weather-note muted">
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Weather data by Open-Meteo
          </a>{' '}
          · Best Match · Wind direction means where wind comes from.
        </p>
      )}
    </section>
  );
}
export function WeatherAtMoment({ observation }: { observation: WeatherObservation | null }) {
  return (
    <div className="inspector-weather">
      <span className="muted">Weather near this moment</span>
      {observation ? (
        <>
          <span>Wind: {windDescription(observation)}</span>
          <span>
            Gusts: {weatherValue(observation.wind_gust_kmh, 'km/h')} · Humidity:{' '}
            {weatherValue(observation.relative_humidity_pct, '%')}
          </span>
          <span>
            Temperature: {weatherValue(observation.temperature_c, '°C')} · Rain:{' '}
            {weatherValue(observation.precipitation_mm, 'mm')} · Pressure:{' '}
            {weatherValue(observation.surface_pressure_hpa, 'hPa')}
          </span>
          <span className="muted">
            {new Date(observation.observed_at_utc).toISOString().slice(0, 16).replace('T', ' ')} UTC
            · {observation.source === 'demo' ? 'illustrative weather' : 'external model data'}
          </span>
        </>
      ) : (
        <span className="muted">No weather observation within 15 minutes.</span>
      )}
    </div>
  );
}
