begin;

create table public.capture_configurations (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices on delete cascade,
 version text not null check(length(version) between 1 and 100),
 config_hash text not null check(config_hash ~ '^[0-9a-f]{64}$'),
 duration_seconds integer not null default 120 check(duration_seconds between 30 and 1800),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 enabled boolean not null default false,
 created_at timestamptz not null default now(),
 unique(device_id,config_hash)
);
create unique index capture_one_enabled_config on public.capture_configurations(device_id) where enabled;

create table public.capture_sessions (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites on delete cascade,
 device_id uuid not null references public.devices on delete restrict,
 requested_by uuid not null references public.profiles,
 configuration_id uuid not null references public.capture_configurations on delete restrict,
 request_key uuid not null unique,
 label text not null check(label in ('smell_present','low_odour','other')),
 intensity integer check(intensity between 1 and 5),
 notes text check(length(notes)<=1000),
 context jsonb not null default '{}' check(jsonb_typeof(context)='object'),
 requested_duration_seconds integer not null check(requested_duration_seconds between 30 and 1800),
 status text not null default 'requested' check(status in ('requested','preparing','recording','completed','cancelled','failed')),
 requested_at timestamptz not null default now(),
 device_preparing_at timestamptz,
 device_started_at timestamptz,
 completed_at timestamptz,
 stop_requested_at timestamptz,
 stopped_early boolean not null default false,
 failure_code text,
 unique(id,configuration_id),
 check(device_preparing_at is null or device_preparing_at>=requested_at),
 check(device_started_at is null or device_started_at>=coalesce(device_preparing_at,requested_at)),
 check(completed_at is null or completed_at>=coalesce(device_started_at,requested_at))
);
create unique index capture_one_active_per_device on public.capture_sessions(device_id)
 where status in ('requested','preparing','recording');
create index capture_sessions_site_time on public.capture_sessions(site_id,requested_at desc);

create table public.capture_measurements (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.capture_sessions on delete cascade,
 configuration_id uuid not null references public.capture_configurations on delete restrict,
 sensor_id uuid not null references public.sensors on delete restrict,
 sensor_key text not null,
 sensor_type text not null,
 acquired_at timestamptz not null,
 received_at timestamptz not null default now(),
 sequence_number bigint not null check(sequence_number>=0),
 phase text not null check(phase in ('preparing','settling','recording','recovery')),
 scan_cycle_index integer check(scan_cycle_index>=0),
 heater_step_index integer check(heater_step_index>=0),
 readings jsonb not null check(jsonb_typeof(readings)='object'),
 units jsonb not null check(jsonb_typeof(units)='object'),
 validity jsonb not null check(jsonb_typeof(validity)='object'),
 applied_settings jsonb not null check(jsonb_typeof(applied_settings)='object'),
 unique(session_id,sensor_key,sequence_number),
 foreign key(session_id,configuration_id) references public.capture_sessions(id,configuration_id) on delete cascade
);
create index capture_measurements_session_time on public.capture_measurements(session_id,acquired_at);

create function public.prevent_capture_configuration_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 if old.device_id is distinct from new.device_id or old.version is distinct from new.version
 or old.config_hash is distinct from new.config_hash or old.duration_seconds is distinct from new.duration_seconds
 or old.snapshot is distinct from new.snapshot then raise exception 'Capture configuration snapshots are immutable'; end if;
 return new;
end $$;
create trigger capture_configuration_immutable before update on public.capture_configurations
 for each row execute function public.prevent_capture_configuration_mutation();

create function public.prevent_capture_measurement_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Capture measurements are immutable';
end $$;
create trigger capture_measurement_immutable before update or delete on public.capture_measurements
 for each row execute function public.prevent_capture_measurement_mutation();

create function public.validate_capture_transition() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status= new.status then return new; end if;
 if not ((old.status='requested' and new.status in ('preparing','cancelled','failed'))
   or (old.status='preparing' and new.status in ('recording','cancelled','failed'))
   or (old.status='recording' and new.status in ('completed','cancelled','failed'))) then
  raise exception 'Invalid capture status transition from % to %',old.status,new.status;
 end if;
 return new;
end $$;
create trigger capture_status_transition before update of status on public.capture_sessions
 for each row execute function public.validate_capture_transition();

create function public.request_capture(target_site uuid,target_device uuid,target_configuration uuid,capture_label text,capture_intensity integer,capture_notes text,idempotency_key uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; duration integer; captured_context jsonb;
begin
 if not public.is_site_owner(target_site) then raise exception 'Site owner access required'; end if;
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
 insert into public.capture_sessions(site_id,device_id,requested_by,configuration_id,request_key,label,intensity,notes,context,requested_duration_seconds)
 values(target_site,target_device,auth.uid(),target_configuration,idempotency_key,capture_label,capture_intensity,nullif(trim(capture_notes),''),captured_context,duration)
 returning id into result;
 return result;
exception when unique_violation then
 select id into result from public.capture_sessions where request_key=idempotency_key;
 if result is null then raise exception 'A capture is already active for this device'; end if;
 return result;
end $$;

create function public.stop_capture(target_session uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.capture_sessions s set
  stop_requested_at=now(),
  status=case when s.status='requested' then 'cancelled' else s.status end,
  completed_at=case when s.status='requested' then now() else s.completed_at end,
  stopped_early=true
 where s.id=target_session and public.is_site_owner(s.site_id) and s.status in ('requested','preparing','recording');
 if not found then raise exception 'Capture cannot be stopped'; end if;
end $$;

alter table public.capture_configurations enable row level security;
alter table public.capture_sessions enable row level security;
alter table public.capture_measurements enable row level security;
revoke all on public.capture_configurations,public.capture_sessions,public.capture_measurements from anon,authenticated;
grant select on public.capture_configurations,public.capture_sessions,public.capture_measurements to authenticated;
grant all on public.capture_configurations,public.capture_sessions,public.capture_measurements to service_role;
create policy capture_configs_read on public.capture_configurations for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and public.is_site_member(d.site_id)));
create policy capture_sessions_read on public.capture_sessions for select to authenticated using(public.is_site_member(site_id));
create policy capture_measurements_read on public.capture_measurements for select to authenticated using(exists(select 1 from public.capture_sessions s where s.id=session_id and public.is_site_member(s.site_id)));
revoke all on function public.request_capture(uuid,uuid,uuid,text,integer,text,uuid),public.stop_capture(uuid),public.prevent_capture_configuration_mutation(),public.prevent_capture_measurement_mutation(),public.validate_capture_transition() from public,anon,authenticated;
grant execute on function public.request_capture(uuid,uuid,uuid,text,integer,text,uuid),public.stop_capture(uuid) to authenticated;

commit;
