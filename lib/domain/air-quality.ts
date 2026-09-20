import { metricDescription } from '../sensors/metric-info';
export type Metric = 'tvoc_mean' | 'eco2_mean' | 'aqi_max';
export type Rating = {
  label: string;
  tone: 'neutral' | 'green' | 'teal' | 'amber' | 'orange' | 'red';
};
const ratings: Rating[] = [
  { label: 'Excellent', tone: 'green' },
  { label: 'Good', tone: 'teal' },
  { label: 'Moderate', tone: 'amber' },
  { label: 'Poor', tone: 'orange' },
  { label: 'Unhealthy', tone: 'red' },
];
// ENS160 datasheet v1.3, tables 5 and 6. Shared boundaries enter the higher band.
export function airQualityRating(
  metric: Metric,
  value: number | null | undefined,
  stale = false,
): Rating {
  if (value == null || !Number.isFinite(value)) return { label: 'No data', tone: 'neutral' };
  if (stale) return { label: 'Out of date', tone: 'neutral' };
  if (metric === 'aqi_max')
    return Number.isInteger(value) && value >= 1 && value <= 5
      ? ratings[value - 1]
      : { label: 'Unavailable', tone: 'neutral' };
  if (metric === 'eco2_mean') {
    if (value < 400 || value > 65000) return { label: 'Outside sensor range', tone: 'neutral' };
    if (value < 600) return ratings[0];
    if (value < 800) return ratings[1];
    if (value < 1000) return { label: 'Fair', tone: 'amber' };
    if (value <= 1500) return ratings[3];
    return { label: 'Bad', tone: 'red' };
  }
  return { label: 'VOC estimate', tone: 'neutral' };
}
export const metricInfo: Record<Metric, string> = {
  tvoc_mean: metricDescription('tvoc_mean'),
  eco2_mean: metricDescription('eco2_mean'),
  aqi_max: metricDescription('aqi_max'),
};
