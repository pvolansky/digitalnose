'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { LuInfo } from 'react-icons/lu';
import { airQualityRating, metricInfo, type Metric } from '@/lib/domain/air-quality';
export function MetricBadge({
  metric,
  value,
  stale = false,
}: {
  metric: Metric;
  value: number | null | undefined;
  stale?: boolean;
}) {
  const rating = airQualityRating(metric, value, stale);
  return (
    <span className={`quality-badge quality-${rating.tone}`}>
      <i aria-hidden="true" />
      {rating.label}
    </span>
  );
}
export function MetricInfo({ metric, label }: { metric: Metric; label: string }) {
  return <InfoTooltip label={label} description={metricInfo[metric]} />;
}
export function InfoTooltip({ label, description }: { label: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const show = () => {
    clearTimeout(timer.current);
    const rect = ref.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 316)),
        top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 260)),
      });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span
      className="metric-info"
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => {
        timer.current = setTimeout(() => setOpen(false), 180);
      }}
    >
      <button
        type="button"
        className="info-button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
      >
        <LuInfo aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="metric-tooltip"
          style={position}
          onMouseEnter={() => clearTimeout(timer.current)}
        >
          <strong>{label}</strong>
          <span>{description}</span>
        </span>
      )}
    </span>
  );
}
