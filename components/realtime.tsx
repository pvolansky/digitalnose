'use client';
import { useEffect, useState } from 'react';
import { LuRadio } from 'react-icons/lu';
import { browserClient } from '@/lib/supabase/client';
export function Realtime({
  siteId,
  deviceId,
  onUpdate,
}: {
  siteId: string;
  deviceId?: string;
  onUpdate: () => void;
}) {
  const [status, setStatus] = useState('Connecting…');
  useEffect(() => {
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          if (!disposed) onUpdate();
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
        setStatus('Live sync connected');
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
    window.addEventListener('digitalnose:updated', refresh);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      window.removeEventListener('digitalnose:updated', refresh);
      void db.removeChannel(channel);
    };
  }, [siteId, deviceId, onUpdate]);
  return (
    <p className="sync-status" role="status">
      <LuRadio aria-hidden="true" />
      {status}
    </p>
  );
}
