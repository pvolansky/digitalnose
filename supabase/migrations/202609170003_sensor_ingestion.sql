begin;
create function public.ingest_sensor_observation(payload jsonb,key_digest text) returns text language plpgsql security definer set search_path='' as $$
declare collector uuid; sensor public.sensors; existing public.sensor_observations; observation uuid; seq bigint; derived jsonb;
begin
 select d.id into collector from public.devices d join public.device_api_keys k on k.device_id=d.id
 where d.device_identifier=payload->>'device_identifier' and k.key_hash=key_digest and k.revoked_at is null for share of k;
 if collector is null then return 'unauthorized'; end if;
 select * into sensor from public.sensors where device_id=collector and sensor_key=payload->>'sensor_key' for share;
 if sensor.id is null or not sensor.enabled or sensor.sensor_type<>payload->>'sensor_type' then return 'unknown_sensor'; end if;
 if payload->>'schema_version'<>'1' or (payload->>'observed_at')::timestamptz>now()+interval '1 minute' then raise exception 'Invalid version or future timestamp'; end if;
 if payload->'acquisition' ? 'mux_channel' and payload->'acquisition'->>'mux_channel' is not null
 and (payload->'acquisition'->>'mux_channel')::integer is distinct from sensor.mux_channel then return 'invalid_topology'; end if;
 if (payload->>'valid')::boolean and (payload->'acquisition'->>'gas_valid'='false' or payload->'acquisition'->>'conditioning'='true') then raise exception 'Invalid acquisition validity'; end if;
 seq:=coalesce((payload->>'sequence_number')::bigint,0);
 insert into public.sensor_observations(sensor_id,sensor_type,observed_at,sequence_number,status,valid,readings,acquisition,metadata,error_code,last_error)
 values(sensor.id,sensor.sensor_type,(payload->>'observed_at')::timestamptz,seq,payload->>'status',(payload->>'valid')::boolean,payload->'readings',coalesce(payload->'acquisition','{}'),coalesce(payload->'metadata','{}'),payload->>'error_code',payload->>'last_error')
 on conflict(sensor_id,observed_at,sequence_number) do nothing returning id into observation;
 if observation is null then
  select * into existing from public.sensor_observations where sensor_id=sensor.id and observed_at=(payload->>'observed_at')::timestamptz and sequence_number=seq;
  select jsonb_strip_nulls(to_jsonb(d)-'observation_id') into derived from public.sensor_derived_values d where d.observation_id=existing.id;
  if existing.readings is distinct from payload->'readings' or existing.status is distinct from payload->>'status'
   or existing.valid is distinct from (payload->>'valid')::boolean or existing.acquisition is distinct from coalesce(payload->'acquisition','{}')
   or existing.metadata is distinct from coalesce(payload->'metadata','{}') or existing.error_code is distinct from payload->>'error_code'
   or existing.last_error is distinct from payload->>'last_error' or derived is distinct from payload->'derived' then return 'conflict'; end if;
  return 'duplicate';
 end if;
 if payload ? 'derived' then
  if sensor.sensor_type<>'sgp41' then raise exception 'Derived indices require SGP41'; end if;
  insert into public.sensor_derived_values(observation_id,algorithm,algorithm_version,voc_index,nox_index)
  values(observation,payload->'derived'->>'algorithm',payload->'derived'->>'algorithm_version',(payload->'derived'->>'voc_index')::numeric,(payload->'derived'->>'nox_index')::numeric);
 end if;
 -- Do not update ENS160's device heartbeat from a different sensor's receipt.
 return 'accepted';
end; $$;
revoke all on function public.ingest_sensor_observation(jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_sensor_observation(jsonb,text) to service_role;
commit;
