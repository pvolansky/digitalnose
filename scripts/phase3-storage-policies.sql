-- Prepared, NOT applied. Bucket was created privately via the dashboard.
-- Apply only during an approved rollout after reviewing uploader account scope.
begin;
do $$ begin
 if not exists(select 1 from storage.buckets where id='digitalnose-raw' and public=false) then
   raise exception 'Create private digitalnose-raw bucket first';
 end if;
end $$;
-- Paths must use the exact canonical raw or immutable-session layout.
-- No UPDATE or DELETE policies: existing objects cannot be overwritten by this role.
create policy phase3_archive_insert on storage.objects for insert to authenticated with check(
 bucket_id='digitalnose-raw' and public.phase3_archive_allowed(name)
);
create policy phase3_archive_read on storage.objects for select to authenticated using(
 bucket_id='digitalnose-raw' and public.phase3_archive_allowed(name)
);
commit;
