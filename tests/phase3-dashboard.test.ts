import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

type Point = {
  sensor_id: string;
  metric: string;
  at: string;
  mean: number;
  min: number;
  max: number;
  count: number;
  health: string;
  missing_count: number;
};

test('Phase III dashboard reads summaries, preserves gaps, and keeps legacy history hybrid', async () => {
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

    const owner = '00000000-0000-4000-8000-000000000001';
    await db.exec(
      `insert into auth.users(id) values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}';`,
    );
    const site = (await db.query<{ id: string }>("select public.create_site('Dashboard') id"))
      .rows[0].id;
    const device = (
      await db.query<{ id: string }>(
        "insert into public.devices(site_id,name,device_identifier) values($1,'Pi','dashboard') returning id",
        [site],
      )
    ).rows[0].id;
    await db.query('select public.register_sensor_array($1)', [device]);
    const sensors = Object.fromEntries(
      (
        await db.query<{ id: string; sensor_key: string }>(
          'select id,sensor_key from public.sensors where device_id=$1',
          [device],
        )
      ).rows.map((row) => [row.sensor_key, row.id]),
    );

    const metric = (mean: number) => ({
      n: 60,
      min: mean - 1,
      max: mean + 1,
      mean,
      m2: 10,
      first: mean - 0.5,
      last: mean + 0.5,
      min_at: '2026-09-27T10:01:01Z',
      max_at: '2026-09-27T10:01:59Z',
    });
    const body = (metrics: Record<string, object>, health = 'normal') => ({
      sensor_type: 'test',
      health,
      expected_samples: 60,
      observed_samples: 60,
      successful_reads: 60,
      valid_samples: 60,
      invalid_samples: 0,
      warmup_samples: 0,
      error_samples: 0,
      unknown_samples: 0,
      missing_samples: 0,
      occupied_slots: 60,
      metrics,
      provenance: {},
      source_digest: 'a'.repeat(64),
    });
    const summaries = [
      [sensors.sgp41_01, body({ raw_voc_ticks: metric(111), raw_nox_ticks: metric(222) })],
      [
        sensors.bme690_01,
        body({
          gas_resistance_ohm: metric(301),
          temperature_c: metric(21),
          humidity_pct: metric(55),
          pressure_pa: metric(101325),
        }),
      ],
      [sensors.bme690_02, body({ gas_resistance_ohm: metric(302) })],
      [
        sensors.sps30_01,
        body({
          pm1_ug_m3: metric(1),
          pm2_5_ug_m3: metric(2.5),
          pm4_ug_m3: metric(4),
          pm10_ug_m3: metric(10),
          number_pm0_5_cm3: metric(50),
          typical_particle_size_um: metric(0.7),
        }),
      ],
    ] as const;

    await db.exec('reset role;set role service_role');
    for (const [sensor, summary] of summaries)
      await db.query(
        `insert into public.sensor_minute_summaries(sensor_id,device_id,minute_start,revision,body)
         values($1,$2,'2026-09-27T10:01:00Z',1,$3)`,
        [sensor, device, summary],
      );
    // Legacy history remains available before Phase III coverage.
    await db.query(
      `insert into public.sensor_observations(sensor_id,sensor_type,observed_at,status,valid,readings)
       values($1,'sgp41','2026-09-27T10:00:30Z','ok',true,$2),
             ($1,'sgp41','2026-09-27T10:01:30Z','ok',true,$3)`,
      [
        sensors.sgp41_01,
        { raw_voc_ticks: 50, raw_nox_ticks: 25 },
        { raw_voc_ticks: 999, raw_nox_ticks: 999 },
      ],
    );
    // A full valid minute with one unoccupied cadence slot remains visible but partial.
    await db.query(
      `insert into public.sensor_minute_summaries(sensor_id,device_id,minute_start,revision,body)
       values($1,$2,'2026-09-27T10:03:00Z',1,$3)`,
      [
        sensors.sgp41_01,
        device,
        {
          ...body({ raw_voc_ticks: metric(666) }, 'degraded'),
          missing_samples: 1,
          occupied_slots: 59,
        },
      ],
    );
    await db.query(
      `insert into public.sensor_observations(sensor_id,sensor_type,observed_at,status,valid,readings)
       values($1,'sgp41','2026-09-27T10:03:30Z','ok',true,$2)`,
      [sensors.sgp41_01, { raw_voc_ticks: 777, raw_nox_ticks: 777 }],
    );
    await db.query(
      `insert into public.sensor_minute_summaries(sensor_id,device_id,minute_start,revision,body)
       values($1,$2,'2026-09-27T10:02:00Z',1,$3)`,
      [
        sensors.sgp41_01,
        device,
        {
          ...body({}, 'unknown'),
          metrics: { raw_voc_ticks: null },
          observed_samples: 0,
          successful_reads: 0,
          valid_samples: 0,
          missing_samples: 60,
          occupied_slots: 0,
        },
      ],
    );
    await db.query(
      `insert into public.sensor_observations(sensor_id,sensor_type,observed_at,status,valid,readings)
       values($1,'sgp41','2026-09-27T10:02:30Z','ok',true,$2)`,
      [sensors.sgp41_01, { raw_voc_ticks: 888, raw_nox_ticks: 888 }],
    );
    await db.query(
      `insert into public.minute_aggregates(device_id,minute_start_utc,tvoc_mean,tvoc_min,tvoc_max,
       eco2_mean,eco2_min,eco2_max,aqi_max,sample_count)
       values($1,'2026-09-27T10:01:00Z',100,90,110,500,490,510,1,12)`,
      [device],
    );

    await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
    const result = (
      await db.query<{ data: { bucket_seconds: number; points: Point[] } }>(
        "select public.sensor_chart_window($1,'2026-09-27T10:00:00Z','2026-09-27T10:10:00Z') data",
        [device],
      )
    ).rows[0].data;
    const points = result.points;
    assert.equal(result.bucket_seconds, 60);
    for (const [sensor, metricName, expected] of [
      [sensors.sgp41_01, 'raw_voc_ticks', 111],
      [sensors.sgp41_01, 'raw_nox_ticks', 222],
      [sensors.bme690_01, 'gas_resistance_ohm', 301],
      [sensors.bme690_02, 'gas_resistance_ohm', 302],
      [sensors.bme690_01, 'temperature_c', 21],
      [sensors.bme690_01, 'humidity_pct', 55],
      [sensors.bme690_01, 'pressure_pa', 101325],
      [sensors.sps30_01, 'pm1_ug_m3', 1],
      [sensors.sps30_01, 'pm2_5_ug_m3', 2.5],
      [sensors.sps30_01, 'pm4_ug_m3', 4],
      [sensors.sps30_01, 'pm10_ug_m3', 10],
      [sensors.sps30_01, 'number_pm0_5_cm3', 50],
      [sensors.sps30_01, 'typical_particle_size_um', 0.7],
    ] as const) {
      const point = points.find(
        (candidate) =>
          candidate.sensor_id === sensor &&
          candidate.metric === metricName &&
          candidate.mean === expected,
      );
      assert.equal(point?.mean, expected, metricName);
      assert.equal(point?.health, 'normal', metricName);
      assert.equal(point?.count, 60, metricName);
    }
    const voc = points.filter(
      (point) => point.sensor_id === sensors.sgp41_01 && point.metric === 'raw_voc_ticks',
    );
    assert.deepEqual(
      voc.map((point) => point.mean),
      [50, 111, 666],
      'legacy raw remains, summary wins, and partial valid summaries stay visible',
    );
    assert.ok(
      !points.some((point) => point.mean === 777 || point.mean === 888 || point.mean === 999),
    );
    const partial = voc.find((point) => point.mean === 666)!;
    assert.equal(partial.health, 'degraded');
    assert.equal(partial.missing_count, 1);
    assert.equal(partial.count, 60);
    assert.equal(voc[0].health, 'unknown', 'legacy raw does not invent full coverage');
    assert.equal(voc[0].missing_count, null);
    assert.ok(!voc.some((point) => point.at.includes('10:02:')), 'absent minute stays absent');
    for (const minutes of [15, 30, 60]) {
      const ranged = (
        await db.query<{ data: { points: Point[] } }>(
          `select public.sensor_chart_window($1,'2026-09-27T10:00:00Z',
           '2026-09-27T10:00:00Z'::timestamptz+make_interval(mins=>$2)) data`,
          [device, minutes],
        )
      ).rows[0].data.points;
      assert.ok(
        ranged.some((point) => point.mean === 111),
        `${minutes}-minute summary window`,
      );
    }
    const wide = (
      await db.query<{ data: { points: (Point & { has_internal_gap: boolean })[] } }>(
        "select public.sensor_chart_window($1,'2026-09-27T10:00:00Z','2026-09-28T10:00:00Z') data",
        [device],
      )
    ).rows[0].data.points.find(
      (p) => p.sensor_id === sensors.sgp41_01 && p.metric === 'raw_voc_ticks',
    )!;
    assert.equal(wide.count, 121);
    assert.ok(Math.abs(wide.mean - (50 + 111 * 60 + 666 * 60) / 121) < 1e-9);
    assert.equal(wide.min, 50);
    assert.equal(wide.max, 667);
    assert.equal(wide.has_internal_gap, true);
    assert.equal(wide.missing_count, null, 'mixed legacy coverage remains unknown');
    await db.query(
      `insert into public.site_state_events(site_id,user_id,event_type,value)
      values($1,$2,'maintenance',true)`,
      [site, owner],
    );
    await db.exec('reset role;set role service_role');
    await db.query(
      `update public.site_state_events set recorded_at='2026-09-27T10:03:30Z'
      where site_id=$1 and event_type='maintenance'`,
      [site],
    );
    const maintained = (
      await db.query<{ data: { points: Point[] } }>(
        "select public.sensor_chart_window($1,'2026-09-27T10:00:00Z','2026-09-27T10:10:00Z') data",
        [device],
      )
    ).rows[0].data.points;
    assert.ok(
      !maintained.some((p) => p.mean === 666),
      'maintenance still excludes overlapping minutes',
    );
    assert.equal((await db.query('select * from public.minute_aggregates')).rows.length, 1);
    assert.ok(!points.some((point) => point.sensor_id === sensors.ens160_01));
  } finally {
    await db.close();
  }
});
