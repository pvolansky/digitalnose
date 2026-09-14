'use client';
import { useId } from 'react';
/** Separate native pickers keep date and time editing manageable on small screens. */
export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [date = '', time = ''] = value.split('T');
  return (
    <fieldset className="date-time-field">
      <legend>{label}</legend>
      <div className="date-time-fields">
        <label htmlFor={`${id}-date`}>
          Date
          <input
            id={`${id}-date`}
            aria-label={`${label} date`}
            type="date"
            required
            value={date}
            onInput={(event) => onChange(`${event.currentTarget.value}T${time}`)}
          />
        </label>
        <label htmlFor={`${id}-time`}>
          Time
          <input
            id={`${id}-time`}
            aria-label={`${label} time`}
            type="time"
            required
            step={60}
            value={time}
            onInput={(event) => onChange(`${date}T${event.currentTarget.value}`)}
          />
        </label>
      </div>
    </fieldset>
  );
}
export function localDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
