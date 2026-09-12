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

// Reserve a readable label footprint, including at the chart edges.
export const WIND_LABEL_WIDTH = 100;
export const WIND_LABEL_GAP = 12;
export function weatherMarkerPosition(at: number, start: number, end: number, width: number) {
  const half = Math.min(WIND_LABEL_WIDTH / 2, width / 2);
  return Math.max(half, Math.min(width - half, ((at - start) / (end - start)) * width));
}

// Keep actual timestamps and favour the newest observation in crowded regions.
// This only reduces labels; the inspector still receives every observation.
export function weatherMarkers(
  weather: WeatherObservation[],
  start: number,
  end: number,
  width: number,
) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(end - start) || end <= start)
    return [];
  const candidates = weather
    .filter((row) => {
      const at = Date.parse(row.observed_at_utc);
      return Number.isFinite(at) && at >= start && at <= end;
    })
    .sort((a, b) => Date.parse(b.observed_at_utc) - Date.parse(a.observed_at_utc));
  const selected: WeatherObservation[] = [];
  let previousPosition = Infinity;
  for (const row of candidates) {
    const position = weatherMarkerPosition(Date.parse(row.observed_at_utc), start, end, width);
    if (previousPosition - position >= WIND_LABEL_WIDTH + WIND_LABEL_GAP) {
      selected.push(row);
      previousPosition = position;
    }
  }
  return selected.reverse();
}
