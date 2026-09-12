export type DeviceHealthState = 'live' | 'warming_up' | 'offline' | 'no_data';
const freshnessMs = 3 * 60 * 1000;
function ageAt(value: string | null | undefined, now: number) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}
export function getDeviceHealth({
  lastSeenAt,
  latestAggregateAt,
  now,
}: {
  lastSeenAt?: string | null;
  latestAggregateAt?: string | null;
  now: number;
}) {
  const heartbeatAge = ageAt(lastSeenAt, now);
  const readingAge = ageAt(latestAggregateAt, now);
  const online = heartbeatAge !== null && heartbeatAge <= freshnessMs;
  const fresh = readingAge !== null && readingAge <= freshnessMs;
  const state: DeviceHealthState = online
    ? fresh
      ? 'live'
      : 'warming_up'
    : heartbeatAge === null && readingAge === null
      ? 'no_data'
      : 'offline';
  return {
    state,
    online,
    fresh,
    deviceLabel: online ? 'Online' : heartbeatAge === null ? 'Not seen yet' : 'Offline',
    sensorLabel: fresh
      ? 'Live'
      : online
        ? 'Warming up'
        : readingAge === null
          ? 'No data yet'
          : 'No recent data',
    headline: {
      live: 'Live',
      warming_up: 'Sensor warming up',
      offline: 'Device offline',
      no_data: 'No data yet',
    }[state],
    badgeLabel: {
      live: 'Live',
      warming_up: 'Warming up',
      offline: 'Device offline',
      no_data: 'No data yet',
    }[state],
  };
}
export function healthTimeAgo(value: string | null | undefined, now: number) {
  const age = ageAt(value, now);
  if (age === null) return 'Not yet';
  const seconds = Math.floor(age / 1000);
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
