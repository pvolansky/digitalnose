'use client';
import { useState } from 'react';
import type { CaptureMeasurement } from '@/lib/captures/types';

const names: Record<string, string> = {
  bme690_01: 'BME690 #1',
  bme690_02: 'BME690 #2',
  sgp41_01: 'SGP41',
  sps30_01: 'SPS30',
  gas_resistance_ohm: 'Gas resistance',
  temperature_c: 'Temperature',
  humidity_pct: 'Humidity',
  pressure_pa: 'Pressure',
  raw_voc_ticks: 'Raw VOC',
  raw_nox_ticks: 'Raw NOx',
  compensation_temperature_c: 'Compensation temperature',
  compensation_humidity_pct: 'Compensation humidity',
  pm1_ug_m3: 'PM1.0',
  pm2_5_ug_m3: 'PM2.5',
  pm4_ug_m3: 'PM4',
  pm10_ug_m3: 'PM10',
  number_pm0_5_cm3: 'Particles ≥0.5 µm',
  number_pm1_cm3: 'Particles ≥1 µm',
  number_pm2_5_cm3: 'Particles ≥2.5 µm',
  number_pm4_cm3: 'Particles ≥4 µm',
  number_pm10_cm3: 'Particles ≥10 µm',
  typical_particle_size_um: 'Typical particle size',
};
const reportMetrics = new Set([
  'gas_resistance_ohm',
  'temperature_c',
  'humidity_pct',
  'pressure_pa',
  'raw_voc_ticks',
  'raw_nox_ticks',
  'pm1_ug_m3',
  'pm2_5_ug_m3',
  'pm4_ug_m3',
  'pm10_ug_m3',
]);
const number = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 2 });

function Sparkline({ rows, metric }: { rows: CaptureMeasurement[]; metric: string }) {
  const points = rows.map((row, index) => ({
    index,
    value: row.readings[metric],
    valid: row.validity.valid !== false,
  }));
  const values = points.filter(
    (point): point is { index: number; value: number; valid: boolean } =>
      point.valid && typeof point.value === 'number' && Number.isFinite(point.value),
  );
  if (!values.length) return <span className="muted">No valid data</span>;
  const low = Math.min(...values.map(({ value }) => value));
  const high = Math.max(...values.map(({ value }) => value));
  const span = high - low || 1;
  const x = (index: number) => (rows.length === 1 ? 60 : 3 + (index * 114) / (rows.length - 1));
  const y = (value: number) => 31 - ((value - low) * 26) / span;
  const paths: string[] = [];
  let path = '';
  for (const point of points) {
    if (!point.valid || typeof point.value !== 'number' || !Number.isFinite(point.value)) {
      if (path) paths.push(path);
      path = '';
    } else path += `${path ? ' L' : 'M'} ${x(point.index)} ${y(point.value)}`;
  }
  if (path) paths.push(path);
  return (
    <svg
      className="capture-sparkline"
      viewBox="0 0 120 36"
      role="img"
      aria-label={`${names[metric] || metric} trend`}
    >
      {paths.map((segment, index) => (
        <path key={index} d={segment} />
      ))}
    </svg>
  );
}

export function CaptureMeasurements({
  measurements,
  exportData,
}: {
  measurements: CaptureMeasurement[];
  exportData: unknown;
}) {
  const [includeStartup, setIncludeStartup] = useState(false);
  const displayed = includeStartup
    ? measurements
    : measurements.filter((row) => row.phase === 'recording');
  const grouped = new Map<string, CaptureMeasurement[]>();
  for (const row of displayed)
    grouped.set(row.sensor_key, [...(grouped.get(row.sensor_key) || []), row]);
  const rows: {
    sensor: string;
    metric: string;
    samples: CaptureMeasurement[];
    step: number | null;
  }[] = [];
  for (const [sensor, samples] of grouped) {
    const metrics = [...new Set(samples.flatMap((sample) => Object.keys(sample.readings)))];
    for (const metric of metrics.filter((value) => reportMetrics.has(value))) {
      if (
        metric !== 'gas_resistance_ohm' ||
        !samples.some((sample) => sample.heater_step_index !== null)
      ) {
        rows.push({ sensor, metric, samples, step: null });
        continue;
      }
      const steps = [
        ...new Set(
          samples
            .map((sample) => sample.heater_step_index)
            .filter((value): value is number => value !== null),
        ),
      ].sort((a, b) => a - b);
      for (const step of steps)
        rows.push({
          sensor,
          metric,
          step,
          samples: samples.filter((sample) => sample.heater_step_index === step),
        });
    }
  }
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'digital-nose-capture.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  if (!measurements.length) return <p className="muted">No measurements were recorded.</p>;
  return (
    <div className="capture-report-table-wrap">
      <div className="capture-report-toolbar">
        <h2>Sensor readings</h2>
        <div className="row">
          <label className="capture-startup-toggle">
            <input
              type="checkbox"
              checked={includeStartup}
              onChange={(event) => setIncludeStartup(event.target.checked)}
            />
            Include startup
          </label>
          <button className="secondary" type="button" onClick={download}>
            Download JSON
          </button>
        </div>
      </div>
      <p className="muted capture-drift-note">
        Startup and per-step drift show change over this session; they cannot distinguish sensor
        settling from changing air.
      </p>
      <div className="table-scroll">
        <table className="capture-report-table">
          <thead>
            <tr>
              <th>Sensor</th>
              <th>Reading</th>
              <th>Range</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sensor, metric, samples, step }) => {
              const values = samples
                .map((sample) => sample.readings[metric])
                .filter(
                  (value): value is number => typeof value === 'number' && Number.isFinite(value),
                );
              const unit = samples.find((sample) => sample.units[metric])?.units[metric] || '';
              const heater = samples[0]?.applied_settings;
              const stepLabel =
                step === null
                  ? ''
                  : ` · ${heater?.heater_target_temperature_c}°C / ${heater?.heater_duration_ms} ms`;
              return (
                <tr key={`${sensor}-${metric}-${step ?? 'single'}`}>
                  <td>
                    <strong>{names[sensor] || sensor}</strong>
                  </td>
                  <td>
                    {names[metric] || metric.replaceAll('_', ' ')}
                    {stepLabel}
                  </td>
                  <td className="capture-range">
                    {values.length
                      ? `${number(Math.min(...values))}–${number(Math.max(...values))} ${unit}`
                      : '—'}
                  </td>
                  <td>
                    <Sparkline rows={samples} metric={metric} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
