import { captureApiError, captureDevice, captureJson } from '@/lib/captures/device-api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const auth = await captureDevice(request);
  if (!auth) return Response.json({ error: 'Invalid device credentials.' }, { status: 401 });
  try {
    const body = (await captureJson(request)) as { session_id?: unknown; measurements?: unknown };
    if (
      typeof body.session_id !== 'string' ||
      !Array.isArray(body.measurements) ||
      !body.measurements.length ||
      body.measurements.length > 500
    )
      throw new Error('Invalid measurement batch.');
    const { data: session } = await auth.db
      .from('capture_sessions')
      .select('id,configuration_id,requested_at,completed_at')
      .eq('id', body.session_id)
      .eq('device_id', auth.deviceId)
      .maybeSingle();
    if (!session) return Response.json({ error: 'Unknown capture.' }, { status: 404 });
    const { data: sensors, error: sensorsError } = await auth.db
      .from('sensors')
      .select('id,sensor_key,sensor_type')
      .eq('device_id', auth.deviceId);
    if (sensorsError)
      return Response.json({ error: 'Sensor registry unavailable.' }, { status: 503 });
    const byKey = new Map((sensors || []).map((sensor) => [sensor.sensor_key, sensor]));
    const rows = body.measurements.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid measurement.');
      const row = item as Record<string, unknown>;
      if (
        typeof row.sensor_key !== 'string' ||
        typeof row.sensor_type !== 'string' ||
        typeof row.sequence_number !== 'number' ||
        !Number.isSafeInteger(row.sequence_number) ||
        row.sequence_number < 0 ||
        typeof row.acquired_at !== 'string' ||
        !Number.isFinite(Date.parse(row.acquired_at)) ||
        !['preparing', 'settling', 'recording', 'recovery'].includes(String(row.phase))
      )
        throw new Error('Invalid measurement.');
      const sensor = byKey.get(row.sensor_key);
      if (!sensor || sensor.sensor_type !== row.sensor_type)
        throw new Error('Unknown capture sensor.');
      for (const field of ['readings', 'units', 'validity', 'applied_settings'] as const)
        if (
          row[field] !== undefined &&
          (!row[field] || typeof row[field] !== 'object' || Array.isArray(row[field]))
        )
          throw new Error('Invalid measurement metadata.');
      const acquired = Date.parse(row.acquired_at);
      if (acquired < Date.parse(session.requested_at) - 1000 || acquired > Date.now() + 300000)
        throw new Error('Measurement timestamp is outside the capture.');
      return {
        session_id: session.id,
        configuration_id: session.configuration_id,
        sensor_id: sensor.id,
        sensor_key: row.sensor_key,
        sensor_type: row.sensor_type,
        acquired_at: row.acquired_at,
        sequence_number: row.sequence_number,
        phase: row.phase,
        sensor_startup_elapsed_seconds:
          typeof row.sensor_startup_elapsed_seconds === 'number'
            ? row.sensor_startup_elapsed_seconds
            : null,
        scan_cycle_index: row.scan_cycle_index ?? null,
        heater_step_index: row.heater_step_index ?? null,
        readings: row.readings || {},
        units: row.units || {},
        validity: row.validity || {},
        applied_settings: row.applied_settings || {},
      };
    });
    const { error } = await auth.db.from('capture_measurements').upsert(rows, {
      onConflict: 'session_id,sensor_key,sequence_number',
      ignoreDuplicates: true,
    });
    if (error) return Response.json({ error: 'Measurement upload unavailable.' }, { status: 503 });
    return Response.json(
      { ok: true, accepted: rows.length },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return captureApiError(error);
  }
}
