/** Explicit opt-in seed: creates an isolated demo site for an existing account. */
import { createClient } from '@supabase/supabase-js';
import { demoData } from '../lib/domain/demo';
const email = process.argv[2];
if (!email) throw new Error('Usage: npm run seed -- resident@example.com');
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
let userId: string | undefined;
for (let page = 1; page <= 1000; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (userId || data.users.length < 1000) break;
}
if (!userId) throw new Error('Create and confirm the account first.');
const siteId = 'de000000-0000-4000-8000-000000000001';
const deviceId = 'de000000-0000-4000-8000-000000000002';
const { data: existing, error: memberError } = await db
  .from('site_members')
  .select('user_id')
  .eq('site_id', siteId);
if (memberError) throw memberError;
if (existing.some((m) => m.user_id !== userId))
  throw new Error('Demo site already belongs to another account.');
function check(result: { error: unknown }) {
  if (result.error) throw result.error;
}
check(
  await db
    .from('sites')
    .upsert({ id: siteId, name: 'Demo · Illustrative readings', timezone: 'Europe/London' }),
);
check(await db.from('site_members').upsert({ site_id: siteId, user_id: userId, role: 'owner' }));
check(
  await db.from('devices').upsert({
    id: deviceId,
    site_id: siteId,
    name: 'Demo sensor',
    device_identifier: 'digitalnose-demo-only',
  }),
);
const { readings } = demoData(Date.now());
for (let i = 0; i < readings.length; i += 500) {
  const rows = readings
    .slice(i, i + 500)
    .map((r) => ({ ...r, id: undefined, device_id: deviceId }));
  check(
    await db.from('minute_aggregates').upsert(rows, { onConflict: 'device_id,minute_start_utc' }),
  );
}
console.log('Seeded 24 hours of illustrative readings in the separate Demo site.');
