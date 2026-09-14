-- Allow residents to supply an observation time while retaining membership and identity checks.
grant insert(reported_at) on public.smell_reports to authenticated;
