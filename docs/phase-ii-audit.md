# Phase II acceptance and preservation audit

Update, 17 September 2026: the subsequently authorized Supabase migrations and authenticated localhost smoke tests are recorded in [phase-ii-rollout.md](phase-ii-rollout.md). The audit below records the earlier pre-rollout checkpoint.

## Outcome

Reviewed the original Phase II brief against the implementation and reran local validation. The extension is additive to the existing operational pipeline. Three issues were corrected during the review. Local checks pass; hosted end-to-end validation, production-scale load validation, deployment and hardware bring-up remain separate uncompleted gates.

Nothing was pushed, committed, deployed, installed on the Pi or applied to a production database. No production credentials were copied into the isolated workspace. The browser demonstration remains a synthetic local fixture, not proof of a running multi-sensor production system.

## Preservation evidence

The comparison baseline is the original working checkout, including the uncommitted maintenance work present before Phase II. This is intentionally not just its last Git commit.

- **58 protected source files** are byte-identical. `tests/fixtures/phase-i-preservation.json` records their SHA-256 fingerprints, verified by an automated test. They cover Pi collection/aggregation/outbox code, legacy ingestion, original migrations, authentication/Supabase clients, existing domain/query logic, weather, report/context controls, time controls, realtime and settings actions.
- **The original overview data loader is byte-identical.** New sensor requests now run in their own component, with a 15-second timeout and cancellation. A slow or failed new query cannot hold the existing ENS160/context refresh promise open.
- **The original CSS is preserved as a prefix.** Additional rules use sensor-specific classes.
- **Existing database state is compared before and after applying the new migrations.** Tests compare all existing table rows, column metadata/grants, indexes, constraints, RLS policies and function definitions. They remain identical.
- **New sensor traffic leaves old data unchanged.** The same database snapshot is checked after successful and failed per-sensor requests. The original ENS160 heartbeat and historical data remain unchanged by that traffic.
- **All 54 original tests still pass.** Their source was preserved.

The two existing UI components that need integration are `Overview` and `ReadingChart`: they share a selected timestamp and append the new sensor section **after** the existing controls and recent reports. Their existing measurements, chart modes, time controls and context presentation remain. This is an additive UI integration, not a claim that every frontend file is unchanged.

Other existing file changes are documentation additions, the test command adding TSX tests, and ignoring the local dependency symlink. No dependency versions, environment templates, deployment configuration or production credentials were changed.

## Findings fixed

| Finding | Correction | Evidence |
| --- | --- | --- |
| New sensor queries were awaited by the existing overview loader, allowing a slow new query to delay the old dashboard | Restore the original loader; load the new section independently with cancellation and timeout | Protected-source fingerprint; typecheck/build; review of the separate component lifecycle |
| Client-side maintenance filtering examined bucket start time after SQL had already removed invalid maintenance samples, potentially dropping valid remainder data | Use the database-filtered buckets directly | SQL maintenance-boundary assertion plus component regression test retaining a valid bucket whose start overlaps maintenance |
| A recent `status: ok, valid: false` observation could retain LIVE from an earlier valid observation | Treat the invalid latest acquisition as ERROR while fresh | Explicit health regression test |

The research-window minimum is now consistently one minute, matching the retained ENS160 query contract. Inspection also catches synchronous client-configuration failures and displays an error instead of allowing an uncaught timer exception.

## Plan coverage

| Brief sections / stages | Local result | Remaining verification or execution |
| --- | --- | --- |
| 0–4, A–B: inspect and preserve existing system | Repository and original working changes audited; core pipeline preserved | Compare live migration inventory and actual deployed Pi cadence before rollout |
| 5–7, 9–12, 15, 38–40, C–E: independent raw streams, registry, units, indexes, RLS | Additive sensor registry; per-sensor observations; separate derived indices; three migrations; canonical units; no ENS160 history conversion | Review backfill assumption against intended production collector(s) |
| 8, 31–33, 43, H: timestamps, quality, health and cadence | Original observation/receipt times, microsecond DB preservation, explicit quality/status, configurable freshness, no zero filling | Confirm real clock synchronization, cadence and driver status semantics |
| 13–14, 41, F: validation and failure isolation | Strict per-sensor contract, collector ownership, bounded JSON, independent transactions, exact retries/conflicts and revoked-key handling | Implement future hardware adapters and durable per-sensor Pi queues |
| 27–30, 34–37, G: raw windows and chart aggregation | Paged raw windows, independent streams, shared context, SQL mean/min/max/count, storage estimates | Benchmark sustained real cadence and database query plans in staging |
| 16–23, 25, 37, 42–44, I–M: dashboard | BME comparison, separate SGP channels, PM mass, separate environment units, shared range/context, health and empty/error/loading states | Authenticated browser smoke test against an isolated Supabase deployment |
| 24, N: inspection | Shared selection, nearest original rows, tolerance, timestamp deltas, particle details and context | Hosted browser/network integration; real asynchronous hardware timing |
| 26: synthetic isolation | Tests and temporary local preview only; no production loader imports fixtures; no observation seed migration | Operationally ensure schema examples are never sent with a production key |
| 45, O: testing | Automated tests, original regressions, actual SQL migration/RLS tests and local browser fixture checks pass | Hosted Auth/Realtime/PostgREST end-to-end, production-scale load and hardware soak remain unperformed |
| 46–48, 56, P: docs/report/bring-up | Schema, API, security, volume assumptions, official references, hardware status and incremental checklist documented | Execute approved rollout and incremental physical bring-up later |
| 49–54, 57–58: future science and scope | Stability/baselines, temporal validation splits and sensor ablation documented; no classifier, features, health scoring, BSEC or drivers added | Future experiments and SSM are deliberately outside Phase II software preparation |
| 55: definition of done | Local software implementation/validation satisfied subject to the limits above | Do not equate local completion with production deployment or hardware verification |

## Expanded test evidence

- **68 Node tests pass**, including all original 54.
- **3 Python reference Pi pipeline tests pass**; these are software tests, not physical sensor tests.
- **Lint passes**, **TypeScript passes**, **production webpack build passes**.
- Actual PostgreSQL (PGlite) applies all repository migrations in order.
- An integrated test sends HTTP requests through the production request handler and actual SQL ingestion function. It exercises valid BME690/SGP41/SPS30, an independently failing BME, malformed payloads, duplicate/conflicting raw and derived retries, disabled sensors, cross-collector credentials and revoked keys.
- Owner/resident/stranger checks cover registry configuration and actual populated derived telemetry; anonymous access remains denied.
- A seven-day **10,081-observation** stream is aggregated without the 1,000-row truncation issue, preserving total count and peak within at most 361 buckets per metric. This is a result-bounds test, not a full-rate performance benchmark.
- Raw-window pagination beyond 1,000 rows retains original invalid/null observations and represents absent SPS30 as an empty stream, with no interpolation.
- Maintenance boundaries, partial sensor availability, nearest independent timestamps/microseconds, absent nearby rows, invalid health, empty charts and error/loading states are covered.
- Local browser fixtures were used to check desktop/mobile presentation, toggles and keyboard selection. The subsequent preservation audit changes are covered by automated render/domain/database tests and the production build; no live Supabase browser session was used.

Commands: `npm run check`, `npm run test:pi`, `npm run build -- --webpack`.

## Rollout gates and limits

1. Review changes as a diff against the original working checkout. This workspace started as an empty Git repository and contains an isolated copy, not a branch with inherited history. Before a future push, transfer only reviewed Phase II changes into a proper branch while retaining the original uncommitted maintenance work.
2. Check the live migration inventory and take a verified backup before applying approved migrations. Confirm which existing collectors should receive the planned array registry entries.
3. Apply/test in an isolated Supabase environment first: owner/resident access, the real HTTP route, PostgREST RPC responses, logout/revocation, chart refresh and empty/partial sensor states. PGlite does not reproduce hosted Auth or Realtime services.
4. Run query/load checks at intended raw cadences; verify indexes/query plans and storage capacity. No production-scale performance claim is made.
5. Obtain permission before pushing or deploying. Keep all new physical acquisition disabled until its adapter and incremental hardware checks are complete.
6. Follow `phase-ii-bring-up.md`, adding the mux, BME #1, BME #2, SGP41 and later SPS30 one at a time. Verify existing ENS160 and context functionality after each step.

The supported conclusion is: the existing operational code and database objects have been preserved in local tests, and the additions are ready for review and isolated deployment testing. Production and hardware behavior cannot be guaranteed by a local preview alone.
