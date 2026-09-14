export type HistoryWindow = { start: number; end: number };
export const MAX_HISTORY_WINDOW = 7 * 24 * 3600000;
export function historyWindowError(window: HistoryWindow, now: number): string | null {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end))
    return 'Choose a valid start and end date.';
  if (window.end - window.start < 60000) return 'End must be at least one minute after start.';
  if (window.end - window.start > MAX_HISTORY_WINDOW)
    return 'Choose up to seven days at a time. You can browse older dates.';
  if (window.end > now) return 'End cannot be in the future.';
  return null;
}
export function parseHistoryWindow(from: string | undefined, to: string | undefined, now: number) {
  if (!from && !to) return { window: undefined, error: null };
  // URLs carry explicit UTC instants, never ambiguous local dates.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!from || !to || !iso.test(from) || !iso.test(to))
    return {
      window: undefined,
      error: 'The date range in this link is invalid. Showing the preset instead.',
    };
  const window = { start: Date.parse(from), end: Date.parse(to) };
  const error = historyWindowError(window, now);
  return { window: error ? undefined : window, error };
}
export function shiftHistoryWindow(
  window: HistoryWindow,
  direction: -1 | 1,
  now: number,
): HistoryWindow {
  const duration = window.end - window.start;
  const end = Math.min(now, window.end + direction * duration);
  return { start: end - duration, end };
}
