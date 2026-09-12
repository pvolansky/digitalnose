import type { Reading, Site, Device, SmellReport, StateEvent } from './types';
export function demoData(now: number) {
  const site: Site = {
    id: 'demo',
    name: 'Home · Living room',
    timezone: 'Europe/London',
    continuous_ventilation: true,
  };
  const device: Device = {
    id: 'demo-device',
    site_id: 'demo',
    name: 'Living room',
    device_identifier: 'diginose-demo',
    last_seen_at: new Date(now).toISOString(),
  };
  const end = Math.floor(now / 60000) * 60000 - 60000;
  const readings: Reading[] = Array.from({ length: 1440 }, (_, i) => {
    const peak =
      230 * Math.exp(-Math.pow((i - 1020) / 55, 2)) + 110 * Math.exp(-Math.pow((i - 530) / 80, 2));
    const tvoc = Math.round(105 + 24 * Math.sin(i / 65) + 12 * Math.sin(i / 7) + peak);
    const eco2 = Math.round(570 + tvoc * 0.45 + 30 * Math.sin(i / 43));
    return {
      id: `demo-${i}`,
      device_id: device.id,
      minute_start_utc: new Date(end - (1439 - i) * 60000).toISOString(),
      tvoc_mean: tvoc,
      tvoc_min: tvoc - 12,
      tvoc_max: tvoc + 17,
      eco2_mean: eco2,
      eco2_min: eco2 - 20,
      eco2_max: eco2 + 24,
      aqi_max: tvoc > 250 ? 3 : 2,
      sample_count: 12,
    };
  });
  const reports: SmellReport[] = [
    {
      id: 'r1',
      site_id: 'demo',
      user_id: 'demo-user',
      reported_at: new Date(end - 420 * 60000).toISOString(),
      intensity: 4,
      smell_type: 'Restaurant',
      note: 'Noticeable near the open window.',
    },
    {
      id: 'r2',
      site_id: 'demo',
      user_id: 'demo-user',
      reported_at: new Date(end - 900 * 60000).toISOString(),
      intensity: 2,
      smell_type: 'Cooking',
      note: null,
    },
  ];
  const events: StateEvent[] = [
    ['window_open', false, 1500],
    ['user_in_room', false, 1500],
    ['user_in_room', true, 960],
    ['window_open', true, 460],
    ['window_open', false, 365],
    ['user_in_room', false, 300],
    ['user_in_room', true, 80],
  ].map(([type, value, minutes], i) => ({
    id: `s${i}`,
    site_id: 'demo',
    user_id: 'demo-user',
    event_type: type as StateEvent['event_type'],
    value: value as boolean,
    recorded_at: new Date(end - Number(minutes) * 60000).toISOString(),
  }));

  return { site, device, readings, reports, events };
}
