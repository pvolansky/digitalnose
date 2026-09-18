begin;
-- Invoker functions retain the caller's RLS; no service credential is used for dashboard queries.
create function public.sensor_array_health(target_device uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
 'latest_observation',to_jsonb(o), 'last_valid_reading_at',case when s.sensor_type='ens160' then e.minute_start_utc else v.observed_at end,
 'last_seen_at',case when s.sensor_type='ens160' then d.last_seen_at else o.received_at end
 ) order by s.sensor_key),'[]')
 from public.sensors s join public.devices d on d.id=s.device_id
 left join lateral (select * from public.sensor_observations where sensor_id=s.id order by observed_at desc,sequence_number desc limit 1) o on true
 left join lateral (select observed_at from public.sensor_observations where sensor_id=s.id and valid order by observed_at desc limit 1) v on true
 left join lateral (select minute_start_utc from public.minute_aggregates where device_id=s.device_id and s.sensor_type='ens160' order by minute_start_utc desc limit 1) e on true
 where s.device_id=target_device;
$$;

create function public.sensor_chart_window(target_device uuid,window_start timestamptz,window_end timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare bucket_seconds integer; result jsonb;
begin
 if not isfinite(window_start) or not isfinite(window_end) or window_end<=window_start or window_end-window_start>interval '7 days' then raise exception 'Invalid sensor window'; end if;
 bucket_seconds:=greatest(1,ceil(extract(epoch from (window_end-window_start))/360)::integer);
 with maintenance as (
  select e.recorded_at,e.value,lead(e.recorded_at,1,'infinity'::timestamptz) over(order by e.recorded_at,e.id) until
  from public.site_state_events e join public.devices d on d.site_id=e.site_id
  where d.id=target_device and e.event_type='maintenance' and e.recorded_at<=window_end
 ), expanded as (
  select o.sensor_id,o.observed_at,m.key metric,(m.value::text)::double precision value,
   floor(extract(epoch from (o.observed_at-window_start))/bucket_seconds)::integer bucket,
   o.acquisition->>'heater_profile_id' profile,o.acquisition->>'heater_step' step
  from public.sensor_observations o join public.sensors s on s.id=o.sensor_id
  cross join lateral jsonb_each(o.readings) m
  where s.device_id=target_device and o.observed_at>=window_start and o.observed_at<=window_end and o.valid
  and m.value<>'null'::jsonb
  and not exists(select 1 from maintenance m where m.value and m.recorded_at<date_trunc('minute',o.observed_at)+interval '1 minute' and m.until>date_trunc('minute',o.observed_at))
 ), buckets as (
  select sensor_id,metric,bucket,avg(value) mean,min(value) min,max(value) max,count(*) count,
   min(observed_at) first_observed_at,max(observed_at) last_observed_at,
   count(distinct (profile,step)) acquisition_variants
  from expanded group by sensor_id,metric,bucket
 )
 select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('at',window_start+make_interval(secs=>b.bucket*bucket_seconds)) order by b.sensor_id,b.metric,b.bucket),'[]') into result from buckets b;
 return jsonb_build_object('bucket_seconds',bucket_seconds,'points',result);
end; $$;

create function public.sensor_nearest(target_device uuid,selected_at timestamptz,tolerance_seconds integer default 60) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not isfinite(selected_at) or tolerance_seconds not between 1 and 300 then raise exception 'Invalid inspection tolerance'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('sensor_id',s.id,'observation',to_jsonb(o),'derived',to_jsonb(d)) order by s.sensor_key),'[]') into result
 from public.sensors s
 left join lateral (
  select * from public.sensor_observations
  where sensor_id=s.id and valid and observed_at between selected_at-make_interval(secs=>tolerance_seconds) and selected_at+make_interval(secs=>tolerance_seconds)
  order by abs(extract(epoch from (observed_at-selected_at))),observed_at,sequence_number limit 1
 ) o on true
 left join public.sensor_derived_values d on d.observation_id=o.id
 where s.device_id=target_device and s.sensor_type<>'ens160';
 return result;
end; $$;
revoke all on function public.sensor_array_health(uuid),public.sensor_chart_window(uuid,timestamptz,timestamptz),public.sensor_nearest(uuid,timestamptz,integer) from public,anon;
grant execute on function public.sensor_array_health(uuid),public.sensor_chart_window(uuid,timestamptz,timestamptz),public.sensor_nearest(uuid,timestamptz,integer) to authenticated,service_role;
commit;
