-- Return only the display name attached to reports visible to the caller.
create function public.report_display_names(report_ids uuid[])
returns table(report_id uuid, display_name text)
language sql stable security definer set search_path='' as $$
  select r.id, nullif(btrim(p.display_name), '')
  from public.smell_reports r
  join public.profiles p on p.id = r.user_id
  where r.id = any(report_ids) and public.is_site_member(r.site_id);
$$;
revoke all on function public.report_display_names(uuid[]) from public, anon;
grant execute on function public.report_display_names(uuid[]) to authenticated;
