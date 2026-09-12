-- Authentication, deduplication and heartbeat are one transaction.
create function public.ingest_minute(payload jsonb,key_digest text) returns boolean language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select d.id into target from public.devices d join public.device_api_keys k on k.device_id=d.id
 where d.device_identifier=payload->>'device_identifier' and k.key_hash=key_digest and k.revoked_at is null for share of k;
 if target is null then return false; end if;
 if (payload->>'minute_start_utc')::timestamptz > now()+interval '1 minute' then raise exception 'Future timestamp'; end if;
 insert into public.minute_aggregates(device_id,minute_start_utc,tvoc_mean,tvoc_min,tvoc_max,eco2_mean,eco2_min,eco2_max,aqi_max,sample_count)
 values(target,(payload->>'minute_start_utc')::timestamptz,(payload->>'tvoc_mean')::numeric,(payload->>'tvoc_min')::integer,(payload->>'tvoc_max')::integer,(payload->>'eco2_mean')::numeric,(payload->>'eco2_min')::integer,(payload->>'eco2_max')::integer,(payload->>'aqi_max')::integer,(payload->>'sample_count')::integer)
 on conflict(device_id,minute_start_utc) do nothing;
 update public.devices set last_seen_at=now() where id=target;
 return true;
end; $$;
revoke all on function public.ingest_minute(jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_minute(jsonb,text) to service_role;
