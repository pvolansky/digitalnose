import type { Bucket } from './data';
import { metricCatalogue } from './metric-info';
export const metricLabels: Record<string, { label: string; unit: string }> = metricCatalogue;
export function bucketGroups(points: Bucket[]) {
  const groups: Bucket[][] = [];
  for (const p of points) {
    if (!Number.isFinite(p.mean) || !Number.isFinite(p.min) || !Number.isFinite(p.max)) continue;
    const last = groups.at(-1);
    if (!last || p.bucket > last.at(-1)!.bucket + 1) groups.push([p]);
    else last.push(p);
  }
  return groups;
}
