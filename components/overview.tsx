'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { LuRefreshCw } from 'react-icons/lu';
import type { Site, Device } from '@/lib/domain/types';
import { loadOverview, type OverviewData } from '@/lib/domain/overview';
import { ranges, type Range } from '@/lib/domain/readings';
import { browserClient } from '@/lib/supabase/client';
import { useLiveData } from './use-live-data';
import { Realtime } from './realtime';
import { LiveReading } from './live-reading';
import { ReadingChart } from './reading-chart';
import { ContextToggles } from './context-toggles';
import { RecentReports } from './recent-reports';
export function Overview({
  initial,
  site,
  userId,
  device,
  range,
  initialError = false,
  demo = false,
}: {
  initial: OverviewData;
  site: Site;
  userId: string;
  device?: Device;
  range: Range;
  initialError?: boolean;
  demo?: boolean;
}) {
  const load = useCallback(
    () => loadOverview(browserClient(), site.id, userId, device?.id, range, Date.now()),
    [site.id, userId, device?.id, range],
  );
  const live = useLiveData(initial, load, initialError);
  const [demoData, setDemoData] = useState(initial);
  const data = demo ? demoData : live.data;
  return (
    <>
      {live.error && !demo && (
        <div className="sync-notice" role="status">
          <div>
            <strong>Updates are temporarily unavailable.</strong>
            <p>Your last loaded data is still shown. You can keep writing your report.</p>
          </div>
          <button className="secondary" onClick={live.refresh} disabled={live.updating}>
            <LuRefreshCw aria-hidden="true" />
            Retry
          </button>
        </div>
      )}
      <LiveReading reading={data.latest} initialNow={data.now} demo={demo} />
      <div className="row spread chart-toolbar">
        <span className="muted">
          {device ? 'Reading history' : 'No sensor connected'}
          {!demo && live.updating ? ' · Updating…' : ''}
        </span>
        {!demo && (
          <div className="segmented" aria-label="Time range">
            {Object.keys(ranges).map((r) => (
              <Link
                className={`button ${range === r ? '' : 'secondary'}`}
                key={r}
                href={`/dashboard?site=${site.id}&device=${device?.id || ''}&range=${r}`}
                aria-current={range === r ? 'page' : undefined}
              >
                {r === '6H' ? '6 hours' : r === '24H' ? '24 hours' : '7 days'}
              </Link>
            ))}
          </div>
        )}
      </div>
      <ReadingChart
        readings={data.readings}
        events={data.events}
        reports={data.reports}
        userId={userId}
        timezone={site.timezone}
        start={data.now - ranges[range] * 3600000}
        end={data.now}
      />
      <ContextToggles
        siteId={site.id}
        userId={userId}
        events={data.currentEvents}
        demo={demo}
        onDemoChange={(type, value) => {
          const now = Date.now();
          const event = {
            id: `demo-${now}`,
            site_id: site.id,
            user_id: userId,
            event_type: type,
            value,
            recorded_at: new Date(now).toISOString(),
          };
          setDemoData((previous) => ({
            ...previous,
            now,
            events: [...previous.events, event],
            currentEvents: [...previous.currentEvents, event],
          }));
        }}
      />
      <RecentReports reports={data.recentReports} timezone={site.timezone} />
      {!demo && <Realtime siteId={site.id} deviceId={device?.id} onUpdate={live.refresh} />}
    </>
  );
}
