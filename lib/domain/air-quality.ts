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
  tvoc_mean:
    'TVOC estimates the total volatile organic compounds in the air, in ppb. Cooking, cleaning products and other sources can affect it.\n\nShown as a one-minute average. It cannot identify individual chemicals or establish whether the air is safe. Use the sensor AQI and recorded context to interpret changes.',
  eco2_mean:
    'eCO₂ is an estimate derived from other gases, not a direct CO₂ measurement. Shown as a one-minute average.\n\nENS160 guidance: 400–<600 Excellent; 600–<800 Good; 800–<1,000 Fair; 1,000–1,500 Poor; >1,500 Bad.\n\nAn estimated air-quality indicator, not a CO₂ safety measurement.',
  aqi_max:
    'The ENS160 indoor air-quality index is derived from its TVOC signal. It is not the outdoor AQI used in weather apps.\n\n1 Excellent · 2 Good · 3 Moderate · 4 Poor · 5 Unhealthy.\n\nShown as the highest index in each minute; TVOC is averaged, so the two can differ. Labels are sensor categories, not a diagnosis.',
};
