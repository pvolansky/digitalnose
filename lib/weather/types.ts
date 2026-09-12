export type WeatherObservation = {
  observed_at_utc: string;
  temperature_c: number | null;
  relative_humidity_pct: number | null;
  surface_pressure_hpa: number | null;
  precipitation_mm: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  wind_gust_kmh: number | null;
  weather_code: number | null;
  source: 'open-meteo';
  model: string | null;
  metadata?: Record<string, number | string | null>;
};
export type WeatherSite = { id: string; latitude: number | null; longitude: number | null };
