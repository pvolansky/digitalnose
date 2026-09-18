import type { Bucket } from './data';
export const metricLabels: Record<string, { label: string; unit: string }> = {
  gas_resistance_ohm: { label: 'Gas resistance', unit: 'Ω' },
  raw_voc_ticks: { label: 'Raw VOC', unit: 'ticks' },
  raw_nox_ticks: { label: 'Raw NOx', unit: 'ticks' },
  pm1_ug_m3: { label: 'PM1', unit: 'µg/m³' },
  pm2_5_ug_m3: { label: 'PM2.5', unit: 'µg/m³' },
  pm4_ug_m3: { label: 'PM4', unit: 'µg/m³' },
  pm10_ug_m3: { label: 'PM10', unit: 'µg/m³' },
  temperature_c: { label: 'Temperature', unit: '°C' },
  humidity_pct: { label: 'Relative humidity', unit: '%' },
  pressure_pa: { label: 'Pressure', unit: 'Pa' },
  number_pm0_5_cm3: { label: 'Particles 0.3–0.5 µm', unit: '#/cm³' },
  number_pm1_cm3: { label: 'Particles 0.3–1 µm', unit: '#/cm³' },
  number_pm2_5_cm3: { label: 'Particles 0.3–2.5 µm', unit: '#/cm³' },
  number_pm4_cm3: { label: 'Particles 0.3–4 µm', unit: '#/cm³' },
  number_pm10_cm3: { label: 'Particles 0.3–10 µm', unit: '#/cm³' },
  typical_particle_size_um: { label: 'Typical particle size', unit: 'µm' },
  compensation_temperature_c: { label: 'Compensation temperature', unit: '°C' },
  compensation_humidity_pct: { label: 'Compensation humidity', unit: '%' },
};
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
