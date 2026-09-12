import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { hashDeviceKey, readBoundedJson, validateAggregate } from '@/lib/domain/ingest';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (dn_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return NextResponse.json({ error: 'Invalid device credentials.' }, { status: 401 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return NextResponse.json({ error: 'Expected application/json.' }, { status: 415 });
  let payload;
  try {
    payload = validateAggregate(await readBoundedJson(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload.';
    return NextResponse.json(
      { error: message },
      { status: message === 'Payload too large.' ? 413 : 400 },
    );
  }
  try {
    const keyHash = hashDeviceKey(token, process.env.DEVICE_KEY_PEPPER || '');
    const { data, error } = await adminClient().rpc('ingest_minute', {
      payload,
      key_digest: keyHash,
    });
    if (error) {
      console.error('Ingest database failure', error.code);
      return NextResponse.json({ error: 'Ingestion unavailable. Retry later.' }, { status: 503 });
    }
    if (!data) return NextResponse.json({ error: 'Invalid device credentials.' }, { status: 401 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('Ingest configuration or network failure');
    return NextResponse.json({ error: 'Ingestion unavailable. Retry later.' }, { status: 503 });
  }
}
