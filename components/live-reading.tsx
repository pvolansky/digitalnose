'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { MetricBadge, MetricInfo } from './metric-info';
import { getDeviceHealth, healthTimeAgo } from '@/lib/domain/device-health';
import type { Reading } from '@/lib/domain/types';
export function LiveReading({
  reading,
  lastSeenAt,
  initialNow,
  demo = false,
  syncStatus,
}: {
  reading: Reading | null;
  lastSeenAt: string | null;
  initialNow: number;
  demo?: boolean;
  syncStatus?: ReactNode;
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
  return (
    <section className="panel">
      <div className="reading-status-row">
        <p className={`eyebrow health-heading health-${health.state}`}>
          <span
            className={`health-dot${health.state === 'live' && !demo ? ' health-dot-live' : ''}`}
            aria-hidden="true"
          />
          {demo ? 'Demo readings' : health.headline}
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
      <div className="metrics">
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
                {value == null
                  ? '—'
                  : Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}
              </span>
              <span className="muted" style={{ marginLeft: 10, fontSize: 15 }}>
                {unit}
              </span>
            </div>
            {health.state !== 'live' && !demo ? (
              <span className="quality-badge quality-neutral">
                <i aria-hidden="true" />
                {health.badgeLabel}
              </span>
            ) : (
              <MetricBadge
                metric={key as import('@/lib/domain/air-quality').Metric}
                value={value == null ? null : Number(value)}
              />
            )}
          </div>
        ))}
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
