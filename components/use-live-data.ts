'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRefreshQueue } from '@/lib/domain/refresh-queue';
export function useLiveData<T>(initial: T, load: () => Promise<T>, initialError = false) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError);
  const [updating, setUpdating] = useState(false);
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    const queue = createRefreshQueue(async () => {
      setUpdating(true);
      try {
        const next = await load();
        if (!disposed) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        if (!disposed) setUpdating(false);
      }
    });
    request.current = queue.request;
    return () => {
      disposed = true;
      queue.dispose();
    };
  }, [load]);
  return { data, error, updating, refresh: useCallback(() => request.current(), []) };
}
