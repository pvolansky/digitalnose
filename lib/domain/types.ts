export type Site = {
  id: string;
  name: string;
  timezone: string;
  continuous_ventilation: boolean;
};
export type Device = {
  id: string;
  site_id: string;
  name: string;
  device_identifier: string;
  last_seen_at: string | null;
};
export type Reading = {
  id: string;
  device_id: string;
  minute_start_utc: string;
  tvoc_mean: number;
  tvoc_min: number;
  tvoc_max: number;
  eco2_mean: number;
  eco2_min: number;
  eco2_max: number;
  aqi_max: number;
  sample_count: number;
  created_at?: string;
};
export type SmellReport = {
  reporter_display_name?: string | null;
  id: string;
  site_id: string;
  user_id: string;
  reported_at: string;
  intensity: number;
  note: string | null;
  smell_type: string | null;
};
export type StateEvent = {
  id: string;
  site_id: string;
  user_id: string | null;
  event_type: 'window_open' | 'user_in_room' | 'maintenance';
  value: boolean;
  recorded_at: string;
};
export type ActionResult = { error?: string; message?: string; key?: string };
