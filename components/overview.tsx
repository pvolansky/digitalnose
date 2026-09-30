'use client';
import { useSearchParams } from 'next/navigation';
import { parseHistoryWindow } from '@/lib/domain/history-window';
import { useCallback, useState, useMemo } from 'react';
import { WeatherCard } from './weather-card';
import { HistoryControls } from './history-controls';
import type { HistoryWindow } from '@/lib/domain/history-window';
import { LuRefreshCw } from 'react-icons/lu';
import type { Site, Device } from '@/lib/domain/types';
import type { OverviewData } from '@/lib/domain/overview';
import { loadNamedOverview } from '@/lib/domain/named-overview';
import { currentState } from '@/lib/domain/site-state';
import { isMaintenanceMinute } from '@/lib/domain/timeline';
import { ranges, parseRange, type Range } from '@/lib/domain/readings';
import { browserClient } from '@/lib/supabase/client';
import { useLiveData } from './use-live-data';
import { Realtime } from './realtime';
import { LiveReading } from './live-reading';
import { ReadingChart } from './reading-chart';
import { RecentReports } from './recent-reports';
export function Overview({
  initial,
  site,
  device,
  range: initialRange,
  window: initialWindow,
  initialError = false,
  demo = false,
}: {
  initial: OverviewData;
  site: Site;
  device?: Device;
  range: Range;
  window?: HistoryWindow;
  initialError?: boolean;
  canEditContext?: boolean;
  demo?: boolean;
}) {
  const params = useSearchParams();
  const range = demo ? initialRange : parseRange(params.get('range') ?? initialRange);
  const from = params.get('from');
  const to = params.get('to');
  const selection = useMemo(
    () =>
      demo
        ? { window: initialWindow, error: null }
        : // Validate newly selected URL dates against selection time, not the initial page load.
          // eslint-disable-next-line react-hooks/purity
          parseHistoryWindow(from ?? undefined, to ?? undefined, Date.now()),
    [demo, initialWindow, from, to],
  );
  const window = selection.window;
  const load = useCallback(
    () => loadNamedOverview(browserClient(), site.id, device?.id, range, Date.now(), window),
    [site.id, device?.id, range, window],
  );
  const live = useLiveData(initial, load, initialError, !demo, !demo);
  const [selectedMoment, setSelectedMoment] = useState<number | null>(null);
  const data = demo ? initial : live.data;
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
      <LiveReading
        lastSeenAt={data.lastSeenAt}
        reading={data.latest}
        maintenance={
          currentState(data.currentEvents).maintenance === true ||
          (!!data.latest &&
            isMaintenanceMinute(
              [...data.events, ...data.currentEvents],
              Date.parse(data.latest.minute_start_utc),
            ))
        }
        initialNow={data.now}
        demo={demo}
        syncStatus={
          !demo ? (
            <Realtime siteId={site.id} deviceId={device?.id} onUpdate={live.refresh} />
          ) : undefined
        }
      />
      <section className="panel chart-workspace" aria-labelledby="sensor-history-title">
        <div className="row spread chart-toolbar">
          <h2 id="sensor-history-title">Air readings over time</h2>
          <span className="muted" role="status">
            {!device ? 'No sensor connected' : !demo && live.updating ? 'Updating…' : ''}
          </span>
        </div>
        {!demo && (
          <HistoryControls
            pending={live.updating}
            range={range}
            window={window}
            now={data.now}
            timezone={site.timezone}
            siteId={site.id}
            deviceId={device?.id}
          />
        )}

        {selection.error && (
          <p role="status" className="sync-notice">
            {selection.error}
          </p>
        )}
        <ReadingChart
          selectedMoment={selectedMoment}
          onSelectMoment={setSelectedMoment}
          weather={data.weather.history}
          readings={data.readings}
          events={data.events}
          reports={data.reports}
          timezone={site.timezone}
          start={
            data.historyStart ?? initialWindow?.start ?? data.now - ranges[initialRange] * 3600000
          }
          end={data.historyEnd ?? initialWindow?.end ?? data.now}
        />
      </section>
      <WeatherCard
        observation={data.weather.latest}
        now={data.now}
        timezone={site.timezone}
        configured={true}
        unavailable={data.weather.unavailable}
        demo={demo}
      />
      <RecentReports reports={data.recentReports.slice(0, 3)} timezone={site.timezone} />
    </>
  );
}
