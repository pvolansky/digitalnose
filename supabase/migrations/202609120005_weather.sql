alter table public.sites
  add column latitude double precision,
  add column longitude double precision,
  add constraint sites_latitude_range check (latitude between -90 and 90),
  add constraint sites_longitude_range check (longitude between -180 and 180),
  add constraint sites_coordinates_pair check ((latitude is null) = (longitude is null));

grant update (latitude, longitude) on public.sites to authenticated;

create table public.weather_observations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  observed_at_utc timestamptz not null,
  temperature_c double precision,
  relative_humidity_pct double precision check (relative_humidity_pct between 0 and 100),
  surface_pressure_hpa double precision,
  precipitation_mm double precision check (precipitation_mm >= 0 and precipitation_mm < 'Infinity'::float8),
  wind_speed_kmh double precision check (wind_speed_kmh >= 0 and wind_speed_kmh < 'Infinity'::float8),
  wind_direction_deg double precision check (wind_direction_deg between 0 and 360),
  wind_gust_kmh double precision check (wind_gust_kmh >= 0 and wind_gust_kmh < 'Infinity'::float8),
  weather_code integer,
  source text not null default 'open-meteo',
  model text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (site_id, observed_at_utc, source)
);
create index weather_observations_site_time on public.weather_observations(site_id, observed_at_utc desc);
alter table public.weather_observations enable row level security;
revoke all on public.weather_observations from anon, authenticated;
grant select on public.weather_observations to authenticated;
grant all on public.weather_observations to service_role;
create policy weather_read on public.weather_observations for select to authenticated
  using (public.is_site_member(site_id));
