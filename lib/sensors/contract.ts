export type SensorType = 'ens160' | 'bme690' | 'sgp41' | 'sps30';
export type AcquisitionStatus = 'ok' | 'warming_up' | 'invalid' | 'error' | 'disconnected';
export const rawFields = {
  bme690: ['temperature_c', 'humidity_pct', 'pressure_pa', 'gas_resistance_ohm'],
  sgp41: [
    'raw_voc_ticks',
    'raw_nox_ticks',
    'compensation_temperature_c',
    'compensation_humidity_pct',
  ],
  sps30: [
    'pm1_ug_m3',
    'pm2_5_ug_m3',
    'pm4_ug_m3',
    'pm10_ug_m3',
    'number_pm0_5_cm3',
    'number_pm1_cm3',
    'number_pm2_5_cm3',
    'number_pm4_cm3',
    'number_pm10_cm3',
    'typical_particle_size_um',
  ],
} as const;
export type RawSensorType = keyof typeof rawFields;
export type SensorPayload = {
  schema_version: 1;
  device_identifier: string;
  sensor_key: string;
  sensor_type: RawSensorType;
  observed_at: string;
  sequence_number: number;
  status: AcquisitionStatus;
  valid: boolean;
  readings: Record<string, number | null>;
  acquisition: Record<string, unknown>;
  metadata: Record<string, unknown>;
  error_code?: string;
  last_error?: string;
  derived?: {
    algorithm: string;
    algorithm_version: string;
    voc_index?: number;
    nox_index?: number;
  };
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}.`);
}
function finiteJson(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('Metadata nesting is too deep.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number.');
  if (value && typeof value === 'object')
    for (const child of Object.values(value)) finiteJson(child, depth + 1);
}
export function validateSensorPayload(value: unknown, now = Date.now()): SensorPayload {
  const p = object(value);
  keys(p, [
    'schema_version',
    'device_identifier',
    'sensor_key',
    'sensor_type',
    'observed_at',
    'sequence_number',
    'status',
    'valid',
    'readings',
    'acquisition',
    'metadata',
    'error_code',
    'last_error',
    'derived',
  ]);
  if (p.schema_version !== 1) throw new Error('Unsupported schema_version.');
  if (typeof p.device_identifier !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.device_identifier))
    throw new Error('Invalid device_identifier.');
  if (typeof p.sensor_key !== 'string' || !/^[a-z0-9_]{1,64}$/.test(p.sensor_key))
    throw new Error('Invalid sensor_key.');
  if (typeof p.sensor_type !== 'string' || !Object.hasOwn(rawFields, p.sensor_type))
    throw new Error('Unsupported sensor_type.');
  // Up to microsecond precision is retained verbatim for PostgreSQL; JS time is used only for validation.
  if (
    typeof p.observed_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(p.observed_at)
  )
    throw new Error('observed_at must be an explicit UTC timestamp.');
  const time = Date.parse(p.observed_at);
  if (
    !Number.isFinite(time) ||
    time < 946684800000 ||
    time > now + 60000 ||
    new Date(time).toISOString().slice(0, 19) !== p.observed_at.slice(0, 19)
  )
    throw new Error('Invalid or future observed_at.');
  const sequence = p.sequence_number === undefined ? 0 : p.sequence_number;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
    throw new Error('Invalid sequence_number.');
  if (!['ok', 'warming_up', 'invalid', 'error', 'disconnected'].includes(p.status as string))
    throw new Error('Invalid status.');
  if (typeof p.valid !== 'boolean' || (p.valid && p.status !== 'ok'))
    throw new Error('Invalid measurement validity.');
  const readings = object(p.readings);
  const kind = p.sensor_type as RawSensorType;
  keys(readings, rawFields[kind]);
  for (const [key, n] of Object.entries(readings)) {
    if (n === null) continue;
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e100)
      throw new Error(`Invalid ${key}.`);
    if (key.endsWith('temperature_c')) {
      if (n < -273.15) throw new Error(`Invalid ${key}.`);
    } else if (key.endsWith('humidity_pct')) {
      if (n < 0 || n > 100) throw new Error(`Invalid ${key}.`);
    } else if (key.startsWith('raw_')) {
      if (n < 0 || n > 65535 || !Number.isInteger(n)) throw new Error(`Invalid ${key}.`);
    } else if (n < 0) throw new Error(`Invalid ${key}.`);
  }
  const required = {
    bme690: ['gas_resistance_ohm'],
    sgp41: ['raw_voc_ticks', 'raw_nox_ticks'],
    sps30: ['pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3'],
  }[kind];
  if (p.valid && required.some((k) => readings[k] === null || readings[k] === undefined))
    throw new Error('Valid observations require the primary raw measurements.');
  const acquisition = object(p.acquisition === undefined ? {} : p.acquisition),
    metadata = object(p.metadata === undefined ? {} : p.metadata);
  keys(acquisition, [
    'mux_channel',
    'heater_profile_id',
    'heater_step',
    'heater_target_temperature_c',
    'heater_duration_ms',
    'gas_valid',
    'heater_stable',
    'measurement_index',
    'conditioning',
    'device_status',
    'error_flags',
    'driver_version',
    'firmware_version',
  ]);
  for (const key of ['gas_valid', 'heater_stable', 'conditioning'])
    if (
      acquisition[key] !== undefined &&
      acquisition[key] !== null &&
      typeof acquisition[key] !== 'boolean'
    )
      throw new Error(`Invalid ${key}.`);
  for (const key of [
    'mux_channel',
    'heater_step',
    'measurement_index',
    'device_status',
    'error_flags',
  ]) {
    const n = acquisition[key];
    if (
      n !== undefined &&
      n !== null &&
      (typeof n !== 'number' ||
        !Number.isSafeInteger(n) ||
        n < 0 ||
        (key === 'mux_channel' && n > 7))
    )
      throw new Error(`Invalid ${key}.`);
  }
  for (const key of ['heater_target_temperature_c', 'heater_duration_ms']) {
    const n = acquisition[key];
    if (n !== undefined && n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0))
      throw new Error(`Invalid ${key}.`);
  }
  for (const key of ['heater_profile_id', 'driver_version', 'firmware_version'])
    if (
      acquisition[key] !== undefined &&
      acquisition[key] !== null &&
      (typeof acquisition[key] !== 'string' || (acquisition[key] as string).length > 100)
    )
      throw new Error(`Invalid ${key}.`);
  if (p.valid && (acquisition.gas_valid === false || acquisition.conditioning === true))
    throw new Error('Invalid acquisition cannot be marked valid.');
  for (const [key, max] of [
    ['error_code', 100],
    ['last_error', 500],
  ] as const)
    if (p[key] !== undefined && (typeof p[key] !== 'string' || (p[key] as string).length > max))
      throw new Error(`Invalid ${key}.`);
  if (p.derived !== undefined) {
    if (kind !== 'sgp41') throw new Error('Indices are only supported for SGP41.');
    const d = object(p.derived);
    keys(d, ['algorithm', 'algorithm_version', 'voc_index', 'nox_index']);
    for (const key of ['algorithm', 'algorithm_version'])
      if (
        typeof d[key] !== 'string' ||
        !(d[key] as string).length ||
        (d[key] as string).length > 100
      )
        throw new Error('Derived indices need algorithm provenance.');
    for (const key of ['voc_index', 'nox_index'])
      if (
        d[key] !== undefined &&
        (typeof d[key] !== 'number' ||
          !Number.isFinite(d[key]) ||
          (d[key] as number) < 0 ||
          (d[key] as number) > 500)
      )
        throw new Error(`Invalid ${key}.`);
  }
  finiteJson(p);
  return { ...p, sequence_number: sequence, acquisition, metadata } as SensorPayload;
}
