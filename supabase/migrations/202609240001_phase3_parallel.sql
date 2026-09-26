begin;
-- Additive only. Existing observation/ENS tables, ingestion and indexes are untouched.
-- Provision a dedicated Auth user explicitly during rollout, then grant only its
-- device here. It does not need site-owner membership or a service-role key.
create table public.archive_uploaders (
 user_id uuid not null references auth.users(id),
 device_id uuid not null references public.devices(id),
 primary key(user_id,device_id)
);
alter table public.archive_uploaders enable row level security;
revoke all on public.archive_uploaders from public,anon,authenticated;
grant all on public.archive_uploaders to service_role;
create function public.phase3_can_upload(device uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.archive_uploaders u where u.user_id=auth.uid() and u.device_id=device);
$$;
create function public.phase3_archive_allowed(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.archive_uploaders u where u.user_id=auth.uid() and
  (object_name like 'raw/schema=v1/device='||u.device_id::text||'/%'
   or object_name like 'sessions/device='||u.device_id::text||'/%'));
$$;
revoke all on function public.phase3_can_upload(uuid),public.phase3_archive_allowed(text) from public,anon,authenticated;
grant execute on function public.phase3_can_upload(uuid),public.phase3_archive_allowed(text) to authenticated;
create table public.sensor_minute_summaries (
 sensor_id uuid not null references public.sensors(id),
 device_id uuid not null references public.devices(id),
 minute_start timestamptz not null check(isfinite(minute_start) and extract(second from minute_start)=0),
 revision bigint not null check(revision>0),
 body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=65536),
 updated_at timestamptz not null default now(),
 primary key(sensor_id,minute_start),
 check(body->>'health' in ('normal','degraded','unknown')),
 check((body->>'expected_samples')::integer between 1 and 60000),
 check((body->>'observed_samples')::integer>=0),
 check((body->>'missing_samples')::integer between 0 and (body->>'expected_samples')::integer),
 check((body->>'valid_samples')::integer between 0 and (body->>'successful_reads')::integer),
 check((body->>'successful_reads')::integer between 0 and (body->>'observed_samples')::integer),
 check(jsonb_typeof(body->'metrics')='object' and jsonb_typeof(body->'provenance')='object')
);
create table public.device_health_summaries (
 id text primary key check(id ~ '^[0-9a-f]{64}$'),
 device_id uuid not null references public.devices(id),
 observed_at timestamptz not null check(isfinite(observed_at)),
 body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=16384),
 check(body->>'health' in ('normal','degraded','unknown'))
);
create index device_health_time on public.device_health_summaries(device_id,observed_at desc);
alter table public.sensor_minute_summaries enable row level security;
alter table public.device_health_summaries enable row level security;
revoke all on public.sensor_minute_summaries,public.device_health_summaries from anon,authenticated;
grant select on public.sensor_minute_summaries,public.device_health_summaries to authenticated;
grant all on public.sensor_minute_summaries,public.device_health_summaries to service_role;
create policy phase3_summary_read on public.sensor_minute_summaries for select to authenticated
 using(exists(select 1 from public.devices d where d.id=device_id and public.is_site_member(d.site_id)));
create policy phase3_health_read on public.device_health_summaries for select to authenticated
 using(exists(select 1 from public.devices d where d.id=device_id and public.is_site_member(d.site_id)));

create function public.phase3_put_summary(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare device uuid := (payload->>'device_id')::uuid;
 sensor uuid := (payload->>'sensor_id')::uuid;
 minute_at timestamptz := (payload->>'minute_start')::timestamptz;
 version bigint := (payload->>'revision')::bigint;
 saved public.sensor_minute_summaries;
 key text; metric_name text; metric jsonb; field text; allowed text[];
begin
 if not exists(select 1 from public.sensors s join public.devices d on d.id=s.device_id
   where s.id=sensor and d.id=device and s.sensor_type=payload->>'sensor_type'
   and public.phase3_can_upload(device)) then raise exception 'Archive uploader access required'; end if;
 foreach key in array array['expected_samples','observed_samples','successful_reads','valid_samples',
   'invalid_samples','warmup_samples','error_samples','unknown_samples','missing_samples','occupied_slots'] loop
   if jsonb_typeof(payload->key) is distinct from 'number' or (payload->>key)::numeric<0
      or (payload->>key)::numeric<>trunc((payload->>key)::numeric) then
     raise exception 'Invalid summary count';
   end if;
 end loop;
 if not (payload ?& array['metrics','provenance','health','source_digest'])
   or jsonb_typeof(payload->'source_digest') is distinct from 'string'
   or jsonb_typeof(payload->'health') is distinct from 'string'
   or (payload->>'source_digest') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(payload->'metrics') is distinct from 'object'
   or jsonb_typeof(payload->'provenance') is distinct from 'object'
   or payload->>'health' not in ('normal','degraded','unknown') then
   raise exception 'Invalid summary';
 end if;
 if (payload->>'occupied_slots')::integer>(payload->>'expected_samples')::integer
    or (payload->>'missing_samples')::integer<>(payload->>'expected_samples')::integer-(payload->>'occupied_slots')::integer
    or (payload->>'occupied_slots')::integer>(payload->>'observed_samples')::integer then
   raise exception 'Invalid summary coverage'; end if;
 if (payload->>'valid_samples')::integer+(payload->>'invalid_samples')::integer+
    (payload->>'warmup_samples')::integer+(payload->>'error_samples')::integer+
    (payload->>'unknown_samples')::integer<>(payload->>'observed_samples')::integer then
   raise exception 'Summary status counts do not reconcile'; end if;
 allowed := case payload->>'sensor_type'
  when 'ens160' then array['tvoc_ppb','eco2_ppm','aqi']
  when 'bme690' then array['temperature_c','humidity_pct','pressure_pa','gas_resistance_ohm']
  when 'sgp41' then array['raw_voc_ticks','raw_nox_ticks','compensation_temperature_c','compensation_humidity_pct']
  when 'sps30' then array['pm1_ug_m3','pm2_5_ug_m3','pm4_ug_m3','pm10_ug_m3','number_pm0_5_cm3',
    'number_pm1_cm3','number_pm2_5_cm3','number_pm4_cm3','number_pm10_cm3','typical_particle_size_um'] end;
 if not (payload->'metrics' ?& allowed) then raise exception 'Missing summary metric'; end if;
 for metric_name,metric in select * from jsonb_each(payload->'metrics') loop
   if not metric_name=any(allowed) then raise exception 'Unknown summary metric'; end if;
   if metric='null'::jsonb then continue; end if;
   if jsonb_typeof(metric)<>'object' then raise exception 'Invalid metric object'; end if;
   foreach field in array array['n','min','max','mean','m2','first','last'] loop
     if jsonb_typeof(metric->field) is distinct from 'number' then raise exception 'Invalid metric number'; end if;
   end loop;
   if (metric->>'n')::numeric<>trunc((metric->>'n')::numeric) or (metric->>'n')::numeric<1
     or (metric->>'n')::numeric>(payload->>'valid_samples')::numeric
     or (metric->>'m2')::numeric<0
     or (metric->>'min')::numeric>(metric->>'mean')::numeric
     or (metric->>'mean')::numeric>(metric->>'max')::numeric
     or (metric->>'first')::numeric not between (metric->>'min')::numeric and (metric->>'max')::numeric
     or (metric->>'last')::numeric not between (metric->>'min')::numeric and (metric->>'max')::numeric
     or not (metric ?& array['min_at','max_at']) then raise exception 'Invalid metric statistics'; end if;
   if (metric->>'min_at')::timestamptz < minute_at or (metric->>'min_at')::timestamptz >= minute_at+interval '1 minute'
     or (metric->>'max_at')::timestamptz < minute_at or (metric->>'max_at')::timestamptz >= minute_at+interval '1 minute'
     or metric->>'min_at' is null or metric->>'max_at' is null then raise exception 'Invalid extrema timestamp'; end if;
 end loop;
 insert into public.sensor_minute_summaries(sensor_id,device_id,minute_start,revision,body)
 values(sensor,device,minute_at,version,payload-'revision')
 on conflict(sensor_id,minute_start) do update set revision=excluded.revision,body=excluded.body,updated_at=now()
 where public.sensor_minute_summaries.revision<excluded.revision;
 select * into saved from public.sensor_minute_summaries where sensor_id=sensor and minute_start=minute_at;
 if saved.revision=version and saved.body<>(payload-'revision') then raise exception 'Conflicting summary revision'; end if;
 return '{"ok":true}'::jsonb;
end; $$;

create function public.phase3_put_health(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare device uuid := (payload->>'device_id')::uuid; saved jsonb;
begin
 if not public.phase3_can_upload(device) then
   raise exception 'Archive uploader access required'; end if;
 if payload->'body'->>'health' is null or payload->'body'->>'health' not in ('normal','degraded','unknown') then
   raise exception 'Invalid health'; end if;
 insert into public.device_health_summaries(id,device_id,observed_at,body)
 values(payload->>'id',device,(payload->'body'->>'observed_at')::timestamptz,payload->'body') on conflict(id) do nothing;
 select body into saved from public.device_health_summaries where id=payload->>'id' and device_id=device;
 if saved is distinct from payload->'body' then raise exception 'Conflicting health identity'; end if;
 return '{"ok":true}'::jsonb;
end; $$;
revoke all on function public.phase3_put_summary(jsonb),public.phase3_put_health(jsonb) from public,anon,authenticated;
grant execute on function public.phase3_put_summary(jsonb),public.phase3_put_health(jsonb) to authenticated;
commit;
