import type { SmellReport } from './types';
import type { WeatherObservation } from '../weather/types';

// Group markers by their displayed spacing, keeping every underlying report.
export function reportMarkers(reports: SmellReport[], start: number, end: number, width: number) {
  const groups: { at: number; reports: SmellReport[] }[] = [];
  const distance = ((end - start) * 28) / Math.max(1, width);
  for (const report of [...reports].sort((a, b) => a.reported_at.localeCompare(b.reported_at))) {
    const at = Date.parse(report.reported_at);
    if (at < start || at > end || !Number.isFinite(at)) continue;
    const previous = groups.at(-1);
    if (previous && at - previous.at < distance) previous.reports.push(report);
    else groups.push({ at, reports: [report] });
  }
  return groups;
}

// One actual observation per display bucket; never create or carry forward weather.
export function weatherMarkers(
  weather: WeatherObservation[],
  start: number,
  end: number,
  width: number,
) {
  const count = Math.max(1, Math.floor(width / 90));
  const buckets = new Map<number, WeatherObservation>();
  for (const row of weather) {
    const at = Date.parse(row.observed_at_utc);
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const bucket = Math.min(count - 1, Math.floor(((at - start) / (end - start)) * count));
    const previous = buckets.get(bucket);
    const centre = start + ((bucket + 0.5) / count) * (end - start);
    if (
      !previous ||
      Math.abs(at - centre) < Math.abs(Date.parse(previous.observed_at_utc) - centre)
    )
      buckets.set(bucket, row);
  }
  return [...buckets.values()].sort((a, b) => a.observed_at_utc.localeCompare(b.observed_at_utc));
}
