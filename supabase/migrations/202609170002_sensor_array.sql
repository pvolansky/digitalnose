begin;
-- A device remains the authenticated collector; sensors are independently sampled children.
create table public.sensors (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id) on delete cascade,
 sensor_key text not null check(sensor_key ~ '^[a-z0-9_]{1,64}$'),
 sensor_type text not null check(sensor_type in ('ens160','bme690','sgp41','sps30')),
 manufacturer text not null, model text not null, label text not null,
 location text not null default 'room_main', connection_type text not null check(connection_type in ('i2c','i2c_mux','usb')),
 mux_channel integer check(mux_channel between 0 and 7), enabled boolean not null default true,
 freshness_seconds integer not null default 180 check(freshness_seconds between 5 and 86400),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(device_id,sensor_key), unique(id,sensor_type),
 check((connection_type='i2c_mux')=(mux_channel is not null))
);

-- One row describes one sensor at one actual observation time, never a synchronized array.
create table public.sensor_observations (
 id uuid primary key default gen_random_uuid(), sensor_id uuid not null,
 sensor_type text not null check(sensor_type in ('bme690','sgp41','sps30')),
 observed_at timestamptz not null check(observed_at >= '2000-01-01Z'::timestamptz and isfinite(observed_at)),
 received_at timestamptz not null default now(),
 sequence_number bigint not null default 0 check(sequence_number between 0 and 9007199254740991),
 status text not null check(status in ('ok','warming_up','invalid','error','disconnected')),
 valid boolean not null,
 readings jsonb not null check(jsonb_typeof(readings)='object'),
 acquisition jsonb not null default '{}' check(jsonb_typeof(acquisition)='object'),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 error_code text check(length(error_code)<=100), last_error text check(length(last_error)<=500),
 foreign key(sensor_id,sensor_type) references public.sensors(id,sensor_type),
 unique(sensor_id,observed_at,sequence_number),
 check(not valid or status='ok')
);
-- The unique index serves per-sensor time windows and newest-observation lookups.
create index sensor_observations_valid_time_idx on public.sensor_observations(sensor_id,observed_at desc) where valid;
-- Optional deliberately computed indices remain separate from observed measurements.
create table public.sensor_derived_values (
 observation_id uuid primary key references public.sensor_observations(id) on delete cascade,
 algorithm text not null check(length(algorithm) between 1 and 100),
 algorithm_version text not null check(length(algorithm_version) between 1 and 100),
 voc_index numeric check(voc_index between 0 and 500), nox_index numeric check(nox_index between 0 and 500)
);

create function public.register_sensor_array(target_device uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_site_owner((select site_id from public.devices where id=target_device)) then raise exception 'Owner access required'; end if;
 insert into public.sensors(device_id,sensor_key,sensor_type,manufacturer,model,label,connection_type,mux_channel,metadata)
 values
 (target_device,'ens160_01','ens160','ScioSense','ENS160','ENS160','i2c',null,'{"hardware_status":"installed"}'),
 (target_device,'bme690_01','bme690','Bosch Sensortec','BME690','BME690 #1','i2c_mux',0,'{"hardware_status":"available_not_connected","environment_primary":true}'),
 (target_device,'bme690_02','bme690','Bosch Sensortec','BME690','BME690 #2','i2c_mux',1,'{"hardware_status":"available_not_connected"}'),
 (target_device,'sgp41_01','sgp41','Sensirion','SGP41','SGP41','i2c_mux',2,'{"hardware_status":"available_not_connected"}'),
 (target_device,'sps30_01','sps30','Sensirion','SPS30','SPS30','usb',null,'{"hardware_status":"ordered"}')
 on conflict(device_id,sensor_key) do nothing;
end; $$;
-- Existing collectors receive registry rows only. No telemetry is seeded or copied.
insert into public.sensors(device_id,sensor_key,sensor_type,manufacturer,model,label,connection_type,mux_channel,metadata)
select d.id,v.* from public.devices d cross join (values
 ('ens160_01','ens160','ScioSense','ENS160','ENS160','i2c',null::integer,'{"hardware_status":"installed"}'::jsonb),
 ('bme690_01','bme690','Bosch Sensortec','BME690','BME690 #1','i2c_mux',0,'{"hardware_status":"available_not_connected","environment_primary":true}'::jsonb),
 ('bme690_02','bme690','Bosch Sensortec','BME690','BME690 #2','i2c_mux',1,'{"hardware_status":"available_not_connected"}'::jsonb),
 ('sgp41_01','sgp41','Sensirion','SGP41','SGP41','i2c_mux',2,'{"hardware_status":"available_not_connected"}'::jsonb),
 ('sps30_01','sps30','Sensirion','SPS30','SPS30','usb',null::integer,'{"hardware_status":"ordered"}'::jsonb)
) v;

-- Strict raw field validation is also enforced at the database boundary.
create function public.valid_sensor_readings(kind text, value jsonb, is_valid boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare allowed text[]; required text[]; k text; v jsonb; n numeric;
begin
 if jsonb_typeof(value)<>'object' then return false; end if;
 if kind='bme690' then
  allowed:=array['temperature_c','humidity_pct','pressure_pa','gas_resistance_ohm']; required:=array['gas_resistance_ohm'];
 elsif kind='sgp41' then
  allowed:=array['raw_voc_ticks','raw_nox_ticks','compensation_temperature_c','compensation_humidity_pct']; required:=array['raw_voc_ticks','raw_nox_ticks'];
 elsif kind='sps30' then
  allowed:=array['pm1_ug_m3','pm2_5_ug_m3','pm4_ug_m3','pm10_ug_m3','number_pm0_5_cm3','number_pm1_cm3','number_pm2_5_cm3','number_pm4_cm3','number_pm10_cm3','typical_particle_size_um'];
  required:=array['pm1_ug_m3','pm2_5_ug_m3','pm4_ug_m3','pm10_ug_m3'];
 else return false; end if;
 for k,v in select * from jsonb_each(value) loop
  if not k=any(allowed) then return false; end if;
  if v='null'::jsonb then continue; end if;
  if jsonb_typeof(v)<>'number' then return false; end if;
  n:=v::text::numeric;
  if abs(n)>1e100 then return false; end if;
  if k like '%temperature_c' then if n < -273.15 then return false; end if;
  elsif k like '%humidity_pct' then if n<0 or n>100 then return false; end if;
  elsif k like 'raw_%_ticks' then if n<0 or n>65535 or n<>trunc(n) then return false; end if;
  elsif n<0 then return false;
  end if;
 end loop;
 if is_valid then
  foreach k in array required loop
   if not value ? k or value->k='null'::jsonb then return false; end if;
  end loop;
 end if;
 return true;
end; $$;
alter table public.sensor_observations add constraint sensor_readings_valid check(public.valid_sensor_readings(sensor_type,readings,valid));

alter table public.sensors enable row level security;
alter table public.sensor_observations enable row level security;
alter table public.sensor_derived_values enable row level security;
revoke all on public.sensors,public.sensor_observations,public.sensor_derived_values from anon,authenticated;
grant select on public.sensors,public.sensor_observations,public.sensor_derived_values to authenticated;
grant all on public.sensors,public.sensor_observations,public.sensor_derived_values to service_role;
grant update(label,location,connection_type,mux_channel,enabled,freshness_seconds,metadata) on public.sensors to authenticated;
create policy sensors_update on public.sensors for update to authenticated
 using(exists(select 1 from public.devices d where d.id=device_id and public.is_site_owner(d.site_id)))
 with check(exists(select 1 from public.devices d where d.id=device_id and public.is_site_owner(d.site_id)));
create function public.sensor_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); return new; end; $$;
create trigger sensor_updated_at before update on public.sensors for each row execute function public.sensor_updated_at();
revoke all on function public.sensor_updated_at() from public,anon,authenticated;
create policy sensors_read on public.sensors for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and public.is_site_member(d.site_id)));
create policy observations_read on public.sensor_observations for select to authenticated using(exists(select 1 from public.sensors s join public.devices d on d.id=s.device_id where s.id=sensor_id and public.is_site_member(d.site_id)));
create policy derived_read on public.sensor_derived_values for select to authenticated using(exists(select 1 from public.sensor_observations o where o.id=observation_id));
revoke all on function public.register_sensor_array(uuid) from public,anon,authenticated;
grant execute on function public.register_sensor_array(uuid) to authenticated;
revoke all on function public.valid_sensor_readings(text,jsonb,boolean) from public,anon;
grant execute on function public.valid_sensor_readings(text,jsonb,boolean) to authenticated,service_role;
commit;
