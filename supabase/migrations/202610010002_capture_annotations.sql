begin;

alter table public.capture_sessions
 add column purpose text check(purpose in ('observation','commissioning_test')),
 add column observed_odour text check(observed_odour in ('restaurant_frying_oily','other_odour','no_noticeable_odour','unsure_mixed')),
 add column suspected_source text check(length(suspected_source)<=200),
 add column episode_id uuid,
 add column persistence_confirmation text check(persistence_confirmation in ('same_throughout','changed','unsure')),
 add column persistence_confirmed_at timestamptz;

create index capture_sessions_episode on public.capture_sessions(site_id,episode_id,requested_at)
 where episode_id is not null;

create table public.capture_annotations (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.capture_sessions on delete cascade,
 created_by uuid not null references public.profiles,
 kind text not null check(kind in ('smell_changed','smell_gone')),
 observed_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index capture_annotations_session_time on public.capture_annotations(session_id,observed_at,id);

create function public.prevent_capture_annotation_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Capture annotations are immutable';
end $$;
create trigger capture_annotation_immutable before update or delete on public.capture_annotations
 for each row execute function public.prevent_capture_annotation_mutation();

create function public.request_capture_v2(target_site uuid,target_device uuid,target_configuration uuid,capture_purpose text,capture_odour text,capture_intensity integer,capture_source text,capture_notes text,capture_episode uuid,idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; duration integer; captured_context jsonb;
begin
 if not public.is_site_owner(target_site) then raise exception 'Site owner access required'; end if;
 if capture_purpose not in ('observation','commissioning_test') then raise exception 'Invalid capture purpose'; end if;
 if capture_odour not in ('restaurant_frying_oily','other_odour','no_noticeable_odour','unsure_mixed') then raise exception 'Invalid observed odour'; end if;
 if capture_intensity is not null and (capture_intensity<1 or capture_intensity>5) then raise exception 'Invalid intensity'; end if;
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

create function public.add_capture_annotation(target_session uuid,annotation_kind text,annotation_at timestamptz default now())
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if annotation_kind not in ('smell_changed','smell_gone') then raise exception 'Invalid annotation'; end if;
 insert into public.capture_annotations(session_id,created_by,kind,observed_at)
 select s.id,auth.uid(),annotation_kind,annotation_at from public.capture_sessions s
 where s.id=target_session and public.is_site_owner(s.site_id) and s.status in ('preparing','recording')
 returning id into result;
 if result is null then raise exception 'Capture is not active'; end if;
 return result;
end $$;

create function public.confirm_capture_persistence(target_session uuid,confirmation text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if confirmation not in ('same_throughout','changed','unsure') then raise exception 'Invalid confirmation'; end if;
 update public.capture_sessions s set persistence_confirmation=confirmation,persistence_confirmed_at=now()
 where s.id=target_session and public.is_site_owner(s.site_id)
 and s.status in ('completed','cancelled','failed') and s.persistence_confirmation is null;
 if not found then raise exception 'Capture cannot be confirmed'; end if;
end $$;

alter table public.capture_annotations enable row level security;
revoke all on public.capture_annotations from anon,authenticated;
grant select on public.capture_annotations to authenticated;
grant all on public.capture_annotations to service_role;
create policy capture_annotations_read on public.capture_annotations for select to authenticated
 using(exists(select 1 from public.capture_sessions s where s.id=session_id and public.is_site_member(s.site_id)));

revoke all on function public.request_capture_v2(uuid,uuid,uuid,text,text,integer,text,text,uuid,uuid),public.add_capture_annotation(uuid,text,timestamptz),public.confirm_capture_persistence(uuid,text),public.prevent_capture_annotation_mutation() from public,anon,authenticated;
grant execute on function public.request_capture_v2(uuid,uuid,uuid,text,text,integer,text,text,uuid,uuid),public.add_capture_annotation(uuid,text,timestamptz),public.confirm_capture_persistence(uuid,text) to authenticated;

commit;
