begin;

create table public.capture_quality_flags (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.capture_sessions on delete cascade,
 code text not null check(length(code) between 1 and 100),
 affected_metrics text[] not null,
 details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 recorded_at timestamptz not null default now(),
 unique(session_id,code)
);

create function public.prevent_capture_quality_flag_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Capture quality flags are immutable';
end $$;
create trigger capture_quality_flags_immutable before update or delete on public.capture_quality_flags
 for each row execute function public.prevent_capture_quality_flag_mutation();

alter table public.capture_quality_flags enable row level security;
revoke all on public.capture_quality_flags from anon,authenticated;
grant select on public.capture_quality_flags to authenticated;
grant all on public.capture_quality_flags to service_role;
create policy capture_quality_flags_read on public.capture_quality_flags for select to authenticated
 using(exists(select 1 from public.capture_sessions s where s.id=session_id and public.is_site_member(s.site_id)));
revoke all on function public.prevent_capture_quality_flag_mutation() from public,anon,authenticated;

insert into public.capture_quality_flags(session_id,code,affected_metrics,details)
select distinct m.session_id,'bme690_vendor_compensation_v1',
 array['pressure_pa','humidity_pct','sgp41_humidity_compensation'],
 jsonb_build_object(
   'cause','bme690 1.0.0 decoded par_p5 with calibration byte 10 instead of byte 4 and used par_h1 in the par_h3 humidity term',
   'discovered_at','2026-10-01T01:30:00Z',
   'raw_measurements_changed',false
 )
from public.capture_measurements m
where m.sensor_type='bme690'
on conflict(session_id,code) do nothing;

commit;
