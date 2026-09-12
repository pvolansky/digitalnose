-- Owners need to identify the residents they manage, without exposing the Auth directory.
create function public.list_site_residents(target_site uuid)
returns table(user_id uuid, role text, display_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_site_owner(target_site) then
    raise exception 'Owner access required';
  end if;
  return query
    select m.user_id, m.role, p.display_name, u.email::text
    from public.site_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.site_id = target_site
    order by m.created_at, m.user_id;
end;
$$;
revoke all on function public.list_site_residents(uuid) from public, anon, authenticated;
grant execute on function public.list_site_residents(uuid) to authenticated;
