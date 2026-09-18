import { hashDeviceKey, readBoundedJson } from '@/lib/domain/ingest';
import { validateSensorPayload, type SensorPayload } from './contract';
type Ingest = (
  payload: SensorPayload,
  keyDigest: string,
) => Promise<{ data: unknown; error: { code?: string } | null }>;
export async function handleSensorIngest(request: Request, ingest: Ingest, pepper: string) {
  const token = request.headers.get('authorization')?.match(/^Bearer (dn_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return Response.json({ error: 'Invalid device credentials.' }, { status: 401 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return Response.json({ error: 'Expected application/json.' }, { status: 415 });
  let payload;
  try {
    payload = validateSensorPayload(await readBoundedJson(request, 16384));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload.';
    return Response.json(
      { error: message },
      { status: message === 'Payload too large.' ? 413 : 400 },
    );
  }
  try {
    const { data, error } = await ingest(payload, hashDeviceKey(token, pepper));
    if (error)
      return Response.json({ error: 'Ingestion unavailable. Retry later.' }, { status: 503 });
    const statuses: Record<string, number> = {
      unauthorized: 401,
      unknown_sensor: 422,
      invalid_topology: 422,
      conflict: 409,
    };
    if (typeof data === 'string' && statuses[data])
      return Response.json({ error: data }, { status: statuses[data] });
    if (data !== 'accepted' && data !== 'duplicate')
      return Response.json({ error: 'Unexpected ingestion result.' }, { status: 503 });
    return Response.json({ ok: true, result: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Ingestion unavailable. Retry later.' }, { status: 503 });
  }
}
