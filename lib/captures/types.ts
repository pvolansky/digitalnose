export type CaptureStatus =
  'requested' | 'preparing' | 'recording' | 'completed' | 'cancelled' | 'failed';

export type CaptureConfiguration = {
  id: string;
  device_id: string;
  version: string;
  config_hash: string;
  duration_seconds: number;
  snapshot: Record<string, unknown>;
  enabled: boolean;
};

export type CaptureSession = {
  id: string;
  site_id: string;
  device_id: string;
  requested_by: string;
  configuration_id: string;
  label: 'smell_present' | 'low_odour' | 'other';
  intensity: number | null;
  notes: string | null;
  context: Record<string, unknown>;
  requested_duration_seconds: number;
  status: CaptureStatus;
  requested_at: string;
  device_preparing_at: string | null;
  device_started_at: string | null;
  completed_at: string | null;
  stop_requested_at: string | null;
  stopped_early: boolean;
  failure_code: string | null;
  purpose: 'observation' | 'commissioning_test' | null;
  observed_odour:
    'restaurant_frying_oily' | 'other_odour' | 'no_noticeable_odour' | 'unsure_mixed' | null;
  suspected_source: string | null;
  episode_id: string | null;
  persistence_confirmation: 'same_throughout' | 'changed' | 'unsure' | null;
  persistence_confirmed_at: string | null;
};

export type CaptureAnnotation = {
  id: string;
  session_id: string;
  created_by: string;
  kind: 'smell_changed' | 'smell_gone';
  observed_at: string;
  created_at: string;
};

export type CaptureMeasurement = {
  id: string;
  session_id: string;
  configuration_id: string;
  sensor_id: string;
  sensor_key: string;
  sensor_type: string;
  acquired_at: string;
  received_at: string;
  sequence_number: number;
  phase: 'preparing' | 'settling' | 'recording' | 'recovery';
  sensor_startup_elapsed_seconds: number | null;
  scan_cycle_index: number | null;
  heater_step_index: number | null;
  readings: Record<string, number | null>;
  units: Record<string, string>;
  validity: Record<string, unknown>;
  applied_settings: Record<string, unknown>;
};

export const captureLabel = (label: CaptureSession['label']) =>
  ({ smell_present: 'Smell present', low_odour: 'Low odour', other: 'Other' })[label];

export const captureOdour = (session: CaptureSession) =>
  session.observed_odour
    ? (
        {
          restaurant_frying_oily: 'Restaurant-like frying/oily odour',
          other_odour: 'Other odour',
          no_noticeable_odour: 'No noticeable odour',
          unsure_mixed: 'Unsure / mixed',
        } as const
      )[session.observed_odour]
    : captureLabel(session.label);
