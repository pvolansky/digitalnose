'use client';
import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuChevronDown } from 'react-icons/lu';

export function SelectField({
  id,
  name,
  options,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  name?: string;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function show() {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }
  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(`#${CSS.escape(`${id}-option-${active}`)}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);
  return (
    <div
      ref={root}
      className="select-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        className="select-field-trigger"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === 'Tab') setOpen(false);
          else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            setActive((index) =>
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : Math.max(
                      0,
                      Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    ),
            );
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) choose(active);
            else show();
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const index = options.findIndex((option) =>
              option.label.toLowerCase().startsWith(event.key.toLowerCase()),
            );
            if (index >= 0) {
              event.preventDefault();
              setOpen(true);
              setActive(index);
            }
          }
        }}
      >
        <span>
          {!value && placeholder
            ? placeholder
            : options.find((option) => option.value === value)?.label}
        </span>
        <LuChevronDown aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="select-field-options"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={value === option.value}
              className={active === index ? 'is-active' : undefined}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {value === option.value && <LuCheck aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
