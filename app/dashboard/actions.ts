'use server';
import { requireUser } from '@/lib/auth/session';
import type { ActionResult } from '@/lib/domain/types';
export async function changeState(
  siteId: string,
  type: string,
  value: boolean,
): Promise<ActionResult> {
  if (!['window_open', 'user_in_room', 'maintenance'].includes(type) || typeof value !== 'boolean')
    return { error: 'Invalid context change.' };
  const { db, user } = await requireUser();
  const { data: owner, error: ownerError } = await db.rpc('is_site_owner', { target: siteId });
  if (ownerError || !owner) return { error: 'Only the owner can update room context.' };
  const { error } = await db
    .from('site_state_events')
    .insert({ site_id: siteId, user_id: user.id, event_type: type, value });
  if (error) return { error: 'Could not save this change. Please try again.' };
  return { message: 'Context updated.' };
}
