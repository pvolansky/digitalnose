'use client';
import { LiveSensorAnalysis } from './sensor-analysis';
import { useCallback, useState } from 'react';
import { WeatherCard } from './weather-card';
import { HistoryControls } from './history-controls';
import type { HistoryWindow } from '@/lib/domain/history-window';
import { LuRefreshCw } from 'react-icons/lu';
import type { Site, Device } from '@/lib/domain/types';
import { loadOverview, type OverviewData } from '@/lib/domain/overview';
import { currentState } from '@/lib/domain/site-state';
import { isMaintenanceMinute } from '@/lib/domain/timeline';
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
  window,
  initialError = false,
  canEditContext = false,
  demo = false,
}: {
  initial: OverviewData;
  site: Site;
  userId: string;
  device?: Device;
  range: Range;
  window?: HistoryWindow;
  initialError?: boolean;
  canEditContext?: boolean;
  demo?: boolean;
}) {
  const load = useCallback(
    () => loadOverview(browserClient(), site.id, device?.id, range, Date.now(), window),
    [site.id, device?.id, range, window],
  );
  const live = useLiveData(initial, load, initialError, !demo);
  const [selectedMoment, setSelectedMoment] = useState<number | null>(null);
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
      <WeatherCard
        observation={data.weather.latest}
        now={data.now}
        timezone={site.timezone}
        configured={true}
        unavailable={data.weather.unavailable}
        demo={demo}
      />
      <div className="row spread chart-toolbar">
        <span className="muted">
          {device ? 'Reading history' : 'No sensor connected'}
          {!demo && live.updating ? ' · Updating…' : ''}
        </span>
      </div>
      {!demo && (
        <HistoryControls
          range={range}
          window={window}
          now={data.now}
          timezone={site.timezone}
          siteId={site.id}
          deviceId={device?.id}
        />
      )}

      <ReadingChart
        selectedMoment={selectedMoment}
        onSelectMoment={setSelectedMoment}
        weather={data.weather.history}
        readings={data.readings}
        events={data.events}
        reports={data.reports}
        userId={userId}
        timezone={site.timezone}
        start={window?.start ?? data.now - ranges[range] * 3600000}
        end={window?.end ?? data.now}
      />
      <ContextToggles
        canEdit={canEditContext || demo}
        siteId={site.id}
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
      {!demo && (
        <LiveSensorAnalysis
          particulateControls={
            <HistoryControls
              range={range}
              window={window}
              now={data.now}
              timezone={site.timezone}
              siteId={site.id}
              deviceId={device?.id}
            />
          }
          deviceId={device?.id}
          now={data.now}
          timezone={site.timezone}
          start={window?.start ?? data.now - ranges[range] * 3600000}
          end={window?.end ?? data.now}
          selectedAt={selectedMoment}
          onSelect={setSelectedMoment}
          events={data.events}
          reports={data.reports}
          weather={data.weather.history}
          readings={data.readings}
        />
      )}
    </>
  );
}
