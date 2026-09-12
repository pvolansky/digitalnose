# Security model

## Trust boundaries

Browser users authenticate through Supabase Auth. Server Components and server actions use the user's cookie-backed Supabase client, so the database remains the authorization boundary. The cookie refresh proxy validates with `getUser`; protected server pages repeat that validation. Authenticated responses are private/no-store. Next.js performs server-action origin validation.

The device endpoint has no browser session dependency. It accepts a 256-bit random device key (`dn_` prefix), computes HMAC-SHA256 with a server-only pepper, and invokes a service-only database function. That transaction resolves the device and active key together, ignores duplicate device/minute pairs and records the receipt heartbeat. A revoked key cannot ingest another minute. Raw keys are never stored in Postgres, request logs, the repository or browser bundles. The one-time settings response is intentionally visible only to the authenticated owner generating it.

`SUPABASE_SERVICE_ROLE_KEY` is a compatibility environment name that accepts the project's newer `sb_secret_` key. It bypasses RLS, so the privileged client is confined to the ingestion route and opt-in seed script. It is not used for normal resident or owner operations. API keys do not grant Supabase database migration access.

## Database permissions

| Entity            | Authenticated reads                                   | Writes                                                                         |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| profiles          | Own profile; site owners can see their members' names | Own display name only                                                          |
| sites             | Members only                                          | Creator uses atomic RPC; owner updates metadata                                |
| site_members      | Same-site members                                     | Owner-only RPC to add/remove residents; owners cannot be removed through V1    |
| devices           | Same-site members                                     | Owner inserts/updates metadata; site ID and heartbeat are not browser-writable |
| minute_aggregates | Same-site members through device membership           | Service-only ingest function                                                   |
| smell_reports     | Same-site members                                     | Member inserts, user ID must match session; timestamp assigned by database     |
| site_state_events | Same-site members                                     | Member inserts their own events; timestamp assigned by database                |
| device_api_keys   | No browser reads                                      | Owner-only rotation/revocation RPC; only hashes stored                         |

All eight tables have RLS enabled. Anonymous roles have no table privileges. Security-definer functions fix `search_path` and explicitly qualify referenced tables/functions. Helper functions avoid recursive membership policies. Membership RPCs check the calling owner and do not reveal a general user directory. The owner-only resident directory exposes emails only for that owner’s site members so they can identify accounts to manage. Table column grants prevent spoofed timestamps, cross-site device moves and browser-side heartbeat changes.

Profile records are created by a trigger on `auth.users`, and existing Auth users are backfilled by the migration. Site creation and the first owner membership happen in a single transaction. No public self-assignment of membership is possible.

## Operational details

- Keep `.env` ignored and restricted locally; supply secrets through deployment environment settings.
- Keep the device pepper stable. If it changes, generate replacement keys for all devices and update their Pi configurations.
- Do not give the Raspberry Pi a Supabase service/secret key. Its device key grants ingestion for one device only.
- Use HTTPS. The reference sync client refuses redirects and does not log credentials or response bodies.
- Run migrations before live use. Configure production Auth SMTP and allowed redirect origins.
- Back up Supabase data and the Pi SQLite file; raw data retention is intentionally a deployment policy, not a hidden deletion job.
- A removed resident loses database read/write access immediately. Data already rendered in a browser cannot be recalled; the next refresh removes access.
- Validate deployed Realtime and email confirmation with real accounts; embedded database tests cannot reproduce hosted Auth/Realtime infrastructure.

## Verification coverage

`tests/schema.test.ts` executes the real schema in PostgreSQL (PGlite), creates owner/resident/stranger roles, and verifies membership visibility, forged-author rejection, device/key restrictions, owner preservation, revoked keys, cross-site sensor isolation and duplicate ingestion. TypeScript tests exercise payload limits, numeric validation, UTC timestamps, chart gaps and per-user occupancy. Pi tests cover incomplete minutes, long gaps, retries after lost acknowledgements and bounded batches.
