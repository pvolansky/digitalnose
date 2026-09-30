import { captureApiError, captureDevice, captureJson } from '@/lib/captures/device-api';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await captureDevice(request);
  if (!auth) return Response.json({ error: 'Invalid device credentials.' }, { status: 401 });
  try {
    const body = (await captureJson(request, 32_768)) as Record<string, unknown>;
    if (typeof body.session_id !== 'string' || !body.outcomes || typeof body.outcomes !== 'object')
      throw new Error('Invalid cleanup evidence.');
    const { data: session } = await auth.db
      .from('capture_sessions')
      .select('id')
      .eq('id', body.session_id)
      .eq('device_id', auth.deviceId)
      .maybeSingle();
    if (!session) return Response.json({ error: 'Unknown capture.' }, { status: 404 });
    const outcomes = Object.entries(body.outcomes as Record<string, unknown>).map(
      ([sensorKey, raw]) => {
        if (!raw || typeof raw !== 'object') throw new Error('Invalid cleanup outcome.');
        const outcome = raw as Record<string, unknown>;
        if (typeof outcome.attempted !== 'boolean' || typeof outcome.verified !== 'boolean')
          throw new Error('Invalid cleanup outcome.');
        return {
          session_id: session.id,
          sensor_key: sensorKey,
          attempted: outcome.attempted,
          verified: outcome.verified,
          recorded_at:
            typeof outcome.timestamp === 'string' && Number.isFinite(Date.parse(outcome.timestamp))
              ? outcome.timestamp
              : new Date().toISOString(),
          readback:
            outcome.readback && typeof outcome.readback === 'object' ? outcome.readback : {},
          error: typeof outcome.error === 'string' ? outcome.error.slice(0, 500) : null,
        };
      },
    );
    const { error } = await auth.db.from('capture_shutdown_outcomes').insert(outcomes);
    if (error && error.code !== '23505')
      return Response.json({ error: 'Cleanup evidence unavailable.' }, { status: 503 });
    return Response.json({ ok: true });
  } catch (error) {
    return captureApiError(error);
  }
}
