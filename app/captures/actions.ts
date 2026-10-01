'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import type { ActionResult } from '@/lib/domain/types';

export async function requestCapture(_: ActionResult, form: FormData): Promise<ActionResult> {
  const purpose = String(form.get('purpose') || '');
  const odour = String(form.get('observed_odour') || '');
  const intensityText = String(form.get('intensity') || '');
  const suspectedSource = String(form.get('suspected_source') || '').trim();
  const notes = String(form.get('notes') || '').trim();
  if (!['observation', 'commissioning_test'].includes(purpose))
    return { error: 'Choose a capture purpose.' };
  if (
    !['restaurant_frying_oily', 'other_odour', 'no_noticeable_odour', 'unsure_mixed'].includes(
      odour,
    )
  )
    return { error: 'Choose what you observed.' };
  const intensity = intensityText ? Number(intensityText) : null;
  if (intensity !== null && (!Number.isInteger(intensity) || intensity < 0 || intensity > 5))
    return { error: 'Choose an intensity from 0 to 5.' };
  if (notes.length > 1000) return { error: 'Keep notes under 1,000 characters.' };
  if (suspectedSource.length > 200)
    return { error: 'Keep the suspected source under 200 characters.' };
  const siteId = String(form.get('site_id') || '');
  const { db } = await requireUser();
  const { data: owner, error: ownerError } = await db.rpc('is_site_owner', { target: siteId });
  if (ownerError || !owner) return { error: 'Only the site owner can request captures.' };
  const { error } = await db.rpc('request_capture_v2', {
    target_site: siteId,
    target_device: String(form.get('device_id') || ''),
    target_configuration: String(form.get('configuration_id') || ''),
    capture_purpose: purpose,
    capture_odour: odour,
    capture_intensity: intensity,
    capture_source: suspectedSource,
    capture_notes: notes,
    capture_episode: String(form.get('episode_id') || '') || null,
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

export async function annotateCapture(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { db } = await requireUser();
  const sessionId = String(form.get('session_id') || '');
  const kind = String(form.get('kind') || '');
  if (!['smell_changed', 'smell_gone'].includes(kind)) return { error: 'Invalid annotation.' };
  const { error } = await db.rpc('add_capture_annotation', {
    target_session: sessionId,
    annotation_kind: kind,
    annotation_at: new Date().toISOString(),
  });
  if (error) return { error: 'Could not save the annotation.' };
  revalidatePath('/captures');
  return { message: kind === 'smell_gone' ? 'Smell gone recorded.' : 'Smell change recorded.' };
}

export async function confirmCapture(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { db } = await requireUser();
  const sessionId = String(form.get('session_id') || '');
  const confirmation = String(form.get('confirmation') || '');
  if (!['same_throughout', 'changed', 'unsure'].includes(confirmation))
    return { error: 'Choose a confirmation.' };
  const { error } = await db.rpc('confirm_capture_persistence', {
    target_session: sessionId,
    confirmation,
  });
  if (error) return { error: 'Could not save the confirmation.' };
  revalidatePath('/captures');
  revalidatePath(`/captures/${sessionId}`);
  return { message: 'Confirmation saved.' };
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
