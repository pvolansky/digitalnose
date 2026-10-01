import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('Phase IV sessions are idempotent, exclusive, immutable and keep captured context', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;`);
    for (const file of readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001';
    const resident = '00000000-0000-4000-8000-000000000002';
    await db.exec(`insert into auth.users(id,email) values('${owner}','owner@test.invalid'),('${resident}','resident@test.invalid');
      set role authenticated;set request.jwt.claim.sub='${owner}';`);
    const site = (await db.query<{ id: string }>("select public.create_site('Capture') id")).rows[0]
      .id;
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Pi','capture-pi') returning id",
        [site],
      )
    ).rows[0].id;
    await db.query('select public.register_sensor_array($1)', [device]);
    await db.query(
      "insert into public.site_state_events(site_id,user_id,event_type,value) values($1,$2,'window_open',true)",
      [site, owner],
    );
    await db.exec('reset role;set role service_role');
    const config = (
      await db.query<{ id: string }>(
        `insert into public.capture_configurations(device_id,version,config_hash,duration_seconds,snapshot,enabled)
       values($1,'phase4-v1',$2,300,$3,true) returning id`,
        [device, 'a'.repeat(64), { schema_version: 1, sensors: {} }],
      )
    ).rows[0].id;
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const key = '00000000-0000-4000-8000-000000000101';
    const request = () =>
      db.query<{ id: string }>('select public.request_capture($1,$2,$3,$4,$5,$6,$7) id', [
        site,
        device,
        config,
        'smell_present',
        5,
        'test',
        key,
      ]);
    const first = (await request()).rows[0].id;
    assert.equal((await request()).rows[0].id, first, 'retry returns the original session');
    await assert.rejects(
      db.query('select public.request_capture($1,$2,$3,$4,$5,$6,$7)', [
        site,
        device,
        config,
        'other',
        0,
        null,
        '00000000-0000-4000-8000-000000000102',
      ]),
      /already active/,
    );
    const context = (
      await db.query<{ context: Record<string, unknown> }>(
        'select context from public.capture_sessions where id=$1',
        [first],
      )
    ).rows[0].context;
    assert.equal(context.window_open, true);
    assert.ok(context.captured_at);
    await db.query('select public.stop_capture($1)', [first]);
    const cancelled = (
      await db.query<{ status: string; stopped_early: boolean }>(
        'select status,stopped_early from public.capture_sessions where id=$1',
        [first],
      )
    ).rows[0];
    assert.deepEqual(cancelled, { status: 'cancelled', stopped_early: true });

    const second = (
      await db.query<{ id: string }>('select public.request_capture($1,$2,$3,$4,$5,$6,$7) id', [
        site,
        device,
        config,
        'low_odour',
        null,
        null,
        '00000000-0000-4000-8000-000000000103',
      ])
    ).rows[0].id;
    await db.exec('reset role;set role service_role');
    await db.query(
      "insert into public.site_members(site_id,user_id,role) values($1,$2,'resident')",
      [site, resident],
    );
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${resident}'`);
    await assert.rejects(
      db.query('select public.request_capture($1,$2,$3,$4,$5,$6,$7)', [
        site,
        device,
        config,
        'other',
        null,
        null,
        '00000000-0000-4000-8000-000000000104',
      ]),
      /owner access required/i,
    );
    await assert.rejects(
      db.query('select public.stop_capture($1)', [second]),
      /cannot be stopped/i,
    );

    await db.exec('reset role;set role service_role');
    await assert.rejects(
      db.query("update public.capture_sessions set status='recording' where id=$1", [first]),
      /Invalid capture status transition/,
    );
    await assert.rejects(
      db.query("update public.capture_configurations set snapshot='{}' where id=$1", [config]),
      /immutable/,
    );
  } finally {
    await db.close();
  }
});

test('Phase IV measurements require the session configuration and cannot be changed', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;`);
    for (const file of readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001';
    await db.exec(
      `insert into auth.users(id) values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const site = (await db.query<{ id: string }>("select public.create_site('Capture') id")).rows[0]
      .id;
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Pi','capture-pi') returning id",
        [site],
      )
    ).rows[0].id;
    await db.query('select public.register_sensor_array($1)', [device]);
    await db.exec('reset role;set role service_role');
    const configs = (
      await db.query<{ id: string }>(
        `insert into public.capture_configurations(device_id,version,config_hash,duration_seconds,snapshot,enabled)
       values($1,'v1',$2,300,'{}',true),($1,'v2',$3,300,'{}',false) returning id`,
        [device, 'a'.repeat(64), 'b'.repeat(64)],
      )
    ).rows.map((row) => row.id);
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const session = (
      await db.query<{ id: string }>('select public.request_capture($1,$2,$3,$4,$5,$6,$7) id', [
        site,
        device,
        configs[0],
        'other',
        null,
        null,
        '00000000-0000-4000-8000-000000000201',
      ])
    ).rows[0].id;
    await db.exec('reset role;set role service_role');
    const sensor = (
      await db.query<{ id: string }>(
        "select id from public.sensors where device_id=$1 and sensor_key='bme690_01'",
        [device],
      )
    ).rows[0].id;
    const insert = (configuration: string) =>
      db.query(
        `insert into public.capture_measurements(session_id,configuration_id,sensor_id,sensor_key,sensor_type,
       acquired_at,sequence_number,phase,readings,units,validity,applied_settings)
       values($1,$2,$3,'bme690_01','bme690',now(),0,'recording',$4,$5,$6,$7) returning id`,
        [
          session,
          configuration,
          sensor,
          { gas_resistance_ohm: 100 },
          { gas_resistance_ohm: 'ohm' },
          { fresh_data: true, gas_valid: true, heater_stable: true },
          { heater_step_index: 0 },
        ],
      );
    await assert.rejects(insert(configs[1]));
    const measurement = (await insert(configs[0])).rows[0] as { id: string };
    await assert.rejects(
      db.query("update public.capture_measurements set readings='{}' where id=$1", [
        measurement.id,
      ]),
      /immutable/,
    );
  } finally {
    await db.close();
  }
});

test('Phase IV labelling separates observations, episodes, annotations and confirmation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;`);
    for (const file of readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001';
    const episode = '00000000-0000-4000-8000-000000000901';
    await db.exec(
      `insert into auth.users(id) values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const site = (await db.query<{ id: string }>("select public.create_site('Labels') id")).rows[0]
      .id;
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Pi','labels-pi') returning id",
        [site],
      )
    ).rows[0].id;
    await db.exec('reset role;set role service_role');
    const config = (
      await db.query<{ id: string }>(
        `insert into public.capture_configurations(device_id,version,config_hash,duration_seconds,snapshot,enabled) values($1,'v1',$2,120,'{}',true) returning id`,
        [device, 'c'.repeat(64)],
      )
    ).rows[0].id;
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const session = (
      await db.query<{ id: string }>(
        'select public.request_capture_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id',
        [
          site,
          device,
          config,
          'observation',
          'restaurant_frying_oily',
          0,
          'nearby restaurant',
          'oily smell',
          episode,
          '00000000-0000-4000-8000-000000000902',
        ],
      )
    ).rows[0].id;
    const label = (
      await db.query<{ purpose: string; observed_odour: string; label: string; intensity: number }>(
        'select purpose,observed_odour,label,intensity from public.capture_sessions where id=$1',
        [session],
      )
    ).rows[0];
    assert.deepEqual(label, {
      purpose: 'observation',
      observed_odour: 'restaurant_frying_oily',
      label: 'other',
      intensity: 0,
    });
    await db.exec('reset role;set role service_role');
    await db.query(
      "update public.capture_sessions set status='preparing',device_preparing_at=now() where id=$1",
      [session],
    );
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const annotation = (
      await db.query<{ id: string }>(
        "select public.add_capture_annotation($1,'smell_changed',now()) id",
        [session],
      )
    ).rows[0].id;
    await db.exec('reset role;set role service_role');
    await db.query(
      "update public.capture_sessions set status='recording',device_started_at=now() where id=$1",
      [session],
    );
    await db.query(
      "update public.capture_sessions set status='completed',completed_at=now() where id=$1",
      [session],
    );
    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    await db.query("select public.confirm_capture_persistence($1,'changed')", [session]);
    assert.equal(
      (
        await db.query<{ value: string }>(
          'select persistence_confirmation value from public.capture_sessions where id=$1',
          [session],
        )
      ).rows[0].value,
      'changed',
    );
    await db.exec('reset role;set role service_role');
    await assert.rejects(
      db.query("update public.capture_annotations set kind='smell_gone' where id=$1", [annotation]),
      /immutable/,
    );
  } finally {
    await db.close();
  }
});
