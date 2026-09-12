import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
test('weather migration enforces membership, server-only writes, coordinates and idempotency', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;`);
    await db.exec(readFileSync('supabase/migrations/202609120001_initial.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202609120005_weather.sql', 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001',
      resident = '00000000-0000-4000-8000-000000000002',
      stranger = '00000000-0000-4000-8000-000000000003';
    await db.query(
      `insert into auth.users(id,email) values ($1,'owner@test.invalid'),($2,'resident@test.invalid'),($3,'stranger@test.invalid')`,
      [owner, resident, stranger],
    );
    const login = async (id: string) =>
      db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}'`);
    await login(owner);
    const site = (await db.query<{ id: string }>("select public.create_site('Weather home') as id"))
      .rows[0].id;
    await db.query('select public.add_resident($1,$2)', [site, 'resident@test.invalid']);
    await db.query('update public.sites set latitude=51.5,longitude=0 where id=$1', [site]);
    await assert.rejects(db.query('update public.sites set latitude=91 where id=$1', [site]));
    await assert.rejects(db.query('update public.sites set latitude=null where id=$1', [site]));
    await db.exec('reset role; set role service_role');
    const insert = `insert into public.weather_observations(site_id,observed_at_utc,wind_speed_kmh,wind_direction_deg) values($1,'2026-09-12T12:00Z',18,225) on conflict(site_id,observed_at_utc,source) do update set wind_speed_kmh=excluded.wind_speed_kmh`;
    await db.query(insert, [site]);
    await db.query(insert, [site]);
    assert.equal((await db.query('select * from public.weather_observations')).rows.length, 1);
    await assert.rejects(db.query('update public.weather_observations set wind_direction_deg=361'));
    await assert.rejects(
      db.query('update public.weather_observations set relative_humidity_pct=101'),
    );
    await assert.rejects(db.query('update public.weather_observations set precipitation_mm=-1'));
    for (const user of [owner, resident]) {
      await login(user);
      assert.equal((await db.query('select * from public.weather_observations')).rows.length, 1);
      await assert.rejects(db.query(insert, [site]));
      await assert.rejects(db.query('update public.weather_observations set wind_speed_kmh=0'));
      await assert.rejects(db.query('delete from public.weather_observations'));
    }
    await db.query('update public.sites set latitude=0,longitude=0 where id=$1', [site]);
    assert.equal(
      (await db.query<{ latitude: number }>('select latitude from public.sites')).rows[0].latitude,
      51.5,
    );
    await db.exec('reset role');
    await db.exec(readFileSync('supabase/migrations/202609120006_location_privacy.sql', 'utf8'));
    for (const user of [owner, resident]) {
      await login(user);
      assert.equal((await db.query('select id,name from public.sites')).rows.length, 1);
      await assert.rejects(db.query('select latitude,longitude from public.sites'));
      await assert.rejects(db.query('select metadata from public.weather_observations'));
      assert.equal(
        (await db.query('select wind_speed_kmh from public.weather_observations')).rows.length,
        1,
      );
    }
    await assert.rejects(db.query('select * from public.get_weather_location($1)', [site]));
    await login(owner);
    assert.equal(
      (
        await db.query<{ latitude: number }>('select * from public.get_weather_location($1)', [
          site,
        ])
      ).rows[0].latitude,
      51.5,
    );
    await login(stranger);
    assert.equal(
      (await db.query('select wind_speed_kmh from public.weather_observations')).rows.length,
      0,
    );
    await assert.rejects(db.query('select * from public.get_weather_location($1)', [site]));
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.weather_observations'));
  } finally {
    await db.close();
  }
});
