import { captureApiError, captureDevice, captureJson } from '@/lib/captures/device-api';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await captureDevice(request);
  if (!auth) return Response.json({ error: 'Invalid device credentials.' }, { status: 401 });
  const { data, error } = await auth.db
    .from('capture_sessions')
    .select('*,capture_configurations(id,version,config_hash,duration_seconds,snapshot)')
    .eq('device_id', auth.deviceId)
    .in('status', ['requested', 'preparing', 'recording'])
    .order('requested_at')
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ error: 'Command service unavailable.' }, { status: 503 });
  if (!data)
    return Response.json({ command: 'idle' }, { headers: { 'Cache-Control': 'no-store' } });
  return Response.json(
    { command: data.stop_requested_at ? 'stop' : 'capture', session: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = await captureDevice(request);
  if (!auth) return Response.json({ error: 'Invalid device credentials.' }, { status: 401 });
  try {
    const body = (await captureJson(request, 16_384)) as Record<string, unknown>;
    const event = String(body.event || '');
    const transitions: Record<string, string> = {
      preparing: 'preparing',
      recording: 'recording',
      completed: 'completed',
      cancelled: 'cancelled',
      failed: 'failed',
    };
    if (!transitions[event] || typeof body.session_id !== 'string')
      throw new Error('Invalid capture event.');
    const at =
      typeof body.at === 'string' && Number.isFinite(Date.parse(body.at))
        ? body.at
        : new Date().toISOString();
    const { data: current, error: currentError } = await auth.db
      .from('capture_sessions')
      .select('id,status,stop_requested_at')
      .eq('id', body.session_id)
      .eq('device_id', auth.deviceId)
      .maybeSingle();
    if (currentError)
      return Response.json({ error: 'Status service unavailable.' }, { status: 503 });
    if (!current) return Response.json({ error: 'Unknown capture.' }, { status: 404 });
    if (current.status === transitions[event]) return Response.json({ ok: true, duplicate: true });
    if (['completed', 'cancelled', 'failed'].includes(current.status))
      return Response.json({ error: 'Capture is already finished.' }, { status: 409 });
    const nextStatus =
      current.stop_requested_at && event === 'completed' ? 'cancelled' : transitions[event];
    const patch: Record<string, unknown> = { status: nextStatus };
    if (event === 'preparing') patch.device_preparing_at = at;
    if (event === 'recording') patch.device_started_at = at;
    if (['completed', 'cancelled', 'failed'].includes(event)) {
      patch.completed_at = at;
      patch.stopped_early = event === 'cancelled';
    }
    if (event === 'failed')
      patch.failure_code = String(body.failure_code || 'device_failure').slice(0, 100);
    const { data, error } = await auth.db
      .from('capture_sessions')
      .update(patch)
      .eq('id', body.session_id)
      .eq('device_id', auth.deviceId)
      .eq('status', current.status)
      .select('id')
      .maybeSingle();
    if (error) return Response.json({ error: 'Status update unavailable.' }, { status: 503 });
    if (!data) return Response.json({ error: 'Unknown capture.' }, { status: 404 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return captureApiError(error);
  }
}
