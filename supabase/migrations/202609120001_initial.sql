-- All domain access is explicitly granted; API keys are server-only.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (length(display_name) <= 100),
 created_at timestamptz not null default now()
);
create table public.sites (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 timezone text not null default 'Europe/London', continuous_ventilation boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.site_members (
 site_id uuid not null references public.sites on delete cascade,
 user_id uuid not null references public.profiles on delete cascade,
 role text not null check(role in ('owner','resident')), created_at timestamptz not null default now(),
 primary key(site_id,user_id)
);
create index site_members_user_idx on public.site_members(user_id);
create table public.devices (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites on delete cascade,
 name text not null check(length(name) between 1 and 100),
 device_identifier text not null unique check(device_identifier ~ '^[a-zA-Z0-9_-]{1,64}$'),
 last_seen_at timestamptz, created_at timestamptz not null default now()
);
create index devices_site_idx on public.devices(site_id);
create table public.minute_aggregates (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices on delete cascade,
 minute_start_utc timestamptz not null check(extract(second from minute_start_utc)=0),
 tvoc_mean numeric not null check(tvoc_mean between 0 and 65000),
 tvoc_min integer not null check(tvoc_min between 0 and 65000), tvoc_max integer not null check(tvoc_max between 0 and 65000),
 eco2_mean numeric not null check(eco2_mean between 400 and 65000),
 eco2_min integer not null check(eco2_min between 400 and 65000), eco2_max integer not null check(eco2_max between 400 and 65000),
 aqi_max integer not null check(aqi_max between 1 and 5), sample_count integer not null check(sample_count between 1 and 12),
 created_at timestamptz not null default now(), unique(device_id,minute_start_utc),
 check(tvoc_min <= tvoc_mean and tvoc_mean <= tvoc_max), check(eco2_min <= eco2_mean and eco2_mean <= eco2_max)
);
create table public.smell_reports (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites on delete cascade,
 user_id uuid not null references public.profiles,
 reported_at timestamptz not null default now(), intensity integer not null check(intensity between 1 and 5),
 note text check(length(note)<=1000), smell_type text check(smell_type in ('Restaurant','Cooking','Smoke','Other')),
 created_at timestamptz not null default now()
);
create index reports_site_time_idx on public.smell_reports(site_id,reported_at desc);
create table public.site_state_events (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites on delete cascade,
 user_id uuid references public.profiles,
 event_type text not null check(event_type in ('window_open','user_in_room')), value boolean not null,
 recorded_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index state_site_time_idx on public.site_state_events(site_id,event_type,recorded_at desc);
create table public.device_api_keys (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices on delete cascade,
 key_hash text not null unique check(key_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), revoked_at timestamptz
);
create index keys_device_idx on public.device_api_keys(device_id);

create function public.is_site_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.site_members where site_id=target and user_id=(select auth.uid()));
$$;
create function public.is_site_owner(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.site_members where site_id=target and user_id=(select auth.uid()) and role='owner');
$$;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table public.devices enable row level security;
alter table public.minute_aggregates enable row level security;
alter table public.smell_reports enable row level security;
alter table public.site_state_events enable row level security;
alter table public.device_api_keys enable row level security;
revoke all on public.profiles,public.sites,public.site_members,public.devices,public.minute_aggregates,public.smell_reports,public.site_state_events,public.device_api_keys from anon, authenticated;
grant select on public.profiles,public.sites,public.site_members,public.devices,public.minute_aggregates,public.smell_reports,public.site_state_events to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant update(name,timezone,continuous_ventilation) on public.sites to authenticated;
grant insert(site_id,name,device_identifier),update(name,device_identifier) on public.devices to authenticated;
grant insert(site_id,user_id,intensity,note,smell_type) on public.smell_reports to authenticated;
grant insert(site_id,user_id,event_type,value) on public.site_state_events to authenticated;
grant all on public.profiles,public.sites,public.site_members,public.devices,public.minute_aggregates,public.smell_reports,public.site_state_events,public.device_api_keys to service_role;
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or exists(select 1 from public.site_members sm where sm.user_id=profiles.id and public.is_site_owner(sm.site_id)));
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy sites_read on public.sites for select to authenticated using(public.is_site_member(id));
create policy sites_update on public.sites for update to authenticated using(public.is_site_owner(id)) with check(public.is_site_owner(id));
create policy members_read on public.site_members for select to authenticated using(public.is_site_member(site_id));
create policy devices_read on public.devices for select to authenticated using(public.is_site_member(site_id));
create policy devices_insert on public.devices for insert to authenticated with check(public.is_site_owner(site_id));
create policy devices_update on public.devices for update to authenticated using(public.is_site_owner(site_id)) with check(public.is_site_owner(site_id));
create policy readings_read on public.minute_aggregates for select to authenticated using(exists(select 1 from public.devices d where d.id=device_id and public.is_site_member(d.site_id)));
create policy reports_read on public.smell_reports for select to authenticated using(public.is_site_member(site_id));
create policy reports_insert on public.smell_reports for insert to authenticated with check(public.is_site_member(site_id) and user_id=(select auth.uid()));
create policy states_read on public.site_state_events for select to authenticated using(public.is_site_member(site_id));
create policy states_insert on public.site_state_events for insert to authenticated with check(public.is_site_member(site_id) and user_id=(select auth.uid()));

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',''),100));
 return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.profiles(id,display_name) select id,left(coalesce(raw_user_meta_data->>'display_name',''),100) from auth.users on conflict do nothing;

create function public.create_site(site_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.sites(name) values(trim(site_name)) returning id into result;
 insert into public.site_members(site_id,user_id,role) values(result,auth.uid(),'owner');
 return result;
end; $$;
-- Owners add existing registered residents by email. No user-directory exposure.
create function public.add_resident(target_site uuid, resident_email text) returns void language plpgsql security definer set search_path='' as $$
declare resident uuid;
begin
 if not public.is_site_owner(target_site) then raise exception 'Owner access required'; end if;
 select id into resident from auth.users where lower(email)=lower(trim(resident_email));
 if resident is null then raise exception 'Ask the resident to sign up first, then add their email.'; end if;
 insert into public.site_members(site_id,user_id,role) values(target_site,resident,'resident') on conflict do nothing;
end; $$;
create function public.remove_resident(target_site uuid,resident_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_site_owner(target_site) then raise exception 'Owner access required'; end if;
 delete from public.site_members where site_id=target_site and user_id=resident_id and role='resident';
end; $$;
-- Never allow the browser to read key hashes; owners can rotate/revoke via these narrowly scoped functions.
create function public.rotate_device_key(target_device uuid,new_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.devices where id=target_device and public.is_site_owner(site_id) for update;
 if not found then raise exception 'Owner access required'; end if;
 update public.device_api_keys set revoked_at=now() where device_id=target_device and revoked_at is null;
 insert into public.device_api_keys(device_id,key_hash) values(target_device,new_hash);
end; $$;
create function public.revoke_device_key(target_device uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.devices where id=target_device and public.is_site_owner(site_id) for update;
 if not found then raise exception 'Owner access required'; end if;
 update public.device_api_keys set revoked_at=now() where device_id=target_device and revoked_at is null;
end; $$;
revoke execute on function public.is_site_member(uuid),public.is_site_owner(uuid),public.handle_new_user(),public.create_site(text),public.add_resident(uuid,text),public.remove_resident(uuid,uuid),public.rotate_device_key(uuid,text),public.revoke_device_key(uuid) from public, anon, authenticated;
grant execute on function public.is_site_member(uuid),public.is_site_owner(uuid),public.create_site(text),public.add_resident(uuid,text),public.remove_resident(uuid,uuid),public.rotate_device_key(uuid,text),public.revoke_device_key(uuid) to authenticated;
