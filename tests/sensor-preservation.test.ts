import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { handleSensorIngest } from '../lib/sensors/ingest';
import { hashDeviceKey } from '../lib/domain/ingest';
import type { SensorPayload } from '../lib/sensors/contract';

test('Phase II preserves existing database objects/data and supports the full HTTP-to-SQL sensor lifecycle', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to authenticated,anon,service_role;`);
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const additions = files.filter((f) => f >= '202609170002');
    for (const file of files.filter((f) => !additions.includes(f)))
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001',
      resident = '00000000-0000-4000-8000-000000000002';
    await db.exec(
      `insert into auth.users(id,email) values('${owner}','owner@test.invalid'),('${resident}','resident@test.invalid');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const site = (await db.query<{ id: string }>("select public.create_site('Test site') id"))
      .rows[0].id;
    await db.query('select public.add_resident($1,$2)', [site, 'resident@test.invalid']);
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Pi','preservation') returning id",
        [site],
      )
    ).rows[0].id;
    const token = `dn_${'a'.repeat(43)}`,
      pepper = 'p'.repeat(32),
      digest = hashDeviceKey(token, pepper);
    await db.query('select public.rotate_device_key($1,$2)', [device, digest]);
    await db.exec('reset role;set role service_role');
    const legacy = {
      device_identifier: 'preservation',
      minute_start_utc: '2026-01-01T00:00:00Z',
      tvoc_mean: 50,
      tvoc_min: 40,
      tvoc_max: 60,
      eco2_mean: 450,
      eco2_min: 400,
      eco2_max: 500,
      aqi_max: 1,
      sample_count: 12,
    };
    await db.query('select public.ingest_minute($1,$2)', [legacy, digest]);
    await db.query(
      "insert into public.smell_reports(site_id,user_id,intensity,reported_at) values($1,$2,3,'2026-01-01T00:00:00Z')",
      [site, owner],
    );
    await db.query(
      "insert into public.site_state_events(site_id,user_id,event_type,value,recorded_at) values($1,$2,'window_open',true,'2026-01-01T00:00:00Z')",
      [site, owner],
    );
    await db.query(
      "insert into public.weather_observations(site_id,observed_at_utc,wind_speed_kmh,wind_direction_deg) values($1,'2026-01-01T00:00:00Z',12,225)",
      [site],
    );
    await db.exec('reset role');
    const tables = (
      await db.query<{ relname: string }>(
        "select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname",
      )
    ).rows.map((r) => r.relname);
    async function existingSnapshot() {
      const data = await Promise.all(
        tables.map(async (table) => ({
          table,
          rows: (
            await db.query(
              `select to_jsonb(t) data from public.${table} t order by to_jsonb(t)::text`,
            )
          ).rows,
        })),
      );
      const schema = (
        await db.query(
          `select c.relname,c.relacl::text,c.relrowsecurity,
    (select jsonb_agg(to_jsonb(a) order by attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0) columns,
    (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid) constraints,
    (select jsonb_agg(to_jsonb(p) order by p.polname) from pg_policy p where p.polrelid=c.oid) policies,
    (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid) from pg_index i where i.indrelid=c.oid) indexes
    from pg_class c where c.relnamespace='public'::regnamespace and c.relname=any($1) order by c.relname`,
          [tables],
        )
      ).rows;
      return { data, schema };
    }
    const functions = (
      await db.query<{ oid: number; definition: string }>(
        "select oid,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by oid",
      )
    ).rows;
    const before = await existingSnapshot();
    for (const file of additions)
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    assert.deepEqual(
      await existingSnapshot(),
      before,
      'all existing rows, columns, grants, RLS, constraints and indexes must remain unchanged',
    );
    for (const fn of functions)
      assert.equal(
        (
          await db.query<{ definition: string }>('select pg_get_functiondef($1::oid) definition', [
            fn.oid,
          ])
        ).rows[0].definition,
        fn.definition,
      );
    await db.exec('set role service_role');
    const send = async (payload: unknown) =>
      handleSensorIngest(
        new Request('https://local.test/api/ingest/sensors', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        async (p: SensorPayload, key: string) => ({
          data: (
            await db.query<{ result: string }>(
              'select public.ingest_sensor_observation($1,$2) result',
              [p, key],
            )
          ).rows[0].result,
          error: null,
        }),
        pepper,
      );
    const base = {
      schema_version: 1,
      device_identifier: 'preservation',
      sensor_key: 'bme690_01',
      sensor_type: 'bme690',
      observed_at: '2026-01-01T00:00:00.123456Z',
      sequence_number: 1,
      status: 'ok',
      valid: true,
      readings: { gas_resistance_ohm: 100 },
    };
    assert.equal((await send(base)).status, 200);
    assert.equal((await (await send(base)).json()).result, 'duplicate');
    assert.equal((await send({ ...base, readings: { gas_resistance_ohm: 101 } })).status, 409);
    assert.equal((await send({ ...base, readings: { gas_resistance_ohm: 'NaN' } })).status, 400);
    assert.equal(
      (
        await send({
          ...base,
          sensor_key: 'bme690_02',
          status: 'error',
          valid: false,
          readings: {},
          error_code: 'I2C',
        })
      ).status,
      200,
    );
    const sgp = {
      ...base,
      sensor_key: 'sgp41_01',
      sensor_type: 'sgp41',
      observed_at: '2026-01-01T00:00:00.4Z',
      readings: { raw_voc_ticks: 30000, raw_nox_ticks: 18000 },
      derived: { algorithm: 'example', algorithm_version: 'test', voc_index: 100 },
    };
    assert.equal((await send(sgp)).status, 200);
    assert.equal((await (await send(sgp)).json()).result, 'duplicate');
    assert.equal((await send({ ...sgp, derived: { ...sgp.derived, voc_index: 101 } })).status, 409);
    const pm = {
      ...base,
      sensor_key: 'sps30_01',
      sensor_type: 'sps30',
      observed_at: '2026-01-01T00:00:00.6Z',
      readings: { pm1_ug_m3: 0, pm2_5_ug_m3: 1, pm4_ug_m3: 2, pm10_ug_m3: 3 },
    };
    assert.equal((await send(pm)).status, 200);
    assert.equal((await db.query('select * from public.sensor_observations')).rows.length, 4);
    await db.exec('reset role');
    assert.deepEqual(
      await existingSnapshot(),
      before,
      'new sensor traffic must not alter ENS160 heartbeat or any legacy data',
    );
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${resident}'`);
    assert.equal((await db.query('select * from public.sensor_derived_values')).rows.length, 1);
    assert.equal(
      (await db.query("update public.sensors set label='forged' returning id")).rows.length,
      0,
    );
    await assert.rejects(db.query('delete from public.sensor_observations'));
    const nearest = (
      await db.query<{ data: { observation: { observed_at: string } | null }[] }>(
        "select public.sensor_nearest($1,'2026-01-01T00:00:00Z',60) data",
        [device],
      )
    ).rows[0].data;
    assert.equal(nearest.filter((r) => r.observation).length, 3);
    assert.ok(nearest.some((r) => r.observation?.observed_at.includes('.123456')));
    await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
    for (const table of ['sensors', 'sensor_observations', 'sensor_derived_values'])
      assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0);
    assert.deepEqual(
      (
        await db.query<{ data: unknown }>(
          "select public.sensor_nearest($1,'2026-01-01T00:00:00Z',60) data",
          [device],
        )
      ).rows[0].data,
      [],
    );
    await db.exec(`set request.jwt.claim.sub='${owner}'`);
    const second = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Second','other') returning id",
        [site],
      )
    ).rows[0].id;
    await db.query('select public.register_sensor_array($1)', [second]);
    await db.exec('reset role;set role service_role');
    assert.equal((await send({ ...base, device_identifier: 'other' })).status, 401);
    await db.query(
      "update public.sensors set enabled=false where device_id=$1 and sensor_key='sps30_01'",
      [device],
    );
    assert.equal((await send(pm)).status, 422);
    await db.query(
      "update public.sensors set enabled=true where device_id=$1 and sensor_key='sps30_01'",
      [device],
    );
    // One seven-day stream exceeds PostgREST's usual 1,000-row result limit.
    await db.query(
      `insert into public.sensor_observations(sensor_id,sensor_type,observed_at,status,valid,readings)
      select id,'bme690','2026-02-01Z'::timestamptz+n*interval '1 minute','ok',true,jsonb_build_object('gas_resistance_ohm',n)
      from public.sensors cross join generate_series(0,10080) n where device_id=$1 and sensor_key='bme690_01'`,
      [device],
    );
    const buckets = (
      await db.query<{ data: { points: { count: number; max: number }[] } }>(
        "select public.sensor_chart_window($1,'2026-02-01Z','2026-02-08Z') data",
        [device],
      )
    ).rows[0].data.points;
    assert.equal(
      buckets.reduce((sum, p) => sum + p.count, 0),
      10081,
    );
    assert.equal(Math.max(...buckets.map((p) => p.max)), 10080);
    assert.ok(buckets.length <= 361);
    await db.query(
      "insert into public.site_state_events(site_id,user_id,event_type,value,recorded_at) values($1,$2,'maintenance',true,'2026-02-01T00:00:00Z'),($1,$2,'maintenance',false,'2026-02-01T00:01:00Z')",
      [site, owner],
    );
    const filtered = (
      await db.query<{ data: { points: { count: number; min: number }[] } }>(
        "select public.sensor_chart_window($1,'2026-02-01Z','2026-02-02Z') data",
        [device],
      )
    ).rows[0].data.points;
    assert.equal(filtered[0].count, 3);
    assert.equal(filtered[0].min, 1);
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    await db.query('select public.revoke_device_key($1)', [device]);
    await db.exec('reset role;set role service_role');
    assert.equal((await send(pm)).status, 401);
    assert.equal(
      (await db.query<{ ok: boolean }>('select public.ingest_minute($1,$2) ok', [legacy, digest]))
        .rows[0].ok,
      false,
    );
  } finally {
    await db.close();
  }
});

test('protected Phase I sources remain byte-identical to the audited working checkout', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/phase-i-preservation.json', 'utf8'),
  ) as Record<string, string>;
  for (const [file, hash] of Object.entries(manifest))
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash, file);
});
