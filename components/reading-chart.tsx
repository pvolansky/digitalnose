'use client';
import { useState, useEffect, useRef, useId, useMemo } from 'react';
import { LuRadio, LuWind, LuUserRound, LuMessageCircle, LuTrendingUp } from 'react-icons/lu';
import type { Reading, StateEvent, SmellReport } from '@/lib/domain/types';
import { MetricBadge, MetricInfo } from './metric-info';
import { splitReadingGaps } from '@/lib/domain/readings';
import { contextAt, stateIntervals } from '@/lib/domain/timeline';
const metrics = {
  tvoc_mean: {
    label: 'TVOC',
    name: 'Volatile compounds',
    unit: 'ppb',
    description: 'Total volatile organic compounds · one-minute average',
  },
  eco2_mean: {
    label: 'eCO₂',
    name: 'Estimated CO₂',
    unit: 'ppm',
    description: 'Equivalent CO₂ estimate, not a direct CO₂ measurement · one-minute average',
  },
  aqi_max: {
    label: 'AQI',
    name: 'Air quality index',
    unit: '/ 5',
    description: 'ENS160 sensor index · highest value in each minute',
  },
} as const;
export function ReadingChart({
  readings,
  timezone,
  start,
  end,
  events = [],
  reports = [],
  userId = '',
}: {
  readings: Reading[];
  timezone: string;
  start: number;
  end: number;
  events?: StateEvent[];
  reports?: SmellReport[];
  userId?: string;
}) {
  const [metric, setMetric] = useState<keyof typeof metrics>('tvoc_mean');
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(980);
  const id = useId();
  const inspectorRef = useRef<HTMLDivElement>(null);
  const inspectMoment = (time: number) => {
    setSelectedAt(time);
    inspectorRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
  };
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const meta = metrics[metric];
  const peak = readings.reduce<Reading | undefined>(
    (best, r) => (!best || Number(r[metric]) > Number(best[metric]) ? r : best),
    undefined,
  );
  const max = peak ? Number(peak[metric]) : 10;
  const top = metric === 'aqi_max' ? 5 : Math.ceil((Math.max(10, max) * 1.12) / 10) * 10;
  const left = 42,
    right = width - 14,
    plotBottom = 218;
  const x = (time: number) => left + ((time - start) / (end - start)) * (right - left);
  const y = (value: number) => plotBottom - (value / top) * 176;
  const at = Math.min(
    end,
    Math.max(
      start,
      selectedAt ?? (readings.at(-1) ? Date.parse(readings.at(-1)!.minute_start_utc) : end),
    ),
  );
  const nearest = readings.reduce<Reading | undefined>(
    (best, r) =>
      !best ||
      Math.abs(Date.parse(r.minute_start_utc) - at) <
        Math.abs(Date.parse(best.minute_start_utc) - at)
        ? r
        : best,
    undefined,
  );
  const reading =
    nearest && Math.abs(Date.parse(nearest.minute_start_utc) - at) <= 60000 ? nearest : undefined;
  const context = contextAt(events, userId, at);
  const windowText =
    context.window_open === undefined
      ? 'Window not recorded'
      : context.window_open
        ? 'Window open'
        : 'Window closed';
  const occupancyText =
    context.user_in_room === undefined
      ? 'Presence not recorded'
      : context.user_in_room
        ? 'You were in the room'
        : 'You were away';
  const localTime = (n: number, short = false) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      ...(!short ? { month: 'short' as const, day: 'numeric' as const } : {}),
      hour: '2-digit',
      minute: '2-digit',
    }).format(n);
  const displayValue = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  const visibleReports = reports.filter(
    (r) => Date.parse(r.reported_at) >= start && Date.parse(r.reported_at) <= end,
  );
  const selectedReports = visibleReports.filter(
    (r) => Math.floor(Date.parse(r.reported_at) / 60000) === Math.floor(at / 60000),
  );
  const windowIntervals = useMemo(
    () => stateIntervals(events, userId, 'window_open', start, end),
    [events, userId, start, end],
  );
  const occupancyIntervals = useMemo(
    () => stateIntervals(events, userId, 'user_in_room', start, end),
    [events, userId, start, end],
  );
  const plotLines = useMemo(() => {
    const x = (time: number) => 42 + ((time - start) / (end - start)) * (width - 56);
    const y = (value: number) => 218 - (value / top) * 176;
    const plotBottom = 218;
    return (
      <>
        {' '}
        {splitReadingGaps(readings).map((group, i) => {
          const points = group
            .map(
              (r) =>
                `${x(Date.parse(r.minute_start_utc)).toFixed(2)},${y(Number(r[metric])).toFixed(2)}`,
            )
            .join(' ');
          return group.length === 1 ? (
            <circle
              key={i}
              cx={x(Date.parse(group[0].minute_start_utc))}
              cy={y(Number(group[0][metric]))}
              r="3"
              fill="var(--chart-line)"
            />
          ) : (
            <g key={i}>
              <polygon
                points={`${x(Date.parse(group[0].minute_start_utc))},${plotBottom} ${points} ${x(Date.parse(group.at(-1)!.minute_start_utc))},${plotBottom}`}
                fill={`url(#${id}-area)`}
              />
              <polyline
                points={points}
                fill="none"
                stroke="var(--chart-line)"
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </>
    );
  }, [readings, metric, start, end, width, top, id]);
  return (
    <section className="panel history-panel" aria-labelledby={`${id}-title`}>
      <div className="row spread chart-heading">
        <div>
          <p className="eyebrow">The full picture</p>
          <h2 id={`${id}-title`}>Readings & surroundings</h2>
        </div>
        <div className="segmented" role="group" aria-label="Chart measurement">
          {Object.entries(metrics).map(([key, value]) => (
            <button
              key={key}
              className={metric === key ? '' : 'secondary'}
              aria-pressed={metric === key}
              onClick={() => setMetric(key as keyof typeof metrics)}
            >
              {value.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row spread chart-description">
        <div>
          <h3>
            {meta.name} <span className="muted">{meta.unit}</span>
            <MetricInfo metric={metric} label={meta.label} />
          </h3>
          <p className="muted">{meta.description}</p>
        </div>
        {peak && (
          <button
            className="peak-button secondary"
            onClick={() => inspectMoment(Date.parse(peak.minute_start_utc))}
          >
            <LuTrendingUp aria-hidden="true" /> Peak {displayValue(Number(peak[metric]))}{' '}
            {meta.unit}
          </button>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-line" />
          Sensor reading
        </span>
        <span>
          <i className="legend-window" />
          Window open
        </span>
        <span>
          <i className="legend-presence" />
          You in the room
        </span>
        <span>
          <i className="legend-report" />
          Smell report
        </span>
      </div>
      <div ref={chartRef} className="chart-canvas">
        <svg
          viewBox={`0 0 ${width} 304`}
          style={{ width: '100%', height: 304, display: 'block' }}
          role="img"
          aria-label={`${meta.name} timeline with window, personal presence and smell reports. Use the time slider or event list to inspect.`}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch') return;
            const rect = e.currentTarget.getBoundingClientRect();
            setSelectedAt(
              start +
                Math.max(
                  0,
                  Math.min(
                    1,
                    (((e.clientX - rect.left) * width) / rect.width - left) / (right - left),
                  ),
                ) *
                  (end - start),
            );
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setSelectedAt(
              start +
                Math.max(
                  0,
                  Math.min(
                    1,
                    (((e.clientX - rect.left) * width) / rect.width - left) / (right - left),
                  ),
                ) *
                  (end - start),
            );
          }}
        >
          <title>{`${meta.name} · readings and recorded context`}</title>
          <defs>
            <pattern id={`${id}-unknown`} width="6" height="9" patternUnits="userSpaceOnUse">
              <rect width="6" height="9" fill="var(--paper)" />
              <path d="M0 4.5h3" stroke="var(--muted)" strokeOpacity=".5" />
            </pattern>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity=".12" />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {windowIntervals
            .filter((s) => s.value === true)
            .map((s) => (
              <rect
                key={s.start}
                x={x(s.start)}
                y="30"
                width={Math.max(0, x(s.end) - x(s.start))}
                height="188"
                fill="var(--window-fill)"
              />
            ))}
          {(metric === 'aqi_max' ? [0, 0.2, 0.4, 0.6, 0.8, 1] : [0, 0.25, 0.5, 0.75, 1]).map(
            (f) => (
              <g key={f}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(top * f)}
                  y2={y(top * f)}
                  stroke="var(--line)"
                  strokeDasharray={f ? '3 5' : undefined}
                />
                <text
                  x={left - 10}
                  y={y(top * f) + 4}
                  textAnchor="end"
                  fill="var(--muted)"
                  fontSize="11"
                >
                  {Math.round(top * f)}
                </text>
              </g>
            ),
          )}
          {plotLines}
          {visibleReports.map((r) => (
            <g key={r.id}>
              <line
                x1={x(Date.parse(r.reported_at))}
                x2={x(Date.parse(r.reported_at))}
                y1="24"
                y2={plotBottom}
                stroke="var(--report-color)"
                strokeOpacity=".45"
                strokeDasharray="3 4"
              />
              <circle cx={x(Date.parse(r.reported_at))} cy="23" r="4" fill="var(--report-color)" />
            </g>
          ))}
          <line
            x1={x(at)}
            x2={x(at)}
            y1="30"
            y2="290"
            stroke="var(--ink)"
            strokeOpacity=".35"
            strokeDasharray="3 3"
          />
          {reading && (
            <circle
              cx={x(Date.parse(reading.minute_start_utc))}
              cy={y(Number(reading[metric]))}
              r="4"
              fill="var(--chart-line)"
              stroke="white"
              strokeWidth="2"
            />
          )}
          <text x={left} y="238" fontSize="11" fill="var(--muted)">
            {localTime(start, end - start <= 21600000)}
          </text>
          <text x={right} y="238" textAnchor="end" fontSize="11" fill="var(--muted)">
            {localTime(end, end - start <= 21600000)}
          </text>
          {[windowIntervals, occupancyIntervals].map((intervals, index) => (
            <g key={index}>
              {intervals.map((s) => (
                <rect
                  key={s.start}
                  x={x(s.start)}
                  y={index ? 280 : 258}
                  width={Math.max(0, x(s.end) - x(s.start))}
                  height="9"
                  rx="2"
                  fill={
                    s.value === undefined
                      ? `url(#${id}-unknown)`
                      : s.value
                        ? index
                          ? 'var(--presence-color)'
                          : 'var(--window-color)'
                        : 'var(--inactive-fill)'
                  }
                />
              ))}
            </g>
          ))}
          {!readings.length && (
            <text
              x={(left + right) / 2}
              y="128"
              textAnchor="middle"
              fontSize="12"
              fill="var(--muted)"
            >
              Waiting for sensor readings
            </text>
          )}
        </svg>
      </div>
      <div className="track-key muted">
        <span>Tracks: window · your presence</span>
        <span>
          <i /> Grey = off · dashed = unrecorded
        </span>
      </div>
      <label className="scrubber-label" htmlFor={`${id}-time`}>
        Inspect a moment <span className="muted">Drag, tap the chart, or use arrow keys</span>
      </label>
      <input
        className="time-scrubber"
        id={`${id}-time`}
        type="range"
        min={0}
        max={Math.floor((end - start) / 60000)}
        step={1}
        value={Math.round((at - start) / 60000)}
        onChange={(e) => setSelectedAt(start + Number(e.target.value) * 60000)}
        aria-valuetext={`${localTime(at)}. ${reading ? `${meta.label} ${displayValue(Number(reading[metric]))} ${meta.unit}` : 'No reading'}. ${windowText}. ${occupancyText}.`}
      />
      <div ref={inspectorRef} className="chart-inspector" aria-label="Selected moment">
        <div className="inspector-reading">
          <span className="muted">
            {localTime(at)} · {timezone}
          </span>
          <strong>
            {reading ? displayValue(Number(reading[metric])) : '—'}{' '}
            <small>
              {meta.label} {meta.unit}
            </small>
          </strong>
          <MetricBadge metric={metric} value={reading ? Number(reading[metric]) : null} />
          {!reading && <span className="muted">No reading within this minute</span>}
        </div>
        <div className="inspector-context">
          <span className={context.window_open ? 'window-active' : ''}>
            <LuWind aria-hidden="true" />
            {windowText}
          </span>
          <span className={context.user_in_room ? 'presence-active' : ''}>
            <LuUserRound aria-hidden="true" />
            {occupancyText}
          </span>
        </div>
        <div className="inspector-reports">
          {selectedReports.length ? (
            selectedReports.map((r) => (
              <div key={r.id}>
                <span>
                  <LuMessageCircle aria-hidden="true" />
                  {r.smell_type || 'Smell reported'} · {r.intensity}/5
                </span>
                {r.note && <p>{r.note}</p>}
              </div>
            ))
          ) : (
            <span className="muted">No smell report at this minute</span>
          )}
        </div>
      </div>
      <p className="chart-help muted">
        Window shading and presence tracks show recorded context, not the cause of a peak. Gaps in
        the line mean missing sensor data.
      </p>
      <details className="timeline-details">
        <summary>
          Explore recorded events{' '}
          <span className="muted">
            ({visibleReports.length} reports ·{' '}
            {events.filter((e) => Date.parse(e.recorded_at) >= start).length} context changes)
          </span>
        </summary>
        <div className="event-list">
          {[
            ...visibleReports.map((r) => ({
              id: r.id,
              time: r.reported_at,
              label: `${r.smell_type || 'Smell report'} · intensity ${r.intensity}/5`,
              kind: 'report',
            })),
            ...events
              .filter(
                (e) =>
                  Date.parse(e.recorded_at) >= start &&
                  Date.parse(e.recorded_at) <= end &&
                  (e.event_type === 'window_open' || e.user_id === userId),
              )
              .map((e) => ({
                id: e.id,
                time: e.recorded_at,
                label:
                  e.event_type === 'window_open'
                    ? e.value
                      ? 'Window opened'
                      : 'Window closed'
                    : e.value
                      ? 'You entered the room'
                      : 'You left the room',
                kind: e.event_type,
              })),
          ]
            .sort((a, b) => b.time.localeCompare(a.time))
            .map((e) => (
              <button
                className="event-item secondary"
                key={e.id}
                onClick={() => inspectMoment(Date.parse(e.time))}
              >
                <span className={`event-dot ${e.kind}`} />
                {e.label}
                <time dateTime={e.time}>{localTime(Date.parse(e.time))}</time>
              </button>
            ))}
          {!visibleReports.length && !events.some((e) => Date.parse(e.recorded_at) >= start) && (
            <p className="muted">No events recorded in this range.</p>
          )}
        </div>
      </details>
      {!!readings.length && (
        <details className="timeline-details">
          <summary>View latest 60 readings as a table</summary>
          <div className="readings-table">
            <table>
              <thead>
                <tr>
                  <th>Local time</th>
                  <th>TVOC ppb</th>
                  <th>eCO₂ ppm</th>
                  <th>AQI</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {readings
                  .slice(-60)
                  .reverse()
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{localTime(Date.parse(r.minute_start_utc))}</td>
                      <td>{r.tvoc_mean}</td>
                      <td>{r.eco2_mean}</td>
                      <td>{r.aqi_max}</td>
                      <td>{r.sample_count}/12</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!readings.length && (
        <p className="muted empty-chart">
          <LuRadio aria-hidden="true" /> Context and reports are still available while your sensor
          connects.
        </p>
      )}
    </section>
  );
}
