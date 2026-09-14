'use client';
import { useCallback } from 'react';
import Link from 'next/link';
import type { SmellReport } from '@/lib/domain/types';
import { loadReports } from '@/lib/domain/reports';
import { browserClient } from '@/lib/supabase/client';
import { useLiveData } from './use-live-data';
import { Realtime } from './realtime';
import { RecentReports } from './recent-reports';
export function ReportsFeed({
  initial,
  siteId,
  timezone,
  before,
  initialError = false,
}: {
  initial: SmellReport[];
  siteId: string;
  timezone: string;
  before?: string;
  initialError?: boolean;
}) {
  const load = useCallback(
    () => loadReports(browserClient(), siteId, 50, before),
    [siteId, before],
  );
  const { data, error, refresh, updating } = useLiveData(initial, load, initialError);
  return (
    <>
      {error && (
        <div className="sync-notice" role="status">
          Could not update observations. Your current list is preserved.
          <button className="secondary" onClick={refresh} disabled={updating}>
            Retry
          </button>
        </div>
      )}
      <RecentReports compact reports={data} timezone={timezone} />
      <div className="row">
        {data.length === 50 && (
          <Link
            className="button secondary"
            href={`/report?site=${siteId}&before=${encodeURIComponent(data.at(-1)!.reported_at)}`}
          >
            Older observations
          </Link>
        )}
        {before && (
          <Link className="button secondary" href={`/report?site=${siteId}`}>
            Latest observations
          </Link>
        )}
      </div>
      <Realtime siteId={siteId} onUpdate={refresh} />
    </>
  );
}
