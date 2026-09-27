'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SmellReport } from '@/lib/domain/types';
import {
  calendarMonth,
  filterJournal,
  journalDay,
  journalRangeError,
  journalResidents,
  loadJournal,
  shiftMonth,
} from '@/lib/domain/journal';
import { browserClient } from '@/lib/supabase/client';
import { useLiveData } from './use-live-data';
import { Realtime } from './realtime';
import { RecentReports } from './recent-reports';

function JournalRows({ reports, timezone }: { reports: SmellReport[]; timezone: string }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(reports.length / 50));
  const current = Math.min(page, pages - 1);
  if (!reports.length) return <p className="panel muted">No observations match this selection.</p>;
  return (
    <>
      <RecentReports
        compact
        reports={reports.slice(current * 50, (current + 1) * 50)}
        timezone={timezone}
      />
      {pages > 1 && (
        <div className="row journal-pagination">
          <button className="secondary" disabled={!current} onClick={() => setPage(current - 1)}>
            Previous entries
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button
            className="secondary"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next entries
          </button>
        </div>
      )}
    </>
  );
}

export function ReportsFeed({
  initial,
  siteId,
  siteName,
  timezone,
  today,
  initialError = false,
  demo = false,
}: {
  initial: SmellReport[];
  siteId: string;
  siteName: string;
  timezone: string;
  today: string;
  initialError?: boolean;
  demo?: boolean;
}) {
  const load = useCallback(
    () => (demo ? Promise.resolve(initial) : loadJournal(browserClient(), siteId)),
    [siteId, demo, initial],
  );
  const { data, error, refresh, updating } = useLiveData(initial, load, initialError, !demo);
  const [tab, setTab] = useState<'table' | 'calendar'>('table');
  const [resident, setResident] = useState('');
  const [fromInput, setFrom] = useState<string | null>(null);
  const [toInput, setTo] = useState<string | null>(null);
  const [monthInput, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [readyPdf, setReadyPdf] = useState<{ url: string; filename: string } | null>(null);
  useEffect(
    () => () => {
      if (readyPdf) URL.revokeObjectURL(readyPdf.url);
    },
    [readyPdf],
  );
  const residents = useMemo(() => journalResidents(data), [data]);
  const scope = resident ? data.filter((r) => r.user_id === resident) : data;
  const earliest = scope.length
    ? scope.reduce((min, r) => {
        const date = journalDay(r.reported_at, timezone);
        return date < min ? date : min;
      }, today)
    : today;
  const from =
    fromInput === null ? earliest : fromInput && fromInput < earliest ? earliest : fromInput;
  const to = toInput ?? today;
  const rangeError = journalRangeError(from, to, earliest, today);
  const filtered = useMemo(
    () => (rangeError ? [] : filterJournal(data, timezone, from, to, resident)),
    [data, timezone, from, to, resident, rangeError],
  );
  const firstMonth = (rangeError ? earliest : from).slice(0, 7);
  const lastMonth = (rangeError ? today : to).slice(0, 7);
  const month =
    monthInput < firstMonth ? firstMonth : monthInput > lastMonth ? lastMonth : monthInput;
  const byDay = new Map<string, SmellReport[]>();
  for (const r of filtered) {
    const date = journalDay(r.reported_at, timezone);
    byDay.set(date, [...(byDay.get(date) || []), r]);
  }
  const selectedDay = day.startsWith(month) && day >= from && day <= to ? day : '';
  const monthReports = filtered.filter((r) =>
    journalDay(r.reported_at, timezone).startsWith(month),
  );
  const displayed = selectedDay ? byDay.get(selectedDay) || [] : monthReports;
  const residentLabel = residents.find((r) => r.id === resident)?.label || 'All residents';
  async function download() {
    setDownloading(true);
    setDownloadError('');
    setReadyPdf(null);
    try {
      const latest = demo ? data : await loadJournal(browserClient(), siteId);
      const reports = filterJournal(latest, timezone, from, to, resident);
      if (!reports.length)
        throw new Error('No observations match this selection. Refresh the journal and try again.');
      const { journalPdfBlob } = await import('@/lib/journal-pdf');
      const blob = await journalPdfBlob({
        siteName,
        timezone,
        from,
        to,
        residentLabel,
        residents: journalResidents(latest),
        reports,
        demo,
      });
      const url = URL.createObjectURL(blob);
      const filename = `digitalnose-journal-${from}-to-${to}.pdf`;
      setReadyPdf({ url, filename });
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      setDownloadError(
        e instanceof Error ? e.message : 'Unable to download the PDF. Please try again.',
      );
    } finally {
      setDownloading(false);
    }
  }
  return (
    <>
      {error && (
        <div className="sync-notice" role="status">
          Could not load the complete journal. Your current observations are preserved; PDF export
          is unavailable until refreshed.
          <button className="secondary" onClick={refresh} disabled={updating}>
            Retry
          </button>
        </div>
      )}
      <section className="panel journal-filters" aria-label="Journal filters and PDF report">
        <div className="journal-filter-fields">
          <label>
            From
            <input
              type="date"
              value={from}
              min={earliest}
              max={today}
              disabled={!scope.length}
              onChange={(e) => {
                setFrom(e.target.value);
                setDay('');
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from || earliest}
              max={today}
              disabled={!scope.length}
              onChange={(e) => {
                setTo(e.target.value);
                setDay('');
              }}
            />
          </label>
          <label>
            Resident
            <select
              value={resident}
              onChange={(e) => {
                setResident(e.target.value);
                setDay('');
              }}
            >
              <option value="">All residents</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={!data.length}
            onClick={() => {
              setFrom(null);
              setTo(null);
              setResident('');
              setDay('');
            }}
          >
            Reset filters
          </button>
          <button
            onClick={download}
            disabled={downloading || updating || error || !!rangeError || !filtered.length}
          >
            {downloading ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
        <p className="muted journal-filter-summary" role="status">
          {data.length
            ? `First observation: ${earliest}. ${filtered.length} matching ${filtered.length === 1 ? 'observation' : 'observations'}. Dates and times: ${timezone}.`
            : 'No observations yet. Add an observation to start your journal.'}
        </p>
        <p className="muted journal-filter-summary">
          The PDF includes all entries matching these dates and resident, across every page.
        </p>
        {rangeError && scope.length > 0 && (
          <p role="alert" className="error">
            {rangeError}
          </p>
        )}
        {downloadError && (
          <p role="alert" className="error">
            {downloadError}
          </p>
        )}
      </section>
      <div className="segmented journal-tabs" role="tablist" aria-label="Journal view">
        {(['table', 'calendar'] as const).map((value) => (
          <button
            key={value}
            id={`journal-tab-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`journal-${value}`}
            tabIndex={tab === value ? 0 : -1}
            className={tab === value ? '' : 'secondary'}
            onClick={() => setTab(value)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 'table'
                    : e.key === 'End'
                      ? 'calendar'
                      : value === 'table'
                        ? 'calendar'
                        : 'table';
                setTab(next);
                document.getElementById(`journal-tab-${next}`)?.focus();
              }
            }}
          >
            {value === 'table' ? 'Table' : 'Calendar'}
          </button>
        ))}
      </div>
      {tab === 'table' ? (
        <section id="journal-table" role="tabpanel" aria-labelledby="journal-tab-table">
          <JournalRows key={`${from}:${to}:${resident}`} reports={filtered} timezone={timezone} />
        </section>
      ) : (
        <section id="journal-calendar" role="tabpanel" aria-labelledby="journal-tab-calendar">
          <div className="panel journal-calendar-panel">
            <div className="row spread journal-calendar-heading">
              <button
                className="secondary"
                aria-label="Previous month"
                disabled={month <= firstMonth || !scope.length}
                onClick={() => {
                  setMonth(shiftMonth(month, -1));
                  setDay('');
                }}
              >
                ←
              </button>
              <h2>
                {new Intl.DateTimeFormat('en-GB', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(`${month}-01T12:00:00Z`))}
              </h2>
              <button
                className="secondary"
                aria-label="Next month"
                disabled={month >= lastMonth || !scope.length}
                onClick={() => {
                  setMonth(shiftMonth(month, 1));
                  setDay('');
                }}
              >
                →
              </button>
            </div>
            <div className="journal-calendar-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <span className="journal-weekday" key={d}>
                  {d}
                </span>
              ))}
              {calendarMonth(month).map((date, index) =>
                date ? (
                  <button
                    key={date}
                    className={`journal-day${selectedDay === date ? ' is-selected' : ''}`}
                    disabled={!!rangeError || date < from || date > to || !scope.length}
                    aria-pressed={selectedDay === date}
                    aria-current={date === today ? 'date' : undefined}
                    aria-label={`${date}, ${byDay.get(date)?.length || 0} ${byDay.get(date)?.length === 1 ? 'observation' : 'observations'}`}
                    onClick={() => setDay(selectedDay === date ? '' : date)}
                  >
                    <span>{Number(date.slice(-2))}</span>
                    {!!byDay.get(date)?.length && (
                      <span className="journal-day-count">
                        {byDay.get(date)!.length}
                        <span className="journal-day-word">
                          {byDay.get(date)!.length === 1 ? ' entry' : ' entries'}
                        </span>
                      </span>
                    )}
                  </button>
                ) : (
                  <span key={`blank-${index}`} />
                ),
              )}
            </div>
          </div>
          <div className="row spread journal-day-heading">
            <h2>{selectedDay ? `Observations on ${selectedDay}` : 'Observations this month'}</h2>
            {selectedDay && (
              <button className="secondary" onClick={() => setDay('')}>
                Show whole month
              </button>
            )}
          </div>
          <JournalRows
            key={`${month}:${selectedDay}:${from}:${to}:${resident}`}
            reports={displayed}
            timezone={timezone}
          />
        </section>
      )}
      {readyPdf && (
        <p className="journal-filter-summary" role="status">
          PDF ready.{' '}
          <a href={readyPdf.url} download={readyPdf.filename}>
            Download the prepared report
          </a>{' '}
          if it did not start automatically.
        </p>
      )}
      {!demo && <Realtime siteId={siteId} onUpdate={refresh} />}
    </>
  );
}
