import { adminClient } from '@/lib/supabase/admin';
import { handleSensorIngest } from '@/lib/sensors/ingest';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handleSensorIngest(
    request,
    async (payload, keyDigest) => {
      const { data, error } = await adminClient().rpc('ingest_sensor_observation', {
        payload,
        key_digest: keyDigest,
      });
      if (error) console.error('Sensor ingestion database failure', error.code);
      return { data, error };
    },
    process.env.DEVICE_KEY_PEPPER || '',
  );
}
