'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { browserClient } from '@/lib/supabase/client';

export function AccountLink({
  className,
  children,
  signedOutLabel = 'Sign in',
}: {
  className?: string;
  children?: ReactNode;
  signedOutLabel?: string;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    // INITIAL_SESSION resolves the label; later events also cover sign-in/out in another tab.
    const {
      data: { subscription },
    } = browserClient().auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => subscription.unsubscribe();
  }, []);
  return (
    <Link className={className} href={signedIn === false ? '/login' : '/dashboard'}>
      {signedIn === null ? 'Your account' : signedIn ? 'Open dashboard' : signedOutLabel} {children}
    </Link>
  );
}
