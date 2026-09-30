import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SmellReport } from '../lib/domain/types';
import { addReportDisplayNames } from '../lib/domain/named-overview';

const report = (id: string): SmellReport => ({
  id,
  site_id: 'site',
  user_id: 'user',
  reported_at: '2026-09-30T20:00:00Z',
  intensity: 5,
  note: null,
  smell_type: 'Restaurant',
});

test('chart history receives profile names in bounded pages without mutating raw reports', async () => {
  const reports = Array.from({ length: 501 }, (_, index) => report(String(index)));
  const pages: string[][] = [];
  const db = {
    rpc: async (name: string, args: { report_ids: string[] }) => {
      assert.equal(name, 'report_display_names');
      pages.push(args.report_ids);
      return {
        data: args.report_ids.map((id) => ({
          report_id: id,
          display_name: id === '500' ? null : '101',
        })),
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const named = await addReportDisplayNames(db, reports);
  assert.deepEqual(pages.map((page) => page.length), [500, 1]);
  assert.equal(named[0].reporter_display_name, '101');
  assert.equal(named[500].reporter_display_name, null);
  assert.equal(reports[0].reporter_display_name, undefined);
});

test('chart history reports a name lookup failure instead of silently misidentifying residents', async () => {
  const db = {
    rpc: async () => ({ data: null, error: { message: 'failed' } }),
  } as unknown as SupabaseClient;
  await assert.rejects(addReportDisplayNames(db, [report('1')]), /display names/);
});
