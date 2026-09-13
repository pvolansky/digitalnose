'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LuActivity, LuNotebookPen, LuSettings2 } from 'react-icons/lu';
export function Navigation({ suffix, demo }: { suffix: string; demo: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation">
      {[
        { path: demo ? '/demo' : '/dashboard', label: 'Overview', Icon: LuActivity },
        { path: demo ? '/demo/journal' : '/report', label: 'Journal', Icon: LuNotebookPen },
        { path: demo ? '/demo/settings' : '/settings', label: 'Settings', Icon: LuSettings2 },
      ].map(({ path, label, Icon }) => (
        <Link
          key={path}
          href={demo ? path : `${path}${suffix}`}
          aria-current={pathname === path ? 'page' : undefined}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
