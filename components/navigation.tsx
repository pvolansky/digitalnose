'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LuActivity, LuNotebookPen, LuSettings2 } from 'react-icons/lu';
export function Navigation({ suffix, demo }: { suffix: string; demo: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation">
      {[
        { path: '/dashboard', label: 'Overview', Icon: LuActivity },
        { path: '/report', label: 'Journal', Icon: LuNotebookPen },
        { path: '/settings', label: 'Settings', Icon: LuSettings2 },
      ].map(({ path, label, Icon }) => (
        <Link
          key={path}
          href={demo ? (path === '/dashboard' ? '/demo' : '/login') : `${path}${suffix}`}
          aria-current={pathname === path || (demo && path === '/dashboard') ? 'page' : undefined}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
