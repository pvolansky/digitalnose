-- Room context is maintained by site owners and shared with site members.
drop policy states_insert on public.site_state_events;
create policy states_insert on public.site_state_events for insert to authenticated
with check(public.is_site_owner(site_id) and user_id=(select auth.uid()));

-- Historical personal entries remain stored, but do not become shared room context.
drop policy states_read on public.site_state_events;
create policy states_read on public.site_state_events for select to authenticated
using(public.is_site_member(site_id) and exists (
  select 1 from public.site_members m
  where m.site_id=site_state_events.site_id and m.user_id=site_state_events.user_id and m.role='owner'
));
