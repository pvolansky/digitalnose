# Phase II Supabase rollout — 17 September 2026

## Applied changes

The additive Phase II migrations were applied to the existing Supabase project and verified against the live application. No production data export is included in this repository.

Applied through the authenticated Supabase SQL editor, in order:

- `202609170002_sensor_array`: three new tables, validation, registry and RLS; five registry entries for the single existing DigiNose collector.
- `202609170003_sensor_ingestion`: independently authenticated sensor ingestion with retry handling.
- `202609170004_sensor_queries`: health, bounded charts and original-timestamp inspection.

All three versions/names were recorded in `supabase_migrations.schema_migrations`. The SQL editor execution used the migration DDL plus rollout guards; migrations 003 and 004 shared one transaction. Statements were not populated in the migration-history records. PostgREST schema reload was requested after each committed batch.

Each batch ran in a repeatable-read transaction. Before and after fingerprints of every row in the nine existing application tables matched; existing public function definitions also matched. A failed assertion would have rolled back that batch. These temporary fingerprints remained in the database session and were discarded at commit. They are preservation checks, not a recovery backup. No existing table, policy or function was replaced by these migrations.

No synthetic observations or derived values were inserted. Verified post-rollout: five registry rows, zero sensor observations, zero derived rows, and RLS enabled on all three new tables. Existing ENS160 ingestion and live dashboard updates continued during verification.

## Actual localhost verification

The Phase II Next.js app runs at **http://localhost:3001/dashboard**, connected to this live Supabase project. Port 3000 belonged to the original checkout and was left untouched. Existing environment configuration was loaded into the local process; no secrets were copied into this workspace. No authentication configuration was changed. The browser already had an authenticated localhost session.

Verified in the actual app:

- Authenticated dashboard loads real ENS160 readings, weather, smell reports and existing room/maintenance controls.
- Realtime reports “Live sync connected”; readings and sensor health refresh as genuine ENS160 minutes arrive.
- Existing 24-hour and seven-day views render successfully.
- Sensor registry shows ENS160 LIVE and both BME690s, SGP41 and SPS30 AWAITING DATA.
- Selecting the seven-day ENS160 peak populates shared timestamp inspection, existing context/weather and “No nearby reading” for each unconnected stream.
- No captured browser warnings or errors during these smoke checks.
- An unauthenticated HTTP POST to the actual local `/api/ingest/sensors` route returns 401 with “Invalid device credentials.”

Hosted SQL assertions passed under the authenticated role: the existing owner sees five registry entries, the seven-day sensor chart is empty, and inspection returns four independent empty streams. A nonmember sees no registry or inspection streams. Anonymous health-query execution and authenticated direct ingestion execution are denied. All three migration-history entries exist.

These checks used real Auth/session, PostgREST queries, PostgreSQL RLS and the existing Realtime connection. Production context switches, reports, credentials and sensor observations were not modified for testing. The previous isolated suite remains 68 Node tests plus 3 Python tests, with lint/typecheck/build passing; no application code changed during rollout.

## Refresh stability follow-up

Fixed a client-side refresh issue after rollout: changing the rolling time-window key discarded the displayed sensor data while fetching, temporarily replacing the entire section with a loading panel and resetting plot controls. The sensor section now retains the last successful response, its matching time bounds and mounted controls during background requests. A failed refresh keeps those readings visible with a retry notice; collector changes never reuse another collector's data. The refresh-status area reserves vertical space.

Verified in the live localhost browser across a genuine ENS160 update (20:36 to 20:37 local observation time): the sensor section remained 1436.1640625 pixels high, scroll position remained 3349.5 pixels, the hidden BME series stayed hidden, and environment comparison stayed enabled. An explicit browser reload also loaded successfully. Lint, TypeScript and all 68 tests passed after the change. This verifies the observed live refresh path; it is not an assertion that all possible network/device conditions were simulated.

## Remaining boundaries

- No Git commit/push, public application deployment or Raspberry Pi change was performed. The new HTTP endpoint is running locally; it has not been deployed to the public application.
- New hardware is unconnected; successful new-sensor ingestion, populated charts, real cadence/load and hardware recovery remain to be verified through incremental bring-up. No claim of a completed physical array or production-scale load test is made.
- Migration history already had a gap before this rollout: it recorded only the four initial migrations, although later objects such as weather and maintenance existed. Existing maintenance support was confirmed and not replayed. Audit the older applied schema against migrations `202609120005` through `202609170001` before any future automated `db push`; do not blindly replay them or mark them applied without comparison.
- The localhost app reads the production project. User actions such as reports or context switches would write real production data.
