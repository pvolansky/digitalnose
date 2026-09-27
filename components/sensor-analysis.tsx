'use client';
import { useEffect, useId, useState, useRef, type ReactNode } from 'react';
import { browserClient } from '@/lib/supabase/client';
import {
  loadSensorArray,
  type SensorArrayData,
  type Sensor,
  type Bucket,
} from '@/lib/sensors/data';
import { ChartTimeSlider } from './chart-time-slider';
import { MetricInfo } from './metric-info';
import { isSensorMetric } from '@/lib/sensors/metric-info';
import {
  bucketGroups,
  metricLabels,
  preparePlot,
  chartAxis,
  axisLabel,
  relativeMetrics,
  pointQuality,
  coverageText,
  type PlotMode,
} from '@/lib/sensors/charts';
import type { Reading, SmellReport, StateEvent } from '@/lib/domain/types';
import { stateIntervals } from '@/lib/domain/timeline';
import type { WeatherObservation } from '@/lib/weather/types';
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
  controls,
  initialHiddenMetrics = [],
  ...shared
}: Shared & {
  title: string;
  unit: string;
  series: Series[];
  points: Bucket[];
  sensors: Sensor[];
  controls?: ReactNode;
  initialHiddenMetrics?: string[];
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
  const left = 78,
    right = width - 14;
  const axisTime = (time: number) =>
    width < 450
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: shared.timezone,
          hour: '2-digit',
          minute: '2-digit',
        }).format(time)
      : local(time, shared.timezone);
  const [hidden, setHidden] = useState<string[]>(() =>
    series.filter((s) => initialHiddenMetrics.includes(s.metric)).map((s) => s.id),
  );
  const [mode, setMode] = useState<PlotMode>('absolute');
  const canInspectBaseline =
    series.length > 0 && series.every((s) => relativeMetrics.has(s.metric));
  const visible = series.filter((s) => !hidden.includes(s.id));
  const rows = points.filter(
    (p) =>
      visible.some((s) => s.sensorId === p.sensor_id && s.metric === p.metric) &&
      Date.parse(p.at) >= shared.start &&
      Date.parse(p.at) < shared.end,
  );
  const { points: usable, baselines } = preparePlot(rows, mode);
  const axis = chartAxis(usable, mode);
  const plotUnit = mode === 'percent' ? '%' : unit;
  const percentUnavailable = [...baselines.values()].some((n) => n === 0);
  const x = (at: number) =>
    left + ((at - shared.start) / (shared.end - shared.start)) * (right - left);
  const y = (n: number) => 180 - ((n - axis.min) / (axis.max - axis.min)) * 140;
  const never = sensors.length > 0 && sensors.every((s) => !s.last_valid_reading_at);
  const at = shared.selectedAt;
  const [hover, setHover] = useState(false);
  const inspect = (clientX: number, element: SVGSVGElement) => {
    const r = element.getBoundingClientRect();
    shared.onSelect(
      shared.start +
        Math.max(0, Math.min(1, (((clientX - r.left) * width) / r.width - left) / (right - left))) *
          (shared.end - shared.start),
    );
  };
  const selected = at ?? shared.end;
  const details = (
    <>
      <span className="muted">{local(selected, shared.timezone)}</span>
      {visible.map((s) => {
        const candidates = usable.filter(
          (p) => p.sensor_id === s.sensorId && p.metric === s.metric,
        );
        const point = candidates.find(
          (p) =>
            selected >= Date.parse(p.first_observed_at) &&
            (selected < Date.parse(p.last_observed_at) ||
              (p.first_observed_at === p.last_observed_at &&
                selected === Date.parse(p.last_observed_at))),
        );
        return (
          <div key={s.id}>
            <strong>{s.label}</strong>:{' '}
            {point
              ? `${mode === 'absolute' ? 'mean' : 'mean deviation'} ${display(point.mean)} ${plotUnit}`
              : 'No reading at this time'}
            {point && (
              <small>
                {' '}
                · min {display(point.min)} · max {display(point.max)} {plotUnit}
                <br />
                {coverageText(point)}
                {mode !== 'absolute' && (
                  <>
                    <br />
                    Absolute mean {display(point.original.mean)} {unit} · baseline{' '}
                    {display(point.baseline!)} {unit}
                  </>
                )}
              </small>
            )}
          </div>
        );
      })}
    </>
  );
  return (
    <section ref={plotRef} className="sensor-plot" aria-labelledby={id}>
      <div className="row spread">
        <div className="row">
          <h3 id={id}>{title}</h3>
          {[...new Set(series.map((s) => s.metric))].length === 1 &&
            isSensorMetric(series[0]?.metric) && <MetricInfo metric={series[0].metric} />}
        </div>
        <span className="muted">{plotUnit}</span>
      </div>
      {controls}
      {canInspectBaseline && (
        <div
          className="segmented sensor-view-modes"
          role="group"
          aria-label={`${title} visualization`}
        >
          {(
            [
              ['absolute', 'Absolute'],
              ['delta', 'Δ from baseline'],
              ['percent', '% change'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              className={mode === value ? '' : 'secondary'}
              disabled={value === 'percent' && percentUnavailable}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <p className="sensor-plot-caption">
        {mode === 'absolute'
          ? series.every((s) => s.metric.startsWith('pm'))
            ? 'Zero-based scale'
            : 'Local scale · not necessarily zero-based'
          : 'Deviation scale · zero is the local baseline'}
        {' · '}Line: bucket mean · faint bars: observed min–max. Hollow points and dashed segments:
        partial or unknown quality. Empty buckets remain gaps.
      </p>
      {mode !== 'absolute' && (
        <p className="sensor-baseline-note">
          Baseline: median of visible bucket means, separately for each sensor, including partial
          valid buckets. Recalculated when the window or data changes; not a clean-air reference.
          {visible.map((s) => {
            const value = baselines.get(`${s.sensorId}:${s.metric}`);
            return value === undefined ? null : (
              <span key={s.id}>
                {' '}
                {s.label}: {display(value)} {unit}.
              </span>
            );
          })}
        </p>
      )}
      {mode === 'percent' && percentUnavailable && (
        <p role="status">
          Percentage unavailable for a zero baseline. Choose Absolute or Δ from baseline.
        </p>
      )}
      <div className="row sensor-legend">
        {series.map((s, i) => (
          <span key={s.id} className="row">
            <button
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
            {[...new Set(series.map((item) => item.metric))].length > 1 &&
              isSensorMetric(s.metric) && <MetricInfo metric={s.metric} />}
          </span>
        ))}
      </div>
      {!usable.length ? (
        <div className="sensor-empty">
          {!visible.length
            ? 'All series hidden'
            : never
              ? 'Awaiting sensor data'
              : 'No valid readings in this time range. Missing or excluded minutes are not filled.'}
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} 245`}
          className="sensor-svg"
          data-axis-min={axis.min}
          data-axis-max={axis.max}
          data-plot-mode={mode}
          role="group"
          tabIndex={0}
          aria-label={`${title}, ${plotUnit}. Click or use arrow keys to inspect a moment.`}
          onPointerMove={(e) => {
            if (e.pointerType !== 'touch') {
              setHover(true);
              inspect(e.clientX, e.currentTarget);
            }
          }}
          onPointerLeave={() => setHover(false)}
          onBlur={() => setHover(false)}
          onFocus={() => setHover(true)}
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
            if (e.key === 'Escape') setHover(false);
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
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
              <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
                {axisLabel(tick, axis.step)}
              </text>
            </g>
          ))}
          {mode !== 'absolute' && (
            <line
              x1={left}
              x2={right}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--muted)"
              strokeDasharray="4 4"
            />
          )}
          {visible.map((s) => {
            const colour = colours[series.findIndex((v) => v.id === s.id) % 4];
            const data = usable.filter((p) => p.sensor_id === s.sensorId && p.metric === s.metric);
            return (
              <g key={s.id}>
                {bucketGroups(data).flatMap((group, i) =>
                  group.slice(1).map((p, j) => {
                    const previous = group[j];
                    return (
                      <line
                        key={`${i}:${j}`}
                        x1={x(Date.parse(previous.at))}
                        y1={y(previous.mean)}
                        x2={x(Date.parse(p.at))}
                        y2={y(p.mean)}
                        stroke={colour}
                        strokeWidth="1.7"
                        strokeDasharray={
                          pointQuality(previous) === 'complete' && pointQuality(p) === 'complete'
                            ? undefined
                            : '4 3'
                        }
                      />
                    );
                  }),
                )}
                {data.map((p) => (
                  <g key={p.bucket}>
                    <line
                      x1={x(Date.parse(p.at))}
                      x2={x(Date.parse(p.at))}
                      y1={y(p.min)}
                      y2={y(p.max)}
                      stroke={colour}
                      strokeOpacity=".28"
                      strokeWidth="3"
                    />
                    <circle
                      cx={x(Date.parse(p.at))}
                      cy={y(p.mean)}
                      r={pointQuality(p) === 'complete' ? 2 : 3}
                      fill={pointQuality(p) === 'complete' ? colour : 'white'}
                      stroke={colour}
                      strokeWidth="1.5"
                      data-quality={pointQuality(p)}
                    >
                      <title>{`${s.label}: mean ${display(p.mean)}, min ${display(p.min)}, max ${display(p.max)} ${plotUnit}; ${coverageText(p)}${mode !== 'absolute' ? `; absolute mean ${display(p.original.mean)} ${unit}; baseline ${display(p.baseline!)} ${unit}` : ''}${p.acquisition_variants > 1 ? '; multiple heater settings' : ''}`}</title>
                    </circle>
                  </g>
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
      {hover && (
        <div className="sensor-value-tooltip" role="tooltip">
          {details}
        </div>
      )}
      {!!usable.length && (
        <ChartTimeSlider
          label={title}
          start={shared.start}
          end={shared.end}
          at={at}
          onSelect={shared.onSelect}
        >
          {details}
        </ChartTimeSlider>
      )}
    </section>
  );
}
export function SensorAnalysis({
  data,
  updating,
  refreshError = false,
  particulateControls,
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
  particulateControls?: ReactNode;
  onRetry: () => void;
}) {
  if (!data)
    return (
      <section className="sensor-analysis" aria-label="Sensor analysis" aria-busy="true">
        <p role="status">Loading sensor analysis…</p>
      </section>
    );
  if (data.unavailable)
    return (
      <section className="sensor-analysis" aria-label="Sensor analysis">
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
  return (
    <section className="sensor-analysis" aria-label="Sensor analysis" aria-busy={updating}>
      {(refreshError || updating) && (
        <div className="row spread">
          <div className="sensor-refresh-status" role="status">
            {refreshError ? (
              <span className="row">
                <span className="muted">Update failed · showing last loaded readings</span>
                <button className="secondary" onClick={onRetry} disabled={updating}>
                  Retry
                </button>
              </span>
            ) : (
              <span className="muted">{updating ? 'Updating…' : ''}</span>
            )}
          </div>
        </div>
      )}
      <p className="sensor-plot-caption">
        {data.bucket_seconds}-second buckets · statistics of valid sensor readings.
      </p>
      <SensorPlot
        {...shared}
        title="Particulate matter · SPS30"
        initialHiddenMetrics={['pm1_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3']}
        controls={<div className="particulate-controls">{particulateControls}</div>}
        unit="µg/m³"
        series={series(sps, ['pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3'])}
        points={data.points}
        sensors={sps}
      />
      <SensorPlot
        {...shared}
        title="BME690 gas response"
        unit="Ω"
        series={series(bme, ['gas_resistance_ohm'])}
        points={data.points}
        sensors={bme}
      />
      <div className="sensor-small-grid sensor-gas-grid">
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
      <EnvironmentPlots {...shared} points={data.points} sensors={bme} primary={primary} />
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
      <div className="sensor-small-grid sensor-environment-grid">
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
  > & { onSensors?: (sensors: Sensor[]) => void },
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
  const onSensors = props.onSensors;
  const sensors = current?.data.sensors;
  useEffect(() => {
    onSensors?.(sensors ?? []);
  }, [onSensors, sensors]);
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
