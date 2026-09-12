import Link from 'next/link';
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
            ◉ DIGITAL NOSE
          </Link>
          <nav aria-label="Main navigation">
            <Link href={demo ? '/demo' : `/dashboard${suffix}`}>Dashboard</Link>
            <Link href={demo ? '/login' : `/report${suffix}`}>Reports</Link>
            <Link href={demo ? '/login' : `/settings${suffix}`}>Settings</Link>
          </nav>
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
          <p className="tag" style={{ display: 'inline-block' }}>
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
          Digital Nose · Created by Piotr Wolański.{' '}
          <span style={{ float: 'right' }}>Open source. Shared understanding.</span>
        </footer>
      </main>
    </>
  );
}
