import { hashDeviceKey, readBoundedJson } from '@/lib/domain/ingest';
import { adminClient } from '@/lib/supabase/admin';

export async function captureDevice(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (dn_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return null;
  const db = adminClient();
  const digest = hashDeviceKey(token, process.env.DEVICE_KEY_PEPPER || '');
  const { data } = await db
    .from('device_api_keys')
    .select('device_id,devices!inner(id,device_identifier)')
    .eq('key_hash', digest)
    .is('revoked_at', null)
    .maybeSingle();
  return data ? { db, deviceId: data.device_id as string } : null;
}

export async function captureJson(request: Request, limit = 1_048_576) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new Error('Expected application/json.');
  return readBoundedJson(request, limit);
}

export function captureApiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Invalid request.';
  return Response.json(
    { error: message },
    { status: message === 'Payload too large.' ? 413 : 400 },
  );
}
