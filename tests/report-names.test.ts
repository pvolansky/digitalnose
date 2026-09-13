import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { RecentReports } from '../components/recent-reports';
import type { SmellReport } from '../lib/domain/types';
test('recent observations show display names and a neutral fallback', () => {
  for (const [name, expected] of [
    [' Alex ', 'Alex'],
    ['', 'Resident'],
    ['   ', 'Resident'],
    [null, 'Resident'],
  ] as const) {
    const report: SmellReport = {
      id: 'report',
      site_id: 'site',
      user_id: 'user',
      reported_at: '2026-09-12T12:00:00Z',
      intensity: 4,
      note: null,
      smell_type: 'Cooking',
      reporter_display_name: name,
    };
    const html = renderToStaticMarkup(
      React.createElement(RecentReports, { reports: [report], timezone: 'UTC' }),
    );
    assert.ok(html.includes(expected));
    assert.ok(html.includes('Cooking'));
  }
});
test('report names expose only display names for same-site reports, never other sites or emails', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
    await db.exec(readFileSync('supabase/migrations/202609120001_initial.sql', 'utf8'));
    await db.exec(
      readFileSync('supabase/migrations/202609120007_report_display_names.sql', 'utf8'),
    );
    await db.exec(readFileSync('supabase/migrations/202609130001_owner_context.sql', 'utf8'));
    const owner = '00000000-0000-4000-8000-000000000001',
      resident = '00000000-0000-4000-8000-000000000002',
      stranger = '00000000-0000-4000-8000-000000000003';
    await db.query(
      `insert into auth.users(id,email) values($1,'owner@test.invalid'),($2,'resident@test.invalid'),($3,'stranger@test.invalid')`,
      [owner, resident, stranger],
    );
    await db.query('update public.profiles set display_name=$1 where id=$2', ['Alex', owner]);
    const login = async (id: string) =>
      db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}'`);
    await login(owner);
    const site = (await db.query<{ id: string }>("select public.create_site('Test site') as id"))
      .rows[0].id;
    await db.query('select public.add_resident($1,$2)', [site, 'resident@test.invalid']);
    await db.query('insert into public.smell_reports(site_id,user_id,intensity) values($1,$2,4)', [
      site,
      owner,
    ]);
    const report = (await db.query<{ id: string }>('select id from public.smell_reports')).rows[0]
      .id;
    for (const type of ['window_open', 'user_in_room']) {
      await db.query(
        'insert into public.site_state_events(site_id,user_id,event_type,value) values($1,$2,$3,true)',
        [site, owner, type],
      );
    }
    await db.exec('reset role');
    await db.query(
      'insert into public.site_state_events(site_id,user_id,event_type,value) values($1,$2,$3,false)',
      [site, resident, 'user_in_room'],
    );
    await login(resident);
    assert.equal((await db.query('select * from public.site_state_events')).rows.length, 2);
    for (const type of ['window_open', 'user_in_room']) {
      await assert.rejects(
        db.query(
          'insert into public.site_state_events(site_id,user_id,event_type,value) values($1,$2,$3,false)',
          [site, resident, type],
        ),
      );
      await assert.rejects(
        db.query(
          'insert into public.site_state_events(site_id,user_id,event_type,value) values($1,$2,$3,false)',
          [site, owner, type],
        ),
      );
    }
    await db.query('insert into public.smell_reports(site_id,user_id,intensity) values($1,$2,3)', [
      site,
      resident,
    ]);
    assert.equal(
      (
        await db.query<{ user_id: string }>(
          'select user_id from public.smell_reports where intensity=3',
        )
      ).rows[0].user_id,
      resident,
    );
    await assert.rejects(
      db.query('insert into public.smell_reports(site_id,user_id,intensity) values($1,$2,3)', [
        site,
        owner,
      ]),
    );
    const names = (await db.query('select * from public.report_display_names($1)', [[report]]))
      .rows;
    assert.deepEqual(names, [{ report_id: report, display_name: 'Alex' }]);
    await login(stranger);
    assert.deepEqual(
      (await db.query('select * from public.report_display_names($1)', [[report]])).rows,
      [],
    );
    await db.exec('reset role');
    await db.query("update public.profiles set display_name='   ' where id=$1", [owner]);
    await login(resident);
    assert.deepEqual(
      (await db.query('select * from public.report_display_names($1)', [[report]])).rows,
      [{ report_id: report, display_name: null }],
    );
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select * from public.report_display_names($1)', [[report]]));
  } finally {
    await db.close();
  }
});
