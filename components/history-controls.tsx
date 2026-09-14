'use client';
import { useRef, useState, useTransition, useId } from 'react';
import { useRouter } from 'next/navigation';
import { LuCalendarDays, LuChevronLeft, LuChevronRight, LuX, LuLoaderCircle } from 'react-icons/lu';
import { ranges, type Range } from '@/lib/domain/readings';
import {
  historyWindowError,
  shiftHistoryWindow,
  type HistoryWindow,
} from '@/lib/domain/history-window';
import { DateTimeField, localDateTime as localInput } from './date-time-field';
import { RangeLink } from './range-link';
export function HistoryControls({
  range,
  window,
  now,
  timezone,
  siteId,
  deviceId,
}: {
  range: Range;
  window?: HistoryWindow;
  now: number;
  timezone: string;
  siteId: string;
  deviceId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [zone, setZone] = useState('');
  const [error, setError] = useState('');
  const bounds = window ?? { start: now - ranges[range] * 3600000, end: now };
  function href(preset: Range, selection?: HistoryWindow) {
    const query = new URLSearchParams({ site: siteId, range: preset });
    if (deviceId) query.set('device', deviceId);
    if (selection) {
      query.set('from', new Date(selection.start).toISOString());
      query.set('to', new Date(selection.end).toISOString());
    }
    return `/dashboard?${query}`;
  }
  function navigate(selection?: HistoryWindow) {
    startTransition(() => router.push(href(range, selection), { scroll: false }));
  }
  const format = (value: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  return (
    <section className="history-controls" aria-label="Reading history dates" aria-busy={pending}>
      <div className="history-control-row">
        <div className="segmented chart-filters" aria-label="Time range">
          {(Object.keys(ranges) as Range[]).map((value) => (
            <RangeLink
              key={value}
              active={!window && range === value}
              href={href(value)}
              label={value === '6H' ? '6 hours' : value === '24H' ? '24 hours' : '7 days'}
            />
          ))}
        </div>
        <button
          className={`secondary history-custom ${window ? 'is-selected' : ''}`}
          disabled={pending}
          onClick={() => {
            setFrom(localInput(bounds.start));
            setTo(localInput(bounds.end));
            setError('');
            setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
            dialog.current?.showModal();
          }}
        >
          <LuCalendarDays aria-hidden="true" />
          Custom dates
        </button>
        <div className="history-step-controls" aria-label="Move through history">
          <button
            className="secondary"
            aria-label="Previous period"
            title="Move back by the selected interval"
            disabled={pending}
            onClick={() => navigate(shiftHistoryWindow(bounds, -1, Date.now()))}
          >
            <LuChevronLeft aria-hidden="true" />
          </button>
          <button
            className="secondary"
            aria-label="Next period"
            title="Move forward by the selected interval"
            disabled={pending || !window || bounds.end >= now}
            onClick={() => navigate(shiftHistoryWindow(bounds, 1, Date.now()))}
          >
            <LuChevronRight aria-hidden="true" />
          </button>
          <button className="secondary" disabled={pending || !window} onClick={() => navigate()}>
            Latest
          </button>
        </div>
      </div>
      <div className="history-range-caption" role="status">
        <span>
          {format(bounds.start)} – {format(bounds.end)} <span className="muted">· {timezone}</span>
        </span>
        <span className="muted">
          {pending ? (
            <>
              <LuLoaderCircle className="spin" aria-hidden="true" /> Loading history…
            </>
          ) : window ? (
            'Fixed period · current readings above stay live'
          ) : (
            'Rolling window'
          )}
        </span>
      </div>
      <dialog ref={dialog} className="history-date-dialog" aria-labelledby={title}>
        <div className="row spread">
          <h2 id={title}>Choose a period</h2>
          <button
            className="secondary"
            type="button"
            aria-label="Close date picker"
            onClick={() => dialog.current?.close()}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
        <p className="muted">
          Enter dates and times in {zone || 'your browser’s timezone'}. Choose up to seven days of
          minute-by-minute history.
        </p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const selection = { start: new Date(from).getTime(), end: new Date(to).getTime() };
            const message = historyWindowError(selection, Date.now());
            if (message) {
              setError(message);
              return;
            }
            // A local time skipped by daylight saving must not silently move an hour.
            if (localInput(selection.start) !== from || localInput(selection.end) !== to) {
              setError(
                'This local time does not exist because the clocks change. Choose another time.',
              );
              return;
            }
            navigate(selection);
            dialog.current?.close();
          }}
        >
          <DateTimeField
            label="From"
            value={from}
            onChange={(value) => {
              setFrom(value);
              setError('');
            }}
          />
          <DateTimeField
            label="To"
            value={to}
            onChange={(value) => {
              setTo(value);
              setError('');
            }}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={pending}>
              Apply dates
            </button>
            <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
