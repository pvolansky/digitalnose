'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { MetricBadge, MetricInfo, InfoTooltip } from './metric-info';
import { getDeviceHealth, healthTimeAgo } from '@/lib/domain/device-health';
import { particulateRating } from '@/lib/domain/particulate-quality';
import { sensorHealth, type Sensor } from '@/lib/sensors/data';
import type { Reading } from '@/lib/domain/types';
export function LiveReading({
  reading,
  lastSeenAt,
  initialNow,
  demo = false,
  maintenance = false,
  syncStatus,
  particulate,
  showParticulate = false,
}: {
  reading: Reading | null;
  lastSeenAt: string | null;
  initialNow: number;
  demo?: boolean;
  maintenance?: boolean;
  syncStatus?: ReactNode;
  particulate?: Sensor;
  showParticulate?: boolean;
}) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const clock = demo ? initialNow : Math.max(now, initialNow);
  const health = getDeviceHealth({
    lastSeenAt,
    latestAggregateAt: reading?.minute_start_utc,
    now: clock,
  });
  const pm = particulate?.latest_observation;
  const pmValue = pm?.valid && pm.status === 'ok' ? pm.readings.pm2_5_ug_m3 : null;
  const pmHealth = particulate
    ? sensorHealth(particulate, clock).replaceAll('_', ' ')
    : 'AWAITING DATA';
  const pmRating = particulateRating(pmValue);
  const pmCurrent = pmHealth === 'LIVE' && !maintenance;
  return (
    <section className="panel">
      <div className="reading-status-row">
        <p className={`eyebrow health-heading health-${health.state}`}>
          <span
            className={`health-dot${health.state === 'live' && !demo ? ' health-dot-live' : ''}`}
            aria-hidden="true"
          />
          {maintenance ? 'Maintenance' : demo ? 'Demo readings' : health.headline}
        </p>
        {syncStatus}
      </div>
      <dl className="health-summary">
        <div>
          <dt>Device</dt>
          <dd>{health.deviceLabel}</dd>
        </div>
        <div>
          <dt>Sensor</dt>
          <dd>{health.sensorLabel}</dd>
        </div>
        <div>
          <dt>Last reading</dt>
          <dd>{healthTimeAgo(reading?.minute_start_utc, clock)}</dd>
        </div>
      </dl>
      {maintenance && (
        <p className="muted" role="status">
          Measurements are excluded during maintenance.
        </p>
      )}
      <div className={`metrics${showParticulate ? ' metrics-with-pm' : ''}`}>
        {[
          ['TVOC', reading?.tvoc_mean, 'ppb', 'tvoc_mean'],
          ['eCO₂', reading?.eco2_mean, 'ppm', 'eco2_mean'],
          ['AQI', reading?.aqi_max, '/ 5', 'aqi_max'],
        ].map(([label, value, unit, key]) => (
          <div key={label}>
            <p className="muted" style={{ fontSize: 14 }}>
              {label}
              <MetricInfo
                metric={key as import('@/lib/domain/air-quality').Metric}
                label={String(label)}
              />
            </p>
            <div>
              <span className="metric-value">
                {maintenance || value == null
                  ? '—'
                  : Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}
              </span>
              <span className="muted" style={{ marginLeft: 10, fontSize: 15 }}>
                {unit}
              </span>
            </div>
            {maintenance || (health.state !== 'live' && !demo) ? (
              <span className="quality-badge quality-neutral">
                <i aria-hidden="true" />
                {maintenance ? 'Excluded' : health.badgeLabel}
              </span>
            ) : (
              <MetricBadge
                metric={key as import('@/lib/domain/air-quality').Metric}
                value={value == null ? null : Number(value)}
              />
            )}
          </div>
        ))}
        {showParticulate && (
          <div>
            <p className="muted" style={{ fontSize: 14 }}>
              PM2.5 · SPS30
              <InfoTooltip
                label="PM2.5 colours"
                description="Defra-based bands (µg/m³): <36 low · 36–<54 moderate · 54–<71 high · ≥71 very high. Colours compare the latest reading; official UK ratings use a 24-hour mean. Low does not mean risk-free."
              />
            </p>
            <div>
              <span className="metric-value">
                {maintenance || pmValue == null || !Number.isFinite(pmValue)
                  ? '—'
                  : pmValue.toLocaleString('en-GB', { maximumFractionDigits: 1 })}
              </span>
              <span className="muted" style={{ marginLeft: 10, fontSize: 15 }}>
                µg/m³
              </span>
            </div>
            <span className={`quality-badge quality-${pmCurrent ? pmRating.tone : 'neutral'}`}>
              <i aria-hidden="true" />
              {maintenance ? 'Excluded' : pmCurrent ? pmRating.label : pmHealth}
            </span>
            <p className="muted" style={{ fontSize: 12 }}>
              Recent reading · not a 24-hour rating
            </p>
            {pm && (
              <p className="muted" style={{ fontSize: 12 }}>
                {healthTimeAgo(pm.observed_at, clock)}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="health-detail muted">
        Device last seen {healthTimeAgo(lastSeenAt, clock).toLowerCase()} · Last valid sensor
        reading {healthTimeAgo(reading?.minute_start_utc, clock).toLowerCase()}
      </p>
      {health.state === 'warming_up' && !demo && (
        <p className="health-detail muted">
          The device is syncing, but no recent valid sensor reading is available. The sensor may be
          warming up or temporarily invalid.
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>
        ENS160 estimates · eCO₂ is an equivalent CO₂ estimate, not a direct CO₂ measurement.
      </p>
    </section>
  );
}
