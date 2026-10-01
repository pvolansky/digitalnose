begin;
alter table public.capture_sessions drop constraint if exists capture_sessions_intensity_check;
alter table public.capture_sessions add constraint capture_sessions_intensity_check
 check(intensity between 0 and 5);
create or replace function public.request_capture_v2(target_site uuid,target_device uuid,target_configuration uuid,capture_purpose text,capture_odour text,capture_intensity integer,capture_source text,capture_notes text,capture_episode uuid,idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; duration integer; captured_context jsonb;
begin
 if not public.is_site_owner(target_site) then raise exception 'Site owner access required'; end if;
 if capture_purpose not in ('observation','commissioning_test') then raise exception 'Invalid capture purpose'; end if;
 if capture_odour not in ('restaurant_frying_oily','other_odour','no_noticeable_odour','unsure_mixed') then raise exception 'Invalid observed odour'; end if;
 if capture_intensity is not null and (capture_intensity<0 or capture_intensity>5) then raise exception 'Invalid intensity'; end if;
 if capture_episode is not null and not exists(select 1 from public.capture_sessions s where s.site_id=target_site and s.episode_id=capture_episode)
   and exists(select 1 from public.capture_sessions s where s.episode_id=capture_episode) then raise exception 'Invalid episode'; end if;
 select c.duration_seconds into duration from public.capture_configurations c join public.devices d on d.id=c.device_id
 where c.id=target_configuration and c.device_id=target_device and d.site_id=target_site and c.enabled;
 if duration is null then raise exception 'No enabled capture configuration'; end if;
 select jsonb_build_object(
   'continuous_ventilation',s.continuous_ventilation,
   'window_open',(select e.value from public.site_state_events e where e.site_id=target_site and e.event_type='window_open' order by e.recorded_at desc,e.id desc limit 1),
   'resident_in_room',(select e.value from public.site_state_events e where e.site_id=target_site and e.event_type='user_in_room' order by e.recorded_at desc,e.id desc limit 1),
   'captured_at',now()
 ) into captured_context from public.sites s where s.id=target_site;
 select id into result from public.capture_sessions where request_key=idempotency_key;
 if result is not null then return result; end if;
 insert into public.capture_sessions(site_id,device_id,requested_by,configuration_id,request_key,label,intensity,notes,context,requested_duration_seconds,purpose,observed_odour,suspected_source,episode_id)
 values(target_site,target_device,auth.uid(),target_configuration,idempotency_key,'other',capture_intensity,nullif(trim(capture_notes),''),captured_context,duration,capture_purpose,capture_odour,nullif(trim(capture_source),''),capture_episode)
 returning id into result;
 return result;
exception when unique_violation then
 select id into result from public.capture_sessions where request_key=idempotency_key;
 if result is null then raise exception 'A capture is already active for this device'; end if;
 return result;
end $$;
revoke all on function public.request_capture_v2(uuid,uuid,uuid,text,text,integer,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_capture_v2(uuid,uuid,uuid,text,text,integer,text,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
