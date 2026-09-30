begin;

alter table public.capture_measurements
 add column sensor_startup_elapsed_seconds double precision
 check(sensor_startup_elapsed_seconds is null or sensor_startup_elapsed_seconds>=0);

create table public.capture_shutdown_outcomes (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.capture_sessions on delete cascade,
 sensor_key text not null,
 attempted boolean not null,
 verified boolean not null,
 recorded_at timestamptz not null,
 readback jsonb not null default '{}' check(jsonb_typeof(readback)='object'),
 error text,
 unique(session_id,sensor_key)
);

create function public.prevent_capture_shutdown_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Capture shutdown evidence is immutable';
end $$;
create trigger capture_shutdown_immutable before update or delete on public.capture_shutdown_outcomes
 for each row execute function public.prevent_capture_shutdown_mutation();

alter table public.capture_shutdown_outcomes enable row level security;
revoke all on public.capture_shutdown_outcomes from anon,authenticated;
grant select on public.capture_shutdown_outcomes to authenticated;
grant all on public.capture_shutdown_outcomes to service_role;
create policy capture_shutdown_read on public.capture_shutdown_outcomes for select to authenticated
 using(exists(select 1 from public.capture_sessions s where s.id=session_id and public.is_site_member(s.site_id)));
revoke all on function public.prevent_capture_shutdown_mutation() from public,anon,authenticated;

commit;
