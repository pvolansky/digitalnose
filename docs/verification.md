# V1 verification and deployment handover

## Local checks

- ESLint and TypeScript checks are run at each implementation phase.
- Node tests execute real schema/ingestion migrations in embedded PostgreSQL and test domain validation.
- Python unittest checks local aggregation/outbox behaviour without requiring sensor hardware.
- `npm run build` creates a production Next.js app.
- Browser checks cover the public demo, measurement selection, context toggles, the short report dialog and centered dialog layout. Mobile CSS is implemented; the in-app browser did not honour the requested viewport override, so physical mobile validation remains part of deployment acceptance.
- Environment files remain Git-ignored; production browser assets are checked for server secrets.

## Hosted setup completed

On 12 September 2026, migrations `202609120001` through `202609120004` were applied to the configured Supabase project in one SQL transaction. All eight domain tables were verified with RLS enabled, and the three live-data tables were verified in `supabase_realtime`. The versions were recorded in Supabase's migration history for future CLI updates.

The hosted Data API successfully exposes the schema to the server credential. Anonymous site reads are denied, and the running ingestion endpoint rejects an unknown device key through the hosted database function. No real resident accounts or sensor data were created by these checks.

Email sign-up and email confirmation are enabled. The local callback `http://localhost:3000/auth/confirm` is saved in the Auth allowlist. Supabase currently requires a custom SMTP configuration before editing the confirmation email template; the default same-browser PKCE confirmation flow is supported by the app.

A Vercel deployment and physical ENS160/Raspberry Pi validation have not been performed. Production Auth origin and SMTP configuration depend on the final deployment domain and mail provider.

## Hosted acceptance walkthrough

1. Apply migrations in order, confirm all eight tables have RLS enabled, and confirm the three data tables are in `supabase_realtime`.
2. Create and confirm owner and resident accounts. Owner creates a site, shares the sign-up URL, and adds the resident email.
3. Add a device and generate a key in Settings. Verify the resident cannot manage devices or members, even when bypassing the UI.
4. Upload a valid closed UTC minute to `/api/ingest`. Retry it and verify only one row exists.
5. Watch the dashboard in a second browser: a new minute, smell report and context change should appear without a page refresh.
6. Create an unrelated user/site and verify it cannot see the first site's records.
7. Rotate/revoke the device key and confirm the old key receives 401. Update the Pi; confirm queued minutes upload.
8. Stop connectivity on the Pi and restore it. Confirm collection continues locally and the outbox catches up without duplicate cloud rows.
9. Check local times across a Europe/London daylight-saving transition, three-minute stale-state signalling and the 7D range beyond Supabase's 1,000-row response limit.

These checks distinguish local code/database validation from hosted integration and hardware acceptance.
