'use client';
import { useEffect, useId, useState, useRef } from 'react';
import { browserClient } from '@/lib/supabase/client';
import {
  sensorHealth,
  loadSensorArray,
  loadNearestSensors,
  INSPECTION_TOLERANCE_SECONDS,
  type SensorArrayData,
  type Sensor,
  type Bucket,
  type Nearby,
} from '@/lib/sensors/data';
import { bucketGroups, metricLabels } from '@/lib/sensors/charts';
import type { Reading, SmellReport, StateEvent } from '@/lib/domain/types';
import { contextAt, stateIntervals, isMaintenanceMinute } from '@/lib/domain/timeline';
import type { WeatherObservation } from '@/lib/weather/types';
import { windDescription } from '@/lib/weather/context';
const colours = ['#4265d6', '#168078', '#b54880', '#b46a24'];
function display(value: number) {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}
function local(at: number, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at);
}
type Shared = {
  start: number;
  end: number;
  selectedAt: number | null;
  onSelect: (at: number) => void;
  events: StateEvent[];
  reports: SmellReport[];
  timezone: string;
};
type Series = { id: string; label: string; sensorId: string; metric: string };
export function SensorPlot({
  title,
  unit,
  series,
  points,
  sensors,
  ...shared
}: Shared & {
  title: string;
  unit: string;
  series: Series[];
  points: Bucket[];
  sensors: Sensor[];
}) {
  const id = useId();
  const plotRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const left = 66,
    right = width - 14;
  const axisTime = (time: number) =>
    width < 450
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: shared.timezone,
          hour: '2-digit',
          minute: '2-digit',
        }).format(time)
      : local(time, shared.timezone);
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = series.filter((s) => !hidden.includes(s.id));
  const rows = points.filter((p) =>
    visible.some((s) => s.sensorId === p.sensor_id && s.metric === p.metric),
  );
  // The database excludes maintenance samples before aggregating. A bucket start
  // can overlap maintenance even when its remaining observations are valid.
  const usable = rows;
  const lo = Math.min(0, ...usable.map((p) => p.min)),
    hi = Math.max(1, ...usable.map((p) => p.max));
  const top = hi + (hi - lo) * 0.08;
  const x = (at: number) =>
    left + ((at - shared.start) / (shared.end - shared.start)) * (right - left);
  const y = (n: number) => 180 - ((n - lo) / (top - lo)) * 140;
  const never = sensors.length > 0 && sensors.every((s) => !s.last_valid_reading_at);
  const at = shared.selectedAt;
  return (
    <section ref={plotRef} className="sensor-plot" aria-labelledby={id}>
      <div className="row spread">
        <h3 id={id}>{title}</h3>
        <span className="muted">{unit}</span>
      </div>
      <div className="row sensor-legend">
        {series.map((s, i) => (
          <button
            key={s.id}
            className="secondary tag"
            aria-pressed={!hidden.includes(s.id)}
            onClick={() =>
              setHidden((prev) =>
                prev.includes(s.id) ? prev.filter((v) => v !== s.id) : [...prev, s.id],
              )
            }
          >
            <span style={{ color: colours[i % 4] }}>●</span> {s.label}
          </button>
        ))}
      </div>
      {!usable.length ? (
        <p className="sensor-empty">
          {!visible.length
            ? 'All series hidden'
            : never
              ? 'Awaiting sensor data'
              : 'No valid readings in this time range'}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} 245`}
          className="sensor-svg"
          role="group"
          tabIndex={0}
          aria-label={`${title}, ${unit}. Click or use arrow keys to inspect a moment.`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            shared.onSelect(
              shared.start +
                Math.max(
                  0,
                  Math.min(1, (((e.clientX - r.left) * width) / r.width - left) / (right - left)),
                ) *
                  (shared.end - shared.start),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              shared.onSelect(
                Math.max(
                  shared.start,
                  Math.min(
                    shared.end,
                    (at ?? shared.end) + (e.key === 'ArrowLeft' ? -60000 : 60000),
                  ),
                ),
              );
            }
          }}
        >
          <title>{`${title} · bucket means and min/max ranges`}</title>
          {stateIntervals(shared.events, 'window_open', shared.start, shared.end)
            .filter((i) => i.value !== undefined)
            .map((i) => (
              <rect
                key={i.start}
                x={x(i.start)}
                y="32"
                width={x(i.end) - x(i.start)}
                height="148"
                fill={i.value ? 'var(--window-fill)' : 'var(--window-closed-fill)'}
              >
                <title>{i.value ? 'Window open' : 'Window closed'}</title>
              </rect>
            ))}
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={left}
                x2={right}
                y1={y(lo + (top - lo) * f)}
                y2={y(lo + (top - lo) * f)}
                stroke="var(--line)"
              />
              <text
                x={left - 8}
                y={y(lo + (top - lo) * f) + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--muted)"
              >
                {display(lo + (top - lo) * f)}
              </text>
            </g>
          ))}
          {visible.map((s) => {
            const colour = colours[series.findIndex((v) => v.id === s.id) % 4];
            const data = usable.filter((p) => p.sensor_id === s.sensorId && p.metric === s.metric);
            return (
              <g key={s.id}>
                {data.map((p) => (
                  <g key={p.bucket}>
                    <line
                      x1={x(Date.parse(p.at))}
                      x2={x(Date.parse(p.at))}
                      y1={y(p.min)}
                      y2={y(p.max)}
                      stroke={colour}
                      strokeOpacity=".4"
                      strokeWidth="3"
                    />
                    <circle cx={x(Date.parse(p.at))} cy={y(p.mean)} r="2" fill={colour}>
                      <title>{`${s.label}: mean ${display(p.mean)}, min ${display(p.min)}, max ${display(p.max)} ${unit}; ${p.count} readings${p.acquisition_variants > 1 ? '; multiple heater settings' : ''}`}</title>
                    </circle>
                  </g>
                ))}
                {bucketGroups(data).map((group, i) => (
                  <polyline
                    key={i}
                    points={group.map((p) => `${x(Date.parse(p.at))},${y(p.mean)}`).join(' ')}
                    fill="none"
                    stroke={colour}
                    strokeWidth="1.7"
                  />
                ))}
              </g>
            );
          })}
          {shared.reports
            .filter(
              (r) =>
                Date.parse(r.reported_at) >= shared.start &&
                Date.parse(r.reported_at) <= shared.end,
            )
            .map((r) => (
              <line
                key={r.id}
                x1={x(Date.parse(r.reported_at))}
                x2={x(Date.parse(r.reported_at))}
                y1="25"
                y2="180"
                stroke="var(--report-color)"
                strokeDasharray="3 4"
              >
                <title>{`${r.smell_type || 'Smell'} · ${r.intensity}/5`}</title>
              </line>
            ))}
          {stateIntervals(shared.events, 'user_in_room', shared.start, shared.end).map((i) => (
            <rect
              key={i.start}
              x={x(i.start)}
              y="190"
              width={x(i.end) - x(i.start)}
              height="6"
              fill={i.value ? 'var(--presence-color)' : 'var(--inactive-fill)'}
            >
              <title>
                {i.value === undefined
                  ? 'Presence unknown'
                  : i.value
                    ? 'Resident present'
                    : 'Resident absent'}
              </title>
            </rect>
          ))}
          {at !== null && at >= shared.start && at <= shared.end && (
            <line
              x1={x(at)}
              x2={x(at)}
              y1="25"
              y2="200"
              stroke="var(--ink)"
              strokeDasharray="3 3"
            />
          )}
          <text x={left} y="226" fontSize="11" fill="var(--muted)">
            {axisTime(shared.start)}
          </text>
          <text x={right} y="226" textAnchor="end" fontSize="11" fill="var(--muted)">
            {axisTime(shared.end)}
          </text>
        </svg>
      )}
    </section>
  );
}
export function SensorAnalysis({
  data,
  deviceId,
  now,
  readings,
  weather,
  updating,
  refreshError = false,
  onRetry,
  ...shared
}: Shared & {
  data?: SensorArrayData;
  deviceId?: string;
  now: number;
  readings: Reading[];
  weather: WeatherObservation[];
  updating: boolean;
  refreshError?: boolean;
  onRetry: () => void;
}) {
  const [inspection, setInspection] = useState<{
    at: number;
    rows: Nearby[];
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (shared.selectedAt === null || !deviceId) return;
    const at = shared.selectedAt;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => loadNearestSensors(browserClient(), deviceId, at))
        .then((rows) => {
          if (!cancelled) setInspection({ at, rows, error: false });
        })
        .catch(() => {
          if (!cancelled) setInspection({ at, rows: [], error: true });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shared.selectedAt, deviceId, now]);
  if (!data)
    return (
      <section className="panel" aria-label="Sensor analysis" aria-busy="true">
        <h2>Sensor analysis</h2>
        <p role="status">Loading sensor analysis…</p>
      </section>
    );
  if (data.unavailable)
    return (
      <section className="panel" aria-label="Sensor analysis">
        <h2>Sensor analysis</h2>
        <p role="status">
          Sensor analysis is temporarily unavailable. Existing air readings remain available.
        </p>
        <button className="secondary" onClick={onRetry} disabled={updating}>
          Retry
        </button>
      </section>
    );
  if (!data.sensors.length)
    return (
      <section className="panel">
        <h2>Sensor array</h2>
        <p className="muted">No sensor array registered for this collector.</p>
      </section>
    );
  const ofType = (type: string) => data.sensors.filter((s) => s.sensor_type === type);
  const series = (sensors: Sensor[], metrics: string[]): Series[] =>
    sensors.flatMap((s) =>
      metrics.map((metric) => ({
        id: `${s.id}:${metric}`,
        sensorId: s.id,
        metric,
        label: metrics.length === 1 ? s.label : `${s.label} · ${metricLabels[metric].label}`,
      })),
    );
  const bme = ofType('bme690'),
    sgp = ofType('sgp41'),
    sps = ofType('sps30');
  const primary = bme.find((s) => s.metadata.environment_primary === true) ?? bme[0];
  const at = shared.selectedAt;
  const context = at !== null ? contextAt(shared.events, at) : null;
  const ens =
    at === null
      ? undefined
      : readings
          .filter(
            (r) =>
              Math.abs(Date.parse(r.minute_start_utc) - at) <= 60000 &&
              !isMaintenanceMinute(shared.events, Date.parse(r.minute_start_utc)),
          )
          .sort(
            (a, b) =>
              Math.abs(Date.parse(a.minute_start_utc) - at) -
              Math.abs(Date.parse(b.minute_start_utc) - at),
          )[0];
  const nearbyWeather =
    at === null
      ? undefined
      : weather
          .filter((w) => Math.abs(Date.parse(w.observed_at_utc) - at) <= 15 * 60000)
          .sort(
            (a, b) =>
              Math.abs(Date.parse(a.observed_at_utc) - at) -
              Math.abs(Date.parse(b.observed_at_utc) - at),
          )[0];
  const maintenance = at !== null && isMaintenanceMinute(shared.events, at);
  return (
    <section className="panel sensor-analysis" aria-label="Sensor analysis" aria-busy={updating}>
      <div className="row spread">
        <div>
          <p className="eyebrow">Sensor array</p>
          <h2>Sensor analysis</h2>
        </div>
        <div className="sensor-refresh-status" role="status">
          {refreshError ? (
            <button className="secondary" onClick={onRetry} disabled={updating}>
              Retry update
            </button>
          ) : (
            <span className="muted">{updating ? 'Updating…' : ''}</span>
          )}
        </div>
      </div>
      {refreshError && (
        <p className="muted">
          Updates are temporarily unavailable. Last loaded sensor data is shown.
        </p>
      )}
      <div className="sensor-status-grid">
        {data.sensors.map((s) => (
          <div key={s.id}>
            <strong>{s.label}</strong>
            <span className="tag">{sensorHealth(s, now).replaceAll('_', ' ')}</span>
            <small className="muted">
              {s.last_valid_reading_at
                ? `Last valid: ${local(Date.parse(s.last_valid_reading_at), shared.timezone)}`
                : 'Awaiting first valid reading'}
              {!s.enabled ? ' · Disabled' : ''}
            </small>
            {s.latest_observation?.last_error && <small>{s.latest_observation.last_error}</small>}
          </div>
        ))}
      </div>
      <p className="muted">
        Shared time range · {shared.timezone}. Lines show bucket means; vertical ranges preserve
        minima and maxima. Window shading, presence bands and smell markers use the same recorded
        context.
      </p>
      <SensorPlot
        {...shared}
        title="BME690 gas response"
        unit="Ω"
        series={series(bme, ['gas_resistance_ohm'])}
        points={data.points}
        sensors={bme}
      />
      <div className="sensor-small-grid">
        {['raw_voc_ticks', 'raw_nox_ticks'].map((metric) => (
          <SensorPlot
            key={metric}
            {...shared}
            title={`SGP41 · ${metricLabels[metric].label}`}
            unit="ticks"
            series={series(sgp, [metric])}
            points={data.points}
            sensors={sgp}
          />
        ))}
      </div>
      <SensorPlot
        {...shared}
        title="Particulate matter · SPS30"
        unit="µg/m³"
        series={series(sps, ['pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3'])}
        points={data.points}
        sensors={sps}
      />
      <h3>Environment</h3>
      <p className="muted">
        Primary source: {primary?.label ?? 'Awaiting registration'}. Each sensor remains
        independently identified.
      </p>
      <EnvironmentPlots {...shared} points={data.points} sensors={bme} primary={primary} />
      <details className="timeline-details">
        <summary>Chart aggregation details</summary>
        <p>
          Bucket width: {data.bucket_seconds} seconds. Raw observations retain their original
          timestamps, validity and heater settings. Buckets may span heater settings; use raw
          inspection for acquisition details. Empty buckets are not filled. Maintenance observations
          are excluded from these plots but retained in storage.
        </p>
      </details>
      <section className="sensor-inspection" aria-label="Inspect a moment">
        <h3>Inspect a moment · all sensors</h3>
        {at === null ? (
          <p className="muted">
            Select a moment on any chart, including the existing air readings chart.
          </p>
        ) : (
          <>
            <p>
              {local(at, shared.timezone)} · nearest valid observation within ±
              {INSPECTION_TOLERANCE_SECONDS} seconds.{' '}
              {maintenance ? 'Maintenance · measurements excluded from interpretation.' : ''}
            </p>
            <div className="sensor-status-grid">
              <div>
                <strong>ENS160 · one-minute aggregate</strong>
                <p>
                  {ens && !maintenance
                    ? `TVOC ${ens.tvoc_mean} ppb · eCO₂ ${ens.eco2_mean} ppm · AQI ${ens.aqi_max}`
                    : 'No nearby reading'}
                </p>
                {ens && (
                  <small>
                    {ens.minute_start_utc} · Δ{' '}
                    {((Date.parse(ens.minute_start_utc) - at) / 1000).toFixed(3)} s
                  </small>
                )}
              </div>
              {data.sensors
                .filter((s) => s.sensor_type !== 'ens160')
                .map((s) => {
                  const row =
                    inspection?.at === at
                      ? inspection.rows.find((r) => r.sensor_id === s.id)
                      : undefined;
                  const observation = row?.observation;
                  return (
                    <div key={s.id}>
                      <strong>{s.label}</strong>
                      {inspection?.at !== at ? (
                        <p role="status">Loading nearby reading…</p>
                      ) : inspection.error ? (
                        <p role="alert">
                          Inspection unavailable. Select the moment again or retry updates.
                        </p>
                      ) : !observation ? (
                        <p className="muted">No nearby reading</p>
                      ) : (
                        <>
                          <small>
                            {observation.observed_at} · Δ{' '}
                            {((Date.parse(observation.observed_at) - at) / 1000).toFixed(3)} s
                          </small>
                          {Object.entries(observation.readings)
                            .filter(([k]) => !k.startsWith('number_'))
                            .map(([key, value]) => (
                              <p key={key}>
                                {metricLabels[key]?.label ?? key}:{' '}
                                {value === null
                                  ? 'Not available'
                                  : `${display(value)} ${metricLabels[key]?.unit ?? ''}`}
                              </p>
                            ))}
                          <details>
                            <summary>Acquisition and particle details</summary>
                            {Object.entries(observation.readings)
                              .filter(([k]) => k.startsWith('number_'))
                              .map(([key, value]) => (
                                <p key={key}>
                                  {metricLabels[key]?.label ?? key}:{' '}
                                  {value === null ? 'Not available' : `${display(value)} #/cm³`}
                                </p>
                              ))}
                            <pre>
                              {JSON.stringify(
                                { acquisition: observation.acquisition, derived: row?.derived },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
            <p className="muted">
              Window:{' '}
              {context?.window_open === undefined
                ? 'Not recorded'
                : context.window_open
                  ? 'Open'
                  : 'Closed'}{' '}
              · Resident:{' '}
              {context?.user_in_room === undefined
                ? 'Not recorded'
                : context.user_in_room
                  ? 'Present'
                  : 'Absent'}
            </p>
            {shared.reports
              .filter((r) => Math.abs(Date.parse(r.reported_at) - at) <= 60000)
              .map((r) => (
                <p key={r.id}>
                  {r.smell_type || 'Smell report'} · {r.intensity}/5 ·{' '}
                  {local(Date.parse(r.reported_at), shared.timezone)}
                </p>
              ))}
            <p className="muted">
              Weather:{' '}
              {nearbyWeather
                ? `${windDescription(nearbyWeather)} · ${nearbyWeather.observed_at_utc}`
                : 'No nearby weather observation (±15 minutes)'}
            </p>
          </>
        )}
      </section>
    </section>
  );
}
function EnvironmentPlots({
  sensors,
  primary,
  points,
  ...shared
}: Shared & { sensors: Sensor[]; primary?: Sensor; points: Bucket[] }) {
  const [compare, setCompare] = useState(false);
  const shown = compare ? sensors : primary ? [primary] : [];
  return (
    <>
      <label className="row">
        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />{' '}
        Compare BME690 environmental sources
      </label>
      <div className="sensor-small-grid">
        {['temperature_c', 'humidity_pct', 'pressure_pa'].map((metric) => (
          <SensorPlot
            key={metric}
            {...shared}
            title={metricLabels[metric].label}
            unit={metricLabels[metric].unit}
            series={shown.map((s) => ({ id: s.id, sensorId: s.id, metric, label: s.label }))}
            points={points}
            sensors={shown}
          />
        ))}
      </div>
    </>
  );
}

// This section owns its requests: new-sensor slowness cannot hold ENS160/context refreshes.
export function LiveSensorAnalysis(
  props: Omit<
    Parameters<typeof SensorAnalysis>[0],
    'data' | 'updating' | 'onRetry' | 'refreshError'
  >,
) {
  const [retry, setRetry] = useState(0);
  const key = `${props.deviceId}:${props.start}:${props.end}:${retry}`;
  const [result, setResult] = useState<{
    key: string;
    deviceId?: string;
    start: number;
    end: number;
    data: SensorArrayData;
    failed: boolean;
  } | null>(null);
  const { deviceId, start, end } = props;
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const finish = (data: SensorArrayData) => {
      if (disposed) return;
      setResult((previous) => {
        // Keep the mounted plots and their controls during refreshes and outages.
        // Never reuse readings from a different collector, or move old buckets
        // onto a new time axis before the matching response arrives.
        if (
          data.unavailable &&
          previous &&
          previous.deviceId === deviceId &&
          !previous.data.unavailable
        )
          return { ...previous, key, failed: true };
        return { key, deviceId, start, end, data, failed: data.unavailable };
      });
    };
    void Promise.resolve()
      .then(() => loadSensorArray(browserClient(), deviceId, start, end, signal))
      .then(finish)
      .catch(() => {
        finish({ sensors: [], points: [], bucket_seconds: 1, unavailable: true });
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [deviceId, start, end, key]);
  const current = result?.deviceId === deviceId ? result : null;
  return (
    <SensorAnalysis
      {...props}
      start={current?.start ?? start}
      end={current?.end ?? end}
      data={current?.data}
      updating={current?.key !== key}
      refreshError={current?.failed}
      onRetry={() => setRetry((n) => n + 1)}
    />
  );
}
