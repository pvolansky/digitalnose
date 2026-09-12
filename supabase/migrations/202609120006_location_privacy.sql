-- Coordinates are private configuration, not shared site data.
revoke select on public.sites from authenticated, anon;
grant select (id, name, timezone, continuous_ventilation, created_at) on public.sites to authenticated;

create function public.get_weather_location(target_site uuid)
returns table(latitude double precision, longitude double precision)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_site_owner(target_site) then raise exception 'Owner access required'; end if;
  return query select s.latitude, s.longitude from public.sites s where s.id=target_site;
end;
$$;
revoke all on function public.get_weather_location(uuid) from public, anon;
grant execute on function public.get_weather_location(uuid) to authenticated;

-- Provider grid metadata can disclose location even without site coordinates.
revoke select on public.weather_observations from authenticated, anon;
grant select (id, site_id, observed_at_utc, temperature_c, relative_humidity_pct,
  surface_pressure_hpa, precipitation_mm, wind_speed_kmh, wind_direction_deg,
  wind_gust_kmh, weather_code, source, model, created_at)
  on public.weather_observations to authenticated;
