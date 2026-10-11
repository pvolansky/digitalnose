-- Backfill owner-confirmed window events using their actual Europe/London occurrence times.
-- Preserve the original occurrence in both timestamps when the event is entered retrospectively.
with requested(value, occurred_at) as (
  values
    (true,  timestamptz '2026-10-06 10:28:42 Europe/London'),
    (false, timestamptz '2026-10-07 00:36:11 Europe/London'),
    (true,  timestamptz '2026-10-07 11:27:45 Europe/London'),
    (false, timestamptz '2026-10-08 01:47:24 Europe/London'),
    (true,  timestamptz '2026-10-08 08:24:05 Europe/London'),
    (false, timestamptz '2026-10-08 23:23:50 Europe/London'),
    (true,  timestamptz '2026-10-11 10:13:29 Europe/London')
), owner as (
  select m.user_id
  from public.site_members m
  where m.site_id = 'a2a1cb00-e7b6-4143-bcc7-5c4f0b39c863'
    and m.role = 'owner'
  order by m.created_at, m.user_id
  limit 1
)
insert into public.site_state_events (
  site_id,
  user_id,
  event_type,
  value,
  recorded_at,
  created_at
)
select
  'a2a1cb00-e7b6-4143-bcc7-5c4f0b39c863',
  owner.user_id,
  'window_open',
  requested.value,
  requested.occurred_at,
  requested.occurred_at
from requested
cross join owner
where not exists (
  select 1
  from public.site_state_events existing
  where existing.site_id = 'a2a1cb00-e7b6-4143-bcc7-5c4f0b39c863'
    and existing.event_type = 'window_open'
    and existing.value = requested.value
    and existing.recorded_at = requested.occurred_at
);
