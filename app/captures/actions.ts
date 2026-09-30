'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import type { ActionResult } from '@/lib/domain/types';

export async function requestCapture(_: ActionResult, form: FormData): Promise<ActionResult> {
  const label = String(form.get('label') || '');
  const intensityText = String(form.get('intensity') || '');
  const notes = String(form.get('notes') || '').trim();
  if (!['smell_present', 'low_odour', 'other'].includes(label))
    return { error: 'Choose a capture label.' };
  const intensity = intensityText ? Number(intensityText) : null;
  if (intensity !== null && (!Number.isInteger(intensity) || intensity < 1 || intensity > 5))
    return { error: 'Choose an intensity from 1 to 5.' };
  if (notes.length > 1000) return { error: 'Keep notes under 1,000 characters.' };
  const siteId = String(form.get('site_id') || '');
  const { db } = await requireUser();
  const { data: owner, error: ownerError } = await db.rpc('is_site_owner', { target: siteId });
  if (ownerError || !owner) return { error: 'Only the site owner can request captures.' };
  const { error } = await db.rpc('request_capture', {
    target_site: siteId,
    target_device: String(form.get('device_id') || ''),
    target_configuration: String(form.get('configuration_id') || ''),
    capture_label: label,
    capture_intensity: intensity,
    capture_notes: notes,
    idempotency_key: String(form.get('request_key') || ''),
  });
  if (error)
    return {
      error: error.message.includes('already active')
        ? 'A capture is already active.'
        : 'Could not request the capture.',
    };
  revalidatePath('/dashboard');
  revalidatePath('/captures');
  return { message: 'Capture requested.' };
}

export async function stopCapture(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { db } = await requireUser();
  const sessionId = String(form.get('session_id') || '');
  const { data: session, error: sessionError } = await db
    .from('capture_sessions')
    .select('site_id')
    .eq('id', sessionId)
    .single();
  if (sessionError || !session) return { error: 'Capture not found.' };
  const { data: owner, error: ownerError } = await db.rpc('is_site_owner', {
    target: session.site_id,
  });
  if (ownerError || !owner) return { error: 'Only the site owner can stop captures.' };
  const { error } = await db.rpc('stop_capture', {
    target_session: sessionId,
  });
  if (error) return { error: 'Could not stop this capture.' };
  revalidatePath('/dashboard');
  revalidatePath('/captures');
  return { message: 'Stop requested.' };
}
