import type { Bucket } from './data';
import { metricCatalogue } from './metric-info';
export const metricLabels: Record<string, { label: string; unit: string }> = metricCatalogue;
export type PlotMode = 'absolute' | 'delta' | 'percent';
export type PlotPoint = Bucket & { original: Bucket; baseline: number | null };
export const relativeMetrics = new Set(['gas_resistance_ohm', 'raw_voc_ticks', 'raw_nox_ticks']);
const seriesKey = (p: Bucket) => `${p.sensor_id}:${p.metric}`;

// Display units. These floors prevent nearly constant/quantized values filling the plot.
const minimumSpans: Record<string, number> = {
  gas_resistance_ohm: 1000,
  raw_voc_ticks: 20,
  raw_nox_ticks: 20,
  temperature_c: 0.2,
  humidity_pct: 1,
  pressure_pa: 1, // hPa in the plot
};
export function displayBucket(point: Bucket): Bucket {
  if (point.metric !== 'pressure_pa') return { ...point };
  return {
    ...point,
    mean: point.mean / 100,
    min: point.min / 100,
    max: point.max / 100,
    first: point.first === undefined ? undefined : point.first / 100,
    last: point.last === undefined ? undefined : point.last / 100,
  };
}
export function preparePlot(points: Bucket[], mode: PlotMode) {
  const valid = points
    .filter((p) => p.count > 0 && [p.mean, p.min, p.max].every(Number.isFinite))
    .map(displayBucket);
  const baselines = new Map<string, number>();
  for (const key of new Set(valid.map(seriesKey))) {
    // Equal weight per displayed bucket, not a claim to be the median of raw samples.
    const values = valid
      .filter((p) => seriesKey(p) === key)
      .map((p) => p.mean)
      .sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    baselines.set(
      key,
      values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    );
  }
  const plotted: PlotPoint[] = [];
  for (const point of valid) {
    const baseline = baselines.get(seriesKey(point))!;
    if (mode === 'percent' && baseline === 0) continue; // Undefined, never invent a percentage.
    const transform = (n: number) =>
      mode === 'absolute' ? n : mode === 'delta' ? n - baseline : ((n - baseline) / baseline) * 100;
    plotted.push({
      ...point,
      original: point,
      baseline,
      mean: transform(point.mean),
      min: transform(point.min),
      max: transform(point.max),
    });
  }
  return { points: plotted, baselines };
}

export function chartAxis(points: PlotPoint[], mode: PlotMode = 'absolute') {
  if (!points.length) return { min: 0, max: 1, ticks: [0, 0.5, 1], step: 0.5 };
  const zeroBaseline = mode !== 'absolute' || points.every((p) => p.metric.startsWith('pm'));
  const low = Math.min(...points.map((p) => p.min));
  const high = Math.max(...points.map((p) => p.max));
  const floor = Math.max(
    ...points.map((p) => {
      const span = minimumSpans[p.metric] ?? 1;
      return mode === 'percent' ? (span / Math.abs(p.baseline!)) * 100 : span;
    }),
  );
  let min = zeroBaseline ? Math.min(0, low) : low;
  let max = zeroBaseline ? Math.max(0, high) : high;
  const center = (min + max) / 2;
  const span = Math.max(max - min, floor);
  min = center - span / 2 - span * 0.1;
  max = center + span / 2 + span * 0.1;
  // Physical nonnegative channels retain zero when the padded range reaches it.
  const nonnegative = mode === 'absolute' && points.every((p) => p.metric !== 'temperature_c');
  if (nonnegative) min = Math.max(0, min);
  const desired = (max - min) / 4;
  const power = 10 ** Math.floor(Math.log10(desired));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * power >= desired)! * power;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const tidy = (n: number) => Number(n.toPrecision(12));
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) =>
    tidy(min + i * step),
  );
  return { min: tidy(min), max: tidy(max), ticks, step };
}
export function axisLabel(value: number, step: number) {
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step)) + 1));
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits });
}
export function pointQuality(p: Bucket): 'complete' | 'partial' | 'unknown' {
  if (
    p.health === 'degraded' ||
    p.has_internal_gap ||
    (p.missing_count ?? 0) > 0 ||
    (p.expected_count != null && p.valid_count != null && p.valid_count < p.expected_count)
  )
    return 'partial';
  return p.health === 'normal' ? 'complete' : 'unknown';
}
export function coverageText(p: Bucket) {
  const counts = [`${p.count} samples`, `${pointQuality(p)} quality`];
  if (p.expected_count != null && p.expected_count > 0) {
    if (p.valid_count != null)
      counts.push(`${p.valid_count}/${p.expected_count} sensor readings valid`);
    if (p.missing_count != null)
      counts.push(
        `${Math.max(0, p.expected_count - p.missing_count)}/${p.expected_count} cadence slots occupied`,
      );
  } else counts.push('coverage unavailable');
  if (p.has_internal_gap) counts.push('contains a gap; line not joined');
  return counts.join(' · ');
}
export function bucketGroups<T extends Bucket>(points: T[]) {
  const groups: T[][] = [];
  let interrupted = false;
  for (const p of [...points].sort((a, b) => a.bucket - b.bucket)) {
    if (
      !Number.isFinite(p.mean) ||
      !Number.isFinite(p.min) ||
      !Number.isFinite(p.max) ||
      p.count <= 0
    ) {
      interrupted = true;
      continue;
    }
    const last = groups.at(-1);
    if (
      !last ||
      interrupted ||
      p.has_internal_gap ||
      last.at(-1)!.has_internal_gap ||
      p.bucket > last.at(-1)!.bucket + 1
    )
      groups.push([p]);
    else last.push(p);
    interrupted = false;
  }
  return groups;
}
