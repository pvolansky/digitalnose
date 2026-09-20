'use client';
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { metricCatalogue, metricDescription, type SensorMetric } from '@/lib/sensors/metric-info';
import { infoPosition } from '@/lib/sensors/info-position';
import { LuInfo } from 'react-icons/lu';
import { airQualityRating, type Metric } from '@/lib/domain/air-quality';
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
export function MetricInfo({ metric, label }: { metric: SensorMetric; label?: string }) {
  return (
    <InfoTooltip
      label={label ?? metricCatalogue[metric].label}
      description={metricDescription(metric)}
    />
  );
}
export function InfoTooltip({ label, description }: { label: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const ref = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      setPosition(
        infoPosition(anchor, box, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
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
        timer.current = setTimeout(() => {
          if (!ref.current?.contains(document.activeElement)) setOpen(false);
        }, 180);
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
          ref={panel}
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
