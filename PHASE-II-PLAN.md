# Phase II implementation plan

Status: local implementation and validation completed in an isolated copy of the current checkout, including its existing uncommitted changes. On 17 September 2026, the user authorized the three additive Supabase migrations, which were applied and checked using the real authenticated app at localhost:3001. Application deployment, Git push and physical integration remain pending. See `docs/phase-ii-rollout.md`; earlier implementation notes below describe their original checkpoints.

## Boundaries

No Git push, production migration, deployment, production mock insertion, or Raspberry Pi change is included in local implementation. Hardware remains unverified. Preserve existing uncommitted maintenance changes.

## Audit findings

- Next.js 16 App Router, React 19, TypeScript, custom SVG charts, Supabase Auth/Postgres/Realtime.
- Existing `devices` identify keyed collectors belonging to a site. Members read via RLS; owner operations use scoped RPCs. HMAC-hashed bearer keys authorize the service-only `ingest_minute` transaction.
- ENS160 reads every five seconds into SQLite; closed-minute aggregates preserve means/extrema/sample counts and upload through a durable retry outbox. Cloud uniqueness is `(device_id, minute_start_utc)`. Historical raw ENS160 samples remain local; no raw cloud history can be reconstructed from aggregates.
- Dashboard uses 6-hour, 24-hour and 7-day presets, plus custom windows up to seven days, UTC storage and site timezone display. It pages minute history and renders custom SVG charts without server downsampling.
- Context comprises smell reports, window/presence/maintenance events and timestamped Open-Meteo weather. Timeline queries seed state before the window. Inspect a Moment selects ENS160 within 60 seconds. Realtime has a one-minute polling fallback.
- No automatic raw retention/deletion job found. Existing test suite uses Node tests, embedded PostgreSQL (PGlite), and Python SQLite pipeline tests.
- Existing checkout contains uncommitted maintenance UI/domain changes and `202609170001_maintenance.sql`; preserve them.
- Audit covers repository code, not live database state or deployed Pi configuration.

## Smallest proposed extension

Keep `devices`, its keys, ENS160 `minute_aggregates`, current ingestion and existing contextual schemas. Add a child sensor registry and independently timestamped observations for the new sensors. Reuse collector credentials with sensor-to-collector ownership checks. Keep raw observations separate from derived indices, aggregation output and future models.

## Sequential stages and acceptance gates

1. **A–B: Audit and design** — completed initial code audit; verify official sensor field semantics and record concrete design before implementation.
2. **C–E: Database and registry** — additive migrations; register ENS160 and planned sensors without telemetry; typed/validated observation fields, UTC observation/receipt timestamps, validity and acquisition metadata, device/time indexes, retry uniqueness, member-read/service-write RLS. Run migration and isolation tests.
3. **F: Ingestion** — versioned per-sensor payload; strict validation, bounded JSON, existing bearer-key authentication, independent requests, idempotency and explicit error handling. Test valid/invalid/replayed/cross-device requests.
4. **G–H: Queries and health** — paginated raw research windows; bounded server-side chart buckets preserving mean/min/max/count; nearest valid observation queries with documented tolerance; awaiting/warmup/live/stale/error/disconnected semantics driven by evidence.
5. **I–M: Dashboard** — compact registry-driven health; intentional empty/error/loading states; separate BME gas, SGP VOC/NOx, PM mass and environmental plots. Share current time controls and context; retain missing data and gaps.
6. **N: Inspection** — synchronize selected moment and fetch original independent readings, timestamps/deltas, nullable particle details and shared context. Never substitute bucket averages for original observations.
7. **O: Verification** — migration/RLS, validation, failure isolation, health, nearest selection, chart/empty/partial data and ENS160/context regressions; run tests, Pi tests, lint, typecheck and build. Document any validation limitations precisely.
8. **P: Documentation and handover** — schema/API examples explicitly marked synthetic, official references, storage assumptions, privacy-safe topology/status, incremental hardware bring-up, future event/day/time-based SSM validation. Deliver implementation report and remaining operational work.

## Decisions to confirm during implementation

- Canonical BME pressure unit: Pa; SPS mass: µg/m³; particle number: particles/cm³; raw SGP signals: ticks.
- Verify SPS30 cumulative number concentration direction in the official interface rather than copying the brief's `>` labels unchecked.
- Keep cadence configurable. Acquisition cadence and upload cadence are distinct, especially for SGP41 conditioning.
- Derive ENS160 health from real existing telemetry; never hard-code LIVE. Planned sensors stay awaiting until real acquisition evidence exists.
- Preserve raw invalid/warming observations with quality flags where structurally valid; reject malformed values and do not graph them as valid readings.
- Avoid installing drivers, BSEC, AI-Studio, feature/model infrastructure, classification or scores.


## Execution results

- A–B: repository audit and adapted extension design completed before implementation.
- C–E: additive registry, independent raw observations and optional derived-value storage implemented; actual SQL migrations pass in embedded PostgreSQL.
- F: versioned per-sensor endpoint implemented with strict validation, existing collector credentials and transactional retry conflict detection.
- G–H: raw windows, server-side min/max/mean/count buckets, nearest observations and evidence-driven health implemented.
- I–M: registry health, empty/error/loading states, BME/SGP/PM/environment sections and series controls implemented.
- N: shared selected moment, original timestamps/deltas, nearest raw observations and shared context implemented.
- O: 63 Node tests pass, including all 54 baseline tests; 3 Python Pi tests pass; lint, TypeScript and production webpack build pass. Desktop/mobile local fixtures and BME toggle/keyboard selection checked in the browser. Full hosted authenticated end-to-end and physical hardware tests remain unperformed.
- P: implementation/schema/API/security/storage report and incremental hardware checklist written. See `docs/phase-ii.md` and `docs/phase-ii-bring-up.md`.

No Git push, commit, production migration, deployment, production telemetry insertion or hardware-driver installation was performed. The original checkout's source changes were preserved. This workspace began with an empty Git repository, so the isolated copy is an uncommitted working tree rather than a branch of the original repository. Dependencies are reused locally through an ignored symlink; environment secrets were not copied.


## Follow-up audit

The preservation review found and fixed query coupling, duplicate maintenance filtering and an invalid-reading health edge case. The Phase I overview loader is now byte-identical to the baseline; the new section loads independently and follows existing controls/reports. See `docs/phase-ii-audit.md` for the current acceptance matrix, additional tests and unperformed deployment/hardware gates. The earlier 63-test count describes the initial implementation, not this expanded audit.
