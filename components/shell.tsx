import Link from 'next/link';
import { LuInfo } from 'react-icons/lu';
import { BrandMark } from './brand-mark';
import { Navigation } from './navigation';
import { signOut } from '@/app/login/actions';
import type { Site } from '@/lib/domain/types';
export function Shell({
  children,
  site,
  sites = [],
  demo = false,
}: {
  children: React.ReactNode;
  site?: Site;
  sites?: Site[];
  demo?: boolean;
}) {
  const suffix = site ? `?site=${site.id}` : '';
  return (
    <>
      <header>
        <div className="container row spread">
          <Link className="brand" href={demo ? '/demo' : '/dashboard'}>
            <BrandMark /> Digital Nose
          </Link>
          <Navigation suffix={suffix} demo={demo} />
          {demo ? (
            <Link className="tag" href="/login">
              Sign in
            </Link>
          ) : (
            <form action={signOut}>
              <button className="secondary" style={{ padding: '7px 12px' }}>
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>
      <main className="container">
        {demo && (
          <p className="demo-banner">
            <LuInfo aria-hidden="true" />
            Demo · illustrative data, no live sensor connected
          </p>
        )}
        {sites.length > 1 && (
          <div className="row" aria-label="Sites">
            {sites.map((s) => (
              <Link
                className="tag"
                aria-current={site?.id === s.id ? 'page' : undefined}
                key={s.id}
                href={`/dashboard?site=${s.id}`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}
        {children}
        <footer>
          <span>Open-source air sensing</span>
          <span>
            Created by{' '}
            <a href="https://piotrwolanski.com" target="_blank" rel="noopener noreferrer">
              Piotr Wolanski
            </a>
          </span>
        </footer>
      </main>
    </>
  );
}
