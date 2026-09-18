begin;
-- Maintenance uses the existing owner-only room context policies.
alter table public.site_state_events drop constraint site_state_events_event_type_check;
alter table public.site_state_events add constraint site_state_events_event_type_check check (event_type in ('window_open', 'user_in_room', 'maintenance'));
commit;
