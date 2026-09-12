'use server';
import { requireUser } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/domain/types';
export async function createSite(_: ActionResult, form: FormData): Promise<ActionResult> {
  const name = String(form.get('name') || '').trim();
  if (!name || name.length > 100) return { error: 'Enter a site name of 1–100 characters.' };
  const { db } = await requireUser();
  const { data, error } = await db.rpc('create_site', { site_name: name });
  if (error) return { error: 'Could not create the site. Please try again.' };
  redirect(`/dashboard?site=${data}`);
}

export async function manageSettings(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { db, user } = await requireUser();
  const action = String(form.get('action'));
  const siteId = String(form.get('site_id') || '');
  const name = String(form.get('name') || '').trim();
  if (action === 'profile') {
    if (name.length > 100) return { error: 'Name is too long.' };
    const { error } = await db.from('profiles').update({ display_name: name }).eq('id', user.id);
    if (error) return { error: 'Could not save your name.' };
    revalidatePath('/settings');
    return { message: 'Name saved.' };
  }
  const { data: membership } = await db
    .from('site_members')
    .select('role')
    .eq('site_id', siteId)
    .eq('user_id', user.id)
    .single();
  if (membership?.role !== 'owner') return { error: 'Owner access required.' };
  let error;
  if (action === 'site') {
    const timezone = String(form.get('timezone') || 'Europe/London');
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format();
    } catch {
      return { error: 'Enter a valid IANA timezone, such as Europe/London.' };
    }
    if (!name || name.length > 100) return { error: 'Enter a name of 1–100 characters.' };
    ({ error } = await db
      .from('sites')
      .update({
        name,
        timezone,
        continuous_ventilation: form.get('continuous_ventilation') === 'on',
      })
      .eq('id', siteId));
  } else if (action === 'add-resident') {
    const email = String(form.get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };
    ({ error } = await db.rpc('add_resident', { target_site: siteId, resident_email: email }));
  } else if (action === 'remove-resident') {
    ({ error } = await db.rpc('remove_resident', {
      target_site: siteId,
      resident_id: String(form.get('user_id')),
    }));
  } else if (action === 'create-device' || action === 'update-device') {
    const identifier = String(form.get('device_identifier') || '').trim();
    if (!name || name.length > 100 || !/^[a-zA-Z0-9_-]{1,64}$/.test(identifier))
      return {
        error:
          'Enter a name and a device identifier using letters, numbers, underscores or hyphens.',
      };
    if (action === 'create-device')
      ({ error } = await db
        .from('devices')
        .insert({ site_id: siteId, name, device_identifier: identifier }));
    else
      ({ error } = await db
        .from('devices')
        .update({ name, device_identifier: identifier })
        .eq('site_id', siteId)
        .eq('id', String(form.get('device_id'))));
  } else if (action === 'rotate-key' || action === 'revoke-key') {
    const deviceId = String(form.get('device_id'));
    const { data: device } = await db
      .from('devices')
      .select('id')
      .eq('site_id', siteId)
      .eq('id', deviceId)
      .single();
    if (!device) return { error: 'Device not found.' };
    if (action === 'rotate-key') {
      const { randomBytes } = await import('node:crypto');
      const { hashDeviceKey } = await import('@/lib/domain/ingest');
      const key = `dn_${randomBytes(32).toString('base64url')}`;
      let digest;
      try {
        digest = hashDeviceKey(key, process.env.DEVICE_KEY_PEPPER || '');
      } catch {
        return { error: 'Set DEVICE_KEY_PEPPER on the server before generating keys.' };
      }
      ({ error } = await db.rpc('rotate_device_key', {
        target_device: deviceId,
        new_hash: digest,
      }));
      if (error) return { error: 'Could not rotate the device key.' };
      return {
        key,
        message:
          'New key created. Copy it now; it will not be shown again after you leave this page. Previous keys are revoked.',
      };
    }
    ({ error } = await db.rpc('revoke_device_key', { target_device: deviceId }));
  } else return { error: 'Unknown action.' };
  if (error)
    return {
      error:
        action === 'add-resident' && error.message.includes('sign up first')
          ? 'Ask the resident to sign up first, then add their email.'
          : 'Could not save this change. Check the values and try again.',
    };
  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { message: 'Saved.' };
}
