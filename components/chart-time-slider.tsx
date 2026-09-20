'use client';
import type { ReactNode } from 'react';
export function ChartTimeSlider({
  label,
  start,
  end,
  at,
  onSelect,
  children,
}: {
  label: string;
  start: number;
  end: number;
  at: number | null;
  onSelect: (at: number) => void;
  children: ReactNode;
}) {
  return (
    <div className="chart-time-slider">
      <input
        type="range"
        aria-label={`${label}: inspect time`}
        min={start}
        max={end}
        step={1000}
        aria-valuetext={new Date(Math.max(start, Math.min(end, at ?? end))).toISOString()}
        value={Math.max(start, Math.min(end, at ?? end))}
        onChange={(event) => onSelect(Number(event.target.value))}
      />
      <div className="chart-slider-reading" aria-live="polite">
        {children}
      </div>
    </div>
  );
}
