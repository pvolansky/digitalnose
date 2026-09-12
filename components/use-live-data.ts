'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/client';
import { createRefreshQueue } from '@/lib/domain/refresh-queue';
export function useLiveData<T>(
  initial: T,
  load: () => Promise<T>,
  initialError = false,
  authenticated = true,
) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError);
  const [updating, setUpdating] = useState(false);
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let signedOut = false;
    const db = authenticated ? browserClient() : null;
    const sessionEnded = () => {
      if (disposed || signedOut) return;
      signedOut = true;
      queue.dispose();
      router.replace('/login?session=expired');
    };
    const queue = createRefreshQueue(async () => {
      if (signedOut || disposed) return;
      setUpdating(true);
      try {
        if (db) {
          const { data, error } = await db.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            sessionEnded();
            return;
          }
        }
        if (signedOut || disposed) return;
        const next = await load();
        if (!disposed && !signedOut) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        if (!disposed) setUpdating(false);
      }
    });
    const subscription = db?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') sessionEnded();
    }).data.subscription;
    request.current = () => {
      if (!signedOut) queue.request();
    };
    return () => {
      disposed = true;
      queue.dispose();
      subscription?.unsubscribe();
    };
  }, [load, authenticated, router]);
  return { data, error, updating, refresh: useCallback(() => request.current(), []) };
}
