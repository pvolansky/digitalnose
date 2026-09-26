import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('Phase IIIA schema: device-scoped replay, revision conflicts, metrics and existing raw preservation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;`);
    for (const name of [
      '202609120001_initial',
      '202609170002_sensor_array',
      '202609240001_phase3_parallel',
    ])
      await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    await db.exec(`insert into auth.users(id) values('${owner}'),('${other}');
      set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const site = (await db.query<{ id: string }>("select public.create_site('Phase3 test') id"))
      .rows[0].id;
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Pi','phase3-test') returning id",
        [site],
      )
    ).rows[0].id;
    await db.query('select public.register_sensor_array($1)', [device]);
    const sensor = (
      await db.query<{ id: string }>("select id from public.sensors where sensor_key='sgp41_01'")
    ).rows[0].id;
    await db.exec('reset role');
    await db.query('insert into public.archive_uploaders values($1,$2)', [owner, device]);
    await db.exec('set role authenticated');
    const metric = {
      n: 1,
      min: 0,
      max: 0,
      mean: 0,
      m2: 0,
      first: 0,
      last: 0,
      min_at: '2026-09-24T10:00:00.123456Z',
      max_at: '2026-09-24T10:00:00.123456Z',
    };
    const payload = {
      device_id: device,
      sensor_id: sensor,
      sensor_type: 'sgp41',
      minute_start: '2026-09-24T10:00:00.000000Z',
      revision: 1,
      health: 'degraded',
      expected_samples: 60,
      observed_samples: 1,
      successful_reads: 1,
      valid_samples: 1,
      invalid_samples: 0,
      warmup_samples: 0,
      error_samples: 0,
      unknown_samples: 0,
      missing_samples: 59,
      occupied_slots: 1,
      source_digest: 'a'.repeat(64),
      provenance: {},
      metrics: {
        raw_voc_ticks: metric,
        raw_nox_ticks: metric,
        compensation_temperature_c: null,
        compensation_humidity_pct: null,
      },
    };
    const put = (p: object) => db.query('select public.phase3_put_summary($1)', [p]);
    await put(payload);
    await put(payload);
    assert.equal((await db.query('select * from public.sensor_minute_summaries')).rows.length, 1);
    await assert.rejects(
      put({ ...payload, source_digest: 'b'.repeat(64) }),
      /Conflicting summary revision/,
    );
    await put({ ...payload, revision: 2, source_digest: 'b'.repeat(64) });
    await put(payload); // Old response retry cannot overwrite newer summary.
    assert.equal(
      (await db.query<{ revision: number }>('select revision from public.sensor_minute_summaries'))
        .rows[0].revision,
      2,
    );
    await assert.rejects(put({ ...payload, revision: 3, valid_samples: -1 }));
    await assert.rejects(
      put({ ...payload, revision: 3, metrics: { raw_voc_ticks: { ...metric, max: -1 } } }),
    );
    await assert.rejects(
      put({
        ...payload,
        revision: 3,
        metrics: { ...payload.metrics, raw_voc_ticks: { ...metric, mean: 'NaN' } },
      }),
    );
    await assert.rejects(
      put({
        ...payload,
        revision: 3,
        metrics: {
          ...payload.metrics,
          raw_voc_ticks: { ...metric, max_at: '2026-09-24T11:00:00Z' },
        },
      }),
    );
    await assert.rejects(db.exec('delete from public.sensor_minute_summaries'));
    const hp = {
      id: 'c'.repeat(64),
      device_id: device,
      body: { observed_at: '2026-09-24T10:00:00Z', health: 'unknown' },
    };
    await db.query('select public.phase3_put_health($1)', [hp]);
    await db.query('select public.phase3_put_health($1)', [hp]);
    await assert.rejects(
      db.query('select public.phase3_put_health($1)', [
        { ...hp, body: { ...hp.body, health: 'normal' } },
      ]),
    );
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    assert.equal((await db.query('select * from public.sensor_minute_summaries')).rows.length, 0);
    assert.equal((await db.query('select * from public.device_health_summaries')).rows.length, 0);
    await assert.rejects(put(payload), /Archive uploader access required/);
    await db.exec('reset role; set role anon');
    await assert.rejects(put(payload));
    await assert.rejects(db.query('select * from public.sensor_minute_summaries'));
    await db.exec('reset role');
    assert.equal((await db.query('select * from public.sensor_observations')).rows.length, 0);
    assert.equal((await db.query('select * from public.minute_aggregates')).rows.length, 0);
  } finally {
    await db.close();
  }
});
