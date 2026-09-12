import 'server-only';
import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase/server';
export async function requireUser() {
  const db = await serverClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  return { db, user };
}
