begin;

-- Keep the dashboard contract stable while preferring Phase III minute summaries.
-- Raw observations remain a historical fallback only for minutes without a summary.
create or replace function public.sensor_chart_window(
 target_device uuid,
 window_start timestamptz,
 window_end timestamptz
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare bucket_seconds integer; result jsonb;
begin
 if not isfinite(window_start) or not isfinite(window_end) or window_end<=window_start
    or window_end-window_start>interval '7 days' then
   raise exception 'Invalid sensor window';
 end if;
 bucket_seconds:=greatest(60,ceil(extract(epoch from (window_end-window_start))/360)::integer);

 with maintenance as (
  select e.recorded_at,e.value,
   lead(e.recorded_at,1,'infinity'::timestamptz) over(order by e.recorded_at,e.id) until
  from public.site_state_events e
  join public.devices d on d.site_id=e.site_id
  where d.id=target_device and e.event_type='maintenance' and e.recorded_at<=window_end
 ), raw_values as (
  select o.sensor_id,o.observed_at,m.key metric,(m.value::text)::double precision value,
   floor(extract(epoch from (o.observed_at-window_start))/bucket_seconds)::integer bucket,
   o.acquisition->>'heater_profile_id' profile,o.acquisition->>'heater_step' step
  from public.sensor_observations o
  join public.sensors s on s.id=o.sensor_id
  cross join lateral jsonb_each(o.readings) m
  where s.device_id=target_device and s.sensor_type<>'ens160'
   and o.observed_at>=window_start and o.observed_at<=window_end and o.valid
   and m.value<>'null'::jsonb
   -- A summary is authoritative for its whole minute, including degraded/unknown
   -- minutes, which must remain gaps rather than falling back to apparently clean raw data.
   and not exists(
    select 1 from public.sensor_minute_summaries sm
    where sm.sensor_id=o.sensor_id and sm.minute_start=date_trunc('minute',o.observed_at)
   )
   and not exists(
    select 1 from maintenance x
    where x.value and x.recorded_at<date_trunc('minute',o.observed_at)+interval '1 minute'
     and x.until>date_trunc('minute',o.observed_at)
   )
 ), raw_contributions as (
  select sensor_id,metric,bucket,avg(value) mean,min(value) min,max(value) max,count(*)::bigint sample_count,
   (array_agg(value order by observed_at))[1] first_value,
   (array_agg(value order by observed_at desc))[1] last_value,
   min(observed_at) first_observed_at,max(observed_at) last_observed_at,
   count(distinct (profile,step))::bigint acquisition_variants,
   count(*)::bigint expected_count,count(*)::bigint observed_count,count(*)::bigint valid_count,
   0::bigint missing_count,'normal'::text health
  from raw_values group by sensor_id,metric,bucket
 ), summary_contributions as (
  select sm.sensor_id,m.key metric,
   floor(extract(epoch from (sm.minute_start-window_start))/bucket_seconds)::integer bucket,
   (m.value->>'mean')::double precision mean,
   (m.value->>'min')::double precision min,(m.value->>'max')::double precision max,
   (m.value->>'n')::bigint sample_count,
   (m.value->>'first')::double precision first_value,
   (m.value->>'last')::double precision last_value,
   greatest(sm.minute_start,window_start) first_observed_at,
   least(sm.minute_start+interval '1 minute',window_end) last_observed_at,
   1::bigint acquisition_variants,
   (sm.body->>'expected_samples')::bigint expected_count,
   (sm.body->>'observed_samples')::bigint observed_count,
   (sm.body->>'valid_samples')::bigint valid_count,
   (sm.body->>'missing_samples')::bigint missing_count,
   sm.body->>'health' health
  from public.sensor_minute_summaries sm
  join public.sensors s on s.id=sm.sensor_id and s.device_id=target_device and s.sensor_type<>'ens160'
  cross join lateral jsonb_each(sm.body->'metrics') m
  where sm.minute_start>=window_start and sm.minute_start<=window_end
   and sm.body->>'health'='normal' and m.value<>'null'::jsonb
   and not exists(
    select 1 from maintenance x
    where x.value and x.recorded_at<sm.minute_start+interval '1 minute' and x.until>sm.minute_start
   )
 ), contributions as (
  select * from raw_contributions
  union all
  select * from summary_contributions
 ), buckets as (
  select sensor_id,metric,bucket,
   sum(mean*sample_count)/nullif(sum(sample_count),0) mean,
   min(min) min,max(max) max,sum(sample_count) count,
   (array_agg(first_value order by first_observed_at))[1] first,
   (array_agg(last_value order by last_observed_at desc))[1] last,
   min(first_observed_at) first_observed_at,max(last_observed_at) last_observed_at,
   max(acquisition_variants) acquisition_variants,
   sum(expected_count) expected_count,sum(observed_count) observed_count,
   sum(valid_count) valid_count,sum(missing_count) missing_count,
   case when bool_and(health='normal') then 'normal' else 'degraded' end health
  from contributions group by sensor_id,metric,bucket
 )
 select coalesce(jsonb_agg(
  to_jsonb(b) || jsonb_build_object('at',window_start+make_interval(secs=>b.bucket*bucket_seconds))
  order by b.sensor_id,b.metric,b.bucket
 ),'[]') into result from buckets b;
 return jsonb_build_object('bucket_seconds',bucket_seconds,'points',result);
end; $$;

revoke all on function public.sensor_chart_window(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.sensor_chart_window(uuid,timestamptz,timestamptz) to authenticated,service_role;

commit;
