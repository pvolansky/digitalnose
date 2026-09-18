import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('sensor migration preserves ENS160, registers an empty array, and isolates member reads', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to authenticated,anon,service_role;`);
    for (const name of ['202609120001_initial', '202609120002_ingest'])
      await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001';
    await db.exec(
      `insert into auth.users(id) values('${owner}'); set role authenticated; set request.jwt.claim.sub='${owner}';`,
    );
    const site = (await db.query<{ id: string }>("select public.create_site('Test') id")).rows[0]
      .id;
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Collector','test') returning id",
        [site],
      )
    ).rows[0].id;
    await db.query('select public.rotate_device_key($1,$2)', [device, 'a'.repeat(64)]);
    await db.exec('reset role; set role service_role');
    const legacy = {
      device_identifier: 'test',
      minute_start_utc: '2026-01-01T00:00:00Z',
      tvoc_mean: 10,
      tvoc_min: 5,
      tvoc_max: 15,
      eco2_mean: 450,
      eco2_min: 400,
      eco2_max: 500,
      aqi_max: 1,
      sample_count: 12,
    };
    await db.query('select public.ingest_minute($1,$2)', [legacy, 'a'.repeat(64)]);
    await db.exec('reset role');
    await db.exec(readFileSync('supabase/migrations/202609170002_sensor_array.sql', 'utf8'));
    for (const name of ['202609170003_sensor_ingestion', '202609170004_sensor_queries'])
      await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
    assert.equal((await db.query('select * from public.minute_aggregates')).rows.length, 1);
    assert.equal((await db.query('select * from public.sensors')).rows.length, 5);
    assert.equal((await db.query('select * from public.sensor_observations')).rows.length, 0);
    const sensor = (
      await db.query<{ id: string }>("select id from public.sensors where sensor_key='bme690_01'")
    ).rows[0].id;
    const insert =
      "insert into public.sensor_observations(sensor_id,sensor_type,observed_at,status,valid,readings) values($1,'bme690','2026-01-01T00:00:00.123Z','ok',true,$2)";
    await db.exec('set role service_role');
    await db.query(insert, [sensor, { gas_resistance_ohm: 12345, pressure_pa: 101325 }]);
    await assert.rejects(db.query(insert, [sensor, { gas_resistance_ohm: 12345 }]));
    await assert.rejects(db.query(insert, [sensor, { gas_resistance_ohm: 'NaN' }]), {
      code: '23514',
    });
    await assert.rejects(db.query(insert, [sensor, { gas_resistance_ohm: null }]), {
      code: '23514',
    });
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${owner}'`);
    assert.equal((await db.query('select * from public.sensor_observations')).rows.length, 1);
    await db.query('select public.register_sensor_array($1)', [device]);
    await db.query(
      "update public.sensors set location='window_side',freshness_seconds=240 where id=$1",
      [sensor],
    );
    await assert.rejects(
      db.query("update public.sensors set sensor_type='sps30' where id=$1", [sensor]),
    );
    assert.equal((await db.query('select * from public.sensors')).rows.length, 5);
    await assert.rejects(db.query(insert, [sensor, { gas_resistance_ohm: 1 }]));
    await assert.rejects(db.query('delete from public.sensors'));
    await db.exec("set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'");
    for (const table of ['sensors', 'sensor_observations', 'sensor_derived_values'])
      assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0);
    await assert.rejects(db.query('select public.register_sensor_array($1)', [device]));
    assert.equal(
      (await db.query("update public.sensors set label='forged' returning id")).rows.length,
      0,
    );
    await db.exec('reset role;set role service_role');
    const payload = {
      schema_version: 1,
      device_identifier: 'test',
      sensor_key: 'bme690_02',
      sensor_type: 'bme690',
      observed_at: '2026-01-01T00:00:00.820Z',
      sequence_number: 0,
      status: 'ok',
      valid: true,
      readings: { gas_resistance_ohm: 200 },
    };
    const ingest = async (p: unknown, key = 'a'.repeat(64)) =>
      (
        await db.query<{ result: string }>(
          'select public.ingest_sensor_observation($1,$2) result',
          [p, key],
        )
      ).rows[0].result;
    assert.equal(await ingest(payload, 'b'.repeat(64)), 'unauthorized');
    assert.equal(await ingest({ ...payload, sensor_key: 'missing' }), 'unknown_sensor');
    assert.equal(await ingest(payload), 'accepted');
    assert.equal(await ingest(payload), 'duplicate');
    assert.equal(await ingest({ ...payload, readings: { gas_resistance_ohm: 201 } }), 'conflict');
    await assert.rejects(
      ingest({
        ...payload,
        observed_at: '2026-01-01T00:00:01Z',
        readings: { gas_resistance_ohm: -1 },
      }),
    );
    assert.equal(
      await ingest({
        ...payload,
        sensor_key: 'sgp41_01',
        sensor_type: 'sgp41',
        observed_at: '2026-01-01T00:00:01.021Z',
        readings: { raw_voc_ticks: 123, raw_nox_ticks: 456 },
      }),
      'accepted',
    );
    assert.equal(
      await ingest({
        ...payload,
        observed_at: '2026-01-01T00:00:01.820Z',
        readings: { gas_resistance_ohm: 1000 },
      }),
      'accepted',
    );
    const health = (
      await db.query<{ data: unknown[] }>('select public.sensor_array_health($1) data', [device])
    ).rows[0].data;
    assert.equal(health.length, 5);
    const chart = (
      await db.query<{ data: { points: { min: number; max: number; count: number }[] } }>(
        "select public.sensor_chart_window($1,'2026-01-01T00:00:00Z','2026-01-01T01:00:00Z') data",
        [device],
      )
    ).rows[0].data;
    assert.ok(chart.points.some((p) => p.min === 200 && p.max === 1000 && p.count === 2));
    const nearby = (
      await db.query<{ data: { observation: { observed_at: string } | null }[] }>(
        "select public.sensor_nearest($1,'2026-01-01T00:00:01Z',60) data",
        [device],
      )
    ).rows[0].data;
    assert.equal(nearby.filter((n) => n.observation).length, 3);
    assert.equal(nearby.filter((n) => !n.observation).length, 1);
    const absent = (
      await db.query<{ data: { observation: unknown }[] }>(
        "select public.sensor_nearest($1,'2026-01-02T00:00:01Z',60) data",
        [device],
      )
    ).rows[0].data;
    assert.ok(absent.every((n) => n.observation === null));
    await db.exec(
      `reset role;set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'`,
    );
    assert.deepEqual(
      (await db.query<{ data: unknown }>('select public.sensor_array_health($1) data', [device]))
        .rows[0].data,
      [],
    );
    assert.deepEqual(
      (
        await db.query<{ data: { points: unknown[] } }>(
          "select public.sensor_chart_window($1,'2026-01-01T00:00:00Z','2026-01-01T01:00:00Z') data",
          [device],
        )
      ).rows[0].data.points,
      [],
    );
    await assert.rejects(ingest(payload));
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select * from public.sensors'));
  } finally {
    await db.close();
  }
});

test('every repository migration applies in order to a fresh PostgreSQL database', async () => {
  const { readdirSync } = await import('node:fs');
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to authenticated,anon,service_role;`);
    for (const file of readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    assert.equal((await db.query('select * from public.sensor_observations')).rows.length, 0);
  } finally {
    await db.close();
  }
});
