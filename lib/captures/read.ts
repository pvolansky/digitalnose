import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureConfiguration, CaptureSession } from './types';

export async function loadCaptureOverview(db: SupabaseClient, siteId: string, deviceId?: string) {
  if (!deviceId) return { configuration: null, active: null };
  const [configuration, active] = await Promise.all([
    db
      .from('capture_configurations')
      .select('*')
      .eq('device_id', deviceId)
      .eq('enabled', true)
      .maybeSingle(),
    db
      .from('capture_sessions')
      .select('*')
      .eq('site_id', siteId)
      .eq('device_id', deviceId)
      .in('status', ['requested', 'preparing', 'recording'])
      .maybeSingle(),
  ]);
  if (configuration.error || active.error) throw new Error('Unable to load capture readiness.');
  return {
    configuration: configuration.data as CaptureConfiguration | null,
    active: active.data as CaptureSession | null,
  };
}
