'use client';
import Link, { useLinkStatus } from 'next/link';
import { LuLoaderCircle } from 'react-icons/lu';
export function RangeLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={true}
      scroll={false}
      className={`button ${active ? '' : 'secondary'}`}
      aria-current={active ? 'page' : undefined}
    >
      <RangeLabel label={label} />
    </Link>
  );
}
function RangeLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="range-label" aria-busy={pending}>
      {label}
      <LuLoaderCircle
        className={`range-spinner ${pending ? 'spin' : ''}`}
        aria-hidden="true"
        style={{ opacity: pending ? 1 : 0 }}
      />
      {pending && (
        <span className="sr-only" role="status">
          Loading {label} of readings…
        </span>
      )}
    </span>
  );
}
