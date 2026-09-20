export type MetricDefinition = {
  label: string;
  unit: string;
  classification: 'raw' | 'derived' | 'context' | 'concentration';
  measures: string;
  interpretation: string;
  digitalNose: string;
  limitation: string;
  references: readonly string[];
  reference?: {
    value: number;
    unit: string;
    averagingPeriod: string;
    provenance: string;
    source: string;
    category: 'health-reference';
  };
};
export const metricCatalogue = {
  tvoc_mean: {
    label: 'TVOC',
    unit: 'ppb',
    classification: 'derived',
    measures: 'ENS160 estimate of a broad volatile-organic-compound response.',
    interpretation:
      'One-minute average. Changes can reflect cooking, cleaning or other gas mixtures.',
    digitalNose: 'Compare gas-response timing with particles and resident reports.',
    limitation: 'Cannot identify individual chemicals or establish safe air.',
    references: ['https://www.sciosense.com/wp-content/uploads/2023/12/ENS160-Datasheet.pdf'],
  },
  eco2_mean: {
    label: 'eCO₂',
    unit: 'ppm',
    classification: 'derived',
    measures: 'Equivalent CO₂ estimated by ENS160 from other gases; one-minute average.',
    interpretation:
      'ScioSense: 400–<600 Excellent; 600–<800 Good; 800–<1,000 Fair; 1,000–1,500 Poor; >1,500 Bad.',
    digitalNose: 'Adds context to broad gas-response events.',
    limitation: 'Not a direct CO₂ measurement or a CO₂ safety assessment.',
    references: ['https://www.sciosense.com/wp-content/uploads/2023/12/ENS160-Datasheet.pdf'],
  },
  aqi_max: {
    label: 'AQI',
    unit: '/ 5',
    classification: 'derived',
    measures: 'ENS160 indoor air-quality index; highest index in each minute.',
    interpretation: 'ScioSense: 1 Excellent · 2 Good · 3 Moderate · 4 Poor · 5 Unhealthy.',
    digitalNose: 'Summarizes gas-response events alongside raw signals.',
    limitation: 'Manufacturer categories, not outdoor AQI, a diagnosis or source identification.',
    references: ['https://www.sciosense.com/wp-content/uploads/2023/12/ENS160-Datasheet.pdf'],
  },
  gas_resistance_ohm: {
    label: 'Gas resistance',
    unit: 'Ω',
    classification: 'raw',
    measures: 'Electrical resistance of the BME690 heated gas-sensing layer.',
    interpretation:
      'Compare changes from the same sensor and heater configuration. Neither 15 kΩ nor 30 kΩ universally means good or bad air.',
    digitalNose: 'Helps compare recurring gas-response patterns.',
    limitation:
      'Humidity, temperature and heater settings affect resistance; it is not a pollutant concentration.',
    references: [
      'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme690-ds001.pdf',
    ],
  },
  temperature_c: {
    label: 'Temperature',
    unit: '°C',
    classification: 'context',
    measures: 'Temperature at the BME690 sensor.',
    interpretation: 'Higher means warmer; board and heater heat can influence it.',
    digitalNose: 'Provides context for gas-signal changes and compensation.',
    limitation: 'Not an air-quality score or proof of an odour source.',
    references: [
      'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme690-ds001.pdf',
    ],
  },
  humidity_pct: {
    label: 'Relative humidity',
    unit: '%RH',
    classification: 'context',
    measures: 'Moisture relative to saturation at the current temperature.',
    interpretation:
      'Higher means closer to saturation; temperature changes also affect relative humidity.',
    digitalNose: 'Provides context for gas-signal changes and compensation.',
    limitation: 'Not an air-quality score or proof of an odour source.',
    references: [
      'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme690-ds001.pdf',
    ],
  },
  pressure_pa: {
    label: 'Pressure',
    unit: 'hPa',
    classification: 'context',
    measures: 'Local atmospheric pressure at the BME690.',
    interpretation:
      '100 Pa = 1 hPa. Pressure changes describe environmental conditions, not pollution.',
    digitalNose: 'Provides context for gas-signal changes and compensation.',
    limitation: 'Not an air-quality score or proof of an odour source.',
    references: [
      'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme690-ds001.pdf',
    ],
  },
  raw_voc_ticks: {
    label: 'Raw VOC',
    unit: 'ticks',
    classification: 'raw',
    measures: 'Sensirion raw signal proportional to the logarithm of sensing-layer resistance.',
    interpretation:
      'Increasing ethanol lowers raw VOC ticks under manufacturer test conditions. Compare with this sensor’s baseline; 13,600, 15,000 or 30,000 has no universal good/bad meaning.',
    digitalNose: 'Adds an independent gas-response pattern for plume comparison.',
    limitation:
      'Not ppb, ppm or an air-quality index; compensation and conditioning affect the signal.',
    references: [
      'https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf',
    ],
  },
  raw_nox_ticks: {
    label: 'Raw NOx',
    unit: 'ticks',
    classification: 'raw',
    measures: 'Sensirion raw signal proportional to the logarithm of sensing-layer resistance.',
    interpretation:
      'Increasing NO₂ raises raw NOx ticks under manufacturer test conditions; other oxidizing gases can also affect it. Compare with this sensor’s baseline; 13,600, 15,000 or 30,000 has no universal good/bad meaning.',
    digitalNose: 'Adds an independent gas-response pattern for plume comparison.',
    limitation:
      'Not ppb, ppm or an air-quality index; compensation and conditioning affect the signal.',
    references: [
      'https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf',
    ],
  },
  pm1_ug_m3: {
    label: 'PM1.0',
    unit: 'µg/m³',
    classification: 'concentration',
    measures: 'SPS30 optical estimate of particle mass up to approximately 1.0 µm.',
    interpretation:
      'Higher means more estimated particulate mass. Size fractions overlap; do not add them together.',
    digitalNose: 'Compare particle events with gas-response timing.',
    limitation:
      'Optical estimates depend on aerosol properties and cannot identify composition or source.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  pm2_5_ug_m3: {
    label: 'PM2.5',
    unit: 'µg/m³',
    classification: 'concentration',
    measures: 'SPS30 optical estimate of particle mass up to approximately 2.5 µm.',
    interpretation:
      'Higher means more estimated particulate mass. Size fractions overlap; do not add them together. WHO 24-hour guideline: 15 µg/m³. UK DAQI also requires a 24-hour mean; this recent reading is neither assessment.',
    digitalNose: 'Compare particle events with gas-response timing.',
    limitation:
      'Optical estimates depend on aerosol properties and cannot identify composition or source.',
    references: [
      'https://sensirion.com/file/datasheet_sps30',
      'https://www.ncbi.nlm.nih.gov/books/NBK574582/table/fm-ch1.tab1/',
      'https://www.gov.uk/government/publications/health-effects-of-air-pollution/pollutant-concentrations-for-the-daily-air-quality-index-daqi',
    ],
    reference: {
      value: 15,
      unit: 'µg/m³',
      averagingPeriod: '24 hours',
      provenance: 'WHO 2021 guideline',
      source: 'https://www.ncbi.nlm.nih.gov/books/NBK574582/table/fm-ch1.tab1/',
      category: 'health-reference',
    },
  },
  pm4_ug_m3: {
    label: 'PM4',
    unit: 'µg/m³',
    classification: 'concentration',
    measures: 'SPS30 optical estimate of particle mass up to approximately 4 µm.',
    interpretation:
      'Higher means more estimated particulate mass. Size fractions overlap; do not add them together.',
    digitalNose: 'Compare particle events with gas-response timing.',
    limitation:
      'Optical estimates depend on aerosol properties and cannot identify composition or source.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  pm10_ug_m3: {
    label: 'PM10',
    unit: 'µg/m³',
    classification: 'concentration',
    measures: 'SPS30 optical estimate of particle mass up to approximately 10 µm.',
    interpretation:
      'Higher means more estimated particulate mass. Size fractions overlap; do not add them together. WHO 24-hour guideline: 45 µg/m³. UK DAQI also requires a 24-hour mean; this recent reading is neither assessment.',
    digitalNose: 'Compare particle events with gas-response timing.',
    limitation:
      'Optical estimates depend on aerosol properties and cannot identify composition or source.',
    references: [
      'https://sensirion.com/file/datasheet_sps30',
      'https://www.ncbi.nlm.nih.gov/books/NBK574582/table/fm-ch1.tab1/',
      'https://www.gov.uk/government/publications/health-effects-of-air-pollution/pollutant-concentrations-for-the-daily-air-quality-index-daqi',
    ],
    reference: {
      value: 45,
      unit: 'µg/m³',
      averagingPeriod: '24 hours',
      provenance: 'WHO 2021 guideline',
      source: 'https://www.ncbi.nlm.nih.gov/books/NBK574582/table/fm-ch1.tab1/',
      category: 'health-reference',
    },
  },
  number_pm0_5_cm3: {
    label: 'Particles 0.3–0.5 µm',
    unit: 'particles/cm³',
    classification: 'concentration',
    measures: 'Estimated number of particles from 0.3 to 0.5 µm per cubic centimetre.',
    interpretation:
      'Higher means more particles in this cumulative size range; do not add overlapping fractions.',
    digitalNose: 'Complements mass response when comparing particle events.',
    limitation: 'No universal health band; optical estimates do not identify particle composition.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  number_pm1_cm3: {
    label: 'Particles 0.3–1 µm',
    unit: 'particles/cm³',
    classification: 'concentration',
    measures: 'Estimated number of particles from 0.3 to 1 µm per cubic centimetre.',
    interpretation:
      'Higher means more particles in this cumulative size range; do not add overlapping fractions.',
    digitalNose: 'Complements mass response when comparing particle events.',
    limitation: 'No universal health band; optical estimates do not identify particle composition.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  number_pm2_5_cm3: {
    label: 'Particles 0.3–2.5 µm',
    unit: 'particles/cm³',
    classification: 'concentration',
    measures: 'Estimated number of particles from 0.3 to 2.5 µm per cubic centimetre.',
    interpretation:
      'Higher means more particles in this cumulative size range; do not add overlapping fractions.',
    digitalNose: 'Complements mass response when comparing particle events.',
    limitation: 'No universal health band; optical estimates do not identify particle composition.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  number_pm4_cm3: {
    label: 'Particles 0.3–4 µm',
    unit: 'particles/cm³',
    classification: 'concentration',
    measures: 'Estimated number of particles from 0.3 to 4 µm per cubic centimetre.',
    interpretation:
      'Higher means more particles in this cumulative size range; do not add overlapping fractions.',
    digitalNose: 'Complements mass response when comparing particle events.',
    limitation: 'No universal health band; optical estimates do not identify particle composition.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  number_pm10_cm3: {
    label: 'Particles 0.3–10 µm',
    unit: 'particles/cm³',
    classification: 'concentration',
    measures: 'Estimated number of particles from 0.3 to 10 µm per cubic centimetre.',
    interpretation:
      'Higher means more particles in this cumulative size range; do not add overlapping fractions.',
    digitalNose: 'Complements mass response when comparing particle events.',
    limitation: 'No universal health band; optical estimates do not identify particle composition.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  typical_particle_size_um: {
    label: 'Typical particle size',
    unit: 'µm',
    classification: 'context',
    measures: 'SPS30 estimate of typical particle size.',
    interpretation: 'Larger means a larger characteristic size, not more particles or worse air.',
    digitalNose: 'Helps compare particle-event patterns.',
    limitation: 'Not a full size distribution or chemical identification.',
    references: ['https://sensirion.com/file/datasheet_sps30'],
  },
  voc_index: {
    label: 'VOC Index',
    unit: 'index',
    classification: 'derived',
    measures: 'Sensirion Gas Index Algorithm output, distinct from raw ticks.',
    interpretation: 'Standard index scale 1–500; 100 represents the learned average VOC condition.',
    digitalNose:
      'Provides adaptive context for gas-response events when a valid derived stream exists.',
    limitation:
      'Requires algorithm history and readiness; not a concentration or health threshold.',
    references: [
      'https://sensirion.com/media/documents/ACD82D45/6294DFC0/Info_Note_Integration_VOC_NOx_Sensor.pdf',
    ],
  },
  nox_index: {
    label: 'NOx Index',
    unit: 'index',
    classification: 'derived',
    measures: 'Sensirion Gas Index Algorithm output, distinct from raw ticks.',
    interpretation:
      'Standard index scale 1–500; 1 represents the algorithm’s NOx background; higher values indicate events.',
    digitalNose:
      'Provides adaptive context for gas-response events when a valid derived stream exists.',
    limitation:
      'Requires algorithm history and readiness; not a concentration or health threshold.',
    references: [
      'https://sensirion.com/media/documents/ACD82D45/6294DFC0/Info_Note_Integration_VOC_NOx_Sensor.pdf',
    ],
  },
  compensation_temperature_c: {
    label: 'Compensation temperature',
    unit: '°C',
    classification: 'context',
    measures: 'Environmental input supplied for SGP41 compensation.',
    interpretation:
      'May be measured elsewhere or configured; it is not an independent SGP41 measurement.',
    digitalNose: 'Helps interpret changes in compensated gas signals.',
    limitation: 'Check acquisition provenance before treating it as room conditions.',
    references: [
      'https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf',
    ],
  },
  compensation_humidity_pct: {
    label: 'Compensation humidity',
    unit: '%RH',
    classification: 'context',
    measures: 'Environmental input supplied for SGP41 compensation.',
    interpretation:
      'May be measured elsewhere or configured; it is not an independent SGP41 measurement.',
    digitalNose: 'Helps interpret changes in compensated gas signals.',
    limitation: 'Check acquisition provenance before treating it as room conditions.',
    references: [
      'https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf',
    ],
  },
} as const satisfies Record<string, MetricDefinition>;
export type SensorMetric = keyof typeof metricCatalogue;
export function isSensorMetric(key: string): key is SensorMetric {
  return Object.hasOwn(metricCatalogue, key);
}
export function metricDescription(key: SensorMetric) {
  const m = metricCatalogue[key];
  return `Measures\n${m.measures} (${m.unit})\n\nInterpretation\n${m.interpretation}\n\nDigital Nose\n${m.digitalNose} ${m.limitation}`;
}
