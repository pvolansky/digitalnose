'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/client';
export function Realtime({ siteId, deviceId }: { siteId: string; deviceId?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState('Connecting to live updates…');
  useEffect(() => {
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          if (!disposed) router.refresh();
        }, 300);
    };
    let channel = db
      .channel(`site:${siteId}:${deviceId || 'none'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'smell_reports',
          filter: `site_id=eq.${siteId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'site_state_events',
          filter: `site_id=eq.${siteId}`,
        },
        refresh,
      );
    if (deviceId)
      channel = channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'minute_aggregates',
          filter: `device_id=eq.${deviceId}`,
        },
        refresh,
      );
    channel.subscribe((s) => {
      if (disposed) return;
      if (s === 'SUBSCRIBED') {
        setStatus('Live updates connected');
        refresh();
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED')
        setStatus('Reconnecting · checking for updates every minute');
    });
    const fallback = setInterval(refresh, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      void db.removeChannel(channel);
    };
  }, [siteId, deviceId, router]);
  return (
    <p className="muted" role="status" style={{ fontSize: 11 }}>
      {status}
    </p>
  );
}
