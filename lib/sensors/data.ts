import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcquisitionStatus, SensorType } from './contract';
import { loadReadings } from '@/lib/domain/readings';
import { loadTimeline } from '@/lib/domain/timeline';
import { loadWeather } from '@/lib/weather/read';
export type Observation = {
  id: string;
  sensor_id: string;
  sensor_type: SensorType;
  observed_at: string;
  received_at: string;
  sequence_number: number;
  status: AcquisitionStatus;
  valid: boolean;
  readings: Record<string, number | null>;
  acquisition: Record<string, unknown>;
  metadata: Record<string, unknown>;
  error_code: string | null;
  last_error: string | null;
};
export type Sensor = {
  id: string;
  device_id: string;
  sensor_key: string;
  sensor_type: SensorType;
  label: string;
  manufacturer: string;
  model: string;
  location: string;
  connection_type: string;
  mux_channel: number | null;
  enabled: boolean;
  freshness_seconds: number;
  metadata: Record<string, unknown>;
  last_seen_at: string | null;
  last_valid_reading_at: string | null;
  latest_observation: Observation | null;
};
export type SensorHealth =
  'AWAITING_DATA' | 'WARMING_UP' | 'LIVE' | 'STALE' | 'DISCONNECTED' | 'ERROR';
export function sensorHealth(sensor: Sensor, now: number): SensorHealth {
  const latest = sensor.latest_observation;
  const eventAt = latest?.observed_at ?? sensor.last_valid_reading_at;
  if (!eventAt) return 'AWAITING_DATA';
  const age = now - Date.parse(eventAt);
  if (!Number.isFinite(age) || age > sensor.freshness_seconds * 1000 || age < -60000)
    return 'STALE';
  if (latest?.status === 'disconnected') return 'DISCONNECTED';
  if (latest?.status === 'error' || latest?.status === 'invalid') return 'ERROR';
  if (latest?.status === 'warming_up') return 'WARMING_UP';
  if (latest && !latest.valid) return 'ERROR';
  if (!sensor.last_valid_reading_at) return 'AWAITING_DATA';
  return now - Date.parse(sensor.last_valid_reading_at) > sensor.freshness_seconds * 1000
    ? 'STALE'
    : 'LIVE';
}
export type Bucket = {
  sensor_id: string;
  metric: string;
  bucket: number;
  at: string;
  mean: number;
  min: number;
  max: number;
  count: number;
  first_observed_at: string;
  last_observed_at: string;
  acquisition_variants: number;
};
export type SensorArrayData = {
  sensors: Sensor[];
  points: Bucket[];
  bucket_seconds: number;
  unavailable: boolean;
};
export async function loadSensorArray(
  db: SupabaseClient,
  deviceId: string | undefined,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<SensorArrayData> {
  if (!deviceId) return { sensors: [], points: [], bucket_seconds: 1, unavailable: false };
  try {
    const healthQuery = db.rpc('sensor_array_health', { target_device: deviceId });
    const chartQuery = db.rpc('sensor_chart_window', {
      target_device: deviceId,
      window_start: new Date(start).toISOString(),
      window_end: new Date(end).toISOString(),
    });
    const [health, chart] = await Promise.all([
      signal ? healthQuery.abortSignal(signal) : healthQuery,
      signal ? chartQuery.abortSignal(signal) : chartQuery,
    ]);
    if (health.error || chart.error) throw new Error('Sensor array unavailable.');
    return {
      sensors: health.data ?? [],
      points: chart.data.points,
      bucket_seconds: chart.data.bucket_seconds,
      unavailable: false,
    };
  } catch {
    return { sensors: [], points: [], bucket_seconds: 1, unavailable: true };
  }
}
export type Nearby = {
  sensor_id: string;
  observation: Observation | null;
  derived: Record<string, unknown> | null;
};
export const INSPECTION_TOLERANCE_SECONDS = 60;
export async function loadNearestSensors(
  db: SupabaseClient,
  deviceId: string,
  at: number,
): Promise<Nearby[]> {
  const { data, error } = await db.rpc('sensor_nearest', {
    target_device: deviceId,
    selected_at: new Date(at).toISOString(),
    tolerance_seconds: INSPECTION_TOLERANCE_SECONDS,
  });
  if (error) throw new Error('Unable to inspect nearby observations.');
  return data ?? [];
}
// Research access preserves original rows, quality and independent times. No interpolation.
export async function getSensorWindow(
  db: SupabaseClient,
  deviceId: string,
  start: number,
  end: number,
  sensorIds?: string[],
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end - start < 60000 ||
    end - start > 7 * 86400000
  )
    throw new Error('Choose a window of up to seven days.');
  const { data: sensors, error } = await db
    .from('sensors')
    .select('id,sensor_type')
    .eq('device_id', deviceId);
  if (error) throw new Error('Unable to load sensor registry.');
  const selected = (sensors ?? []).filter((s) => !sensorIds || sensorIds.includes(s.id));
  const streams = await Promise.all(
    selected.map(async (sensor) => {
      if (sensor.sensor_type === 'ens160')
        return {
          sensor_id: sensor.id,
          kind: 'minute_aggregates',
          observations: await loadReadings(db, deviceId, '7D', Math.max(Date.now(), end), {
            start,
            end,
          }),
        };
      const observations: Observation[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db
          .from('sensor_observations')
          .select('*')
          .eq('sensor_id', sensor.id)
          .gte('observed_at', new Date(start).toISOString())
          .lte('observed_at', new Date(end).toISOString())
          .order('observed_at')
          .order('sequence_number')
          .range(offset, offset + 999);
        if (error) throw new Error('Unable to load raw sensor window.');
        observations.push(...data);
        if (data.length < 1000) break;
      }
      return { sensor_id: sensor.id, kind: 'raw_observations', observations };
    }),
  );
  return { start, end, streams };
}
export async function getContextualSensorWindow(
  db: SupabaseClient,
  siteId: string,
  deviceId: string,
  start: number,
  end: number,
  sensorIds?: string[],
) {
  // Caller membership is enforced by RLS on every source.
  const { data, error } = await db
    .from('devices')
    .select('id')
    .eq('id', deviceId)
    .eq('site_id', siteId)
    .maybeSingle();
  if (error || !data) throw new Error('Collector is unavailable for this site.');
  const [window, timeline, weather] = await Promise.all([
    getSensorWindow(db, deviceId, start, end, sensorIds),
    loadTimeline(db, siteId, start, end),
    loadWeather(db, siteId, start, end),
  ]);
  return { ...window, ...timeline, weather };
}
