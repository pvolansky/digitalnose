# Phase II: multi-sensor telemetry preparation

Local software implementation, not hardware verification. No production migrations, deployment, Git push, Raspberry Pi installation, or fabricated production telemetry were performed.

## 1. Existing architecture

The application uses Next.js 16 App Router, React 19, TypeScript, Supabase Auth/Postgres/Realtime and custom SVG charts. `devices` represents a keyed collector belonging to a site; authenticated members read through site-based RLS. Owner operations use narrowly scoped RPCs.

The reference Pi collector stores ENS160 samples every five seconds in SQLite. A separate aggregator closes UTC minutes after a grace period, retaining TVOC/eCO₂ mean/min/max, maximum AQI and sample count. A durable outbox retries uploads to `/api/ingest`. HMAC-SHA256 device-key authentication, duplicate suppression and heartbeat updates happen through `ingest_minute`. Raw ENS160 samples stay on the Pi. Existing cloud history is minute aggregates and cannot be reconstructed into raw five-second samples.

The dashboard loads paginated minute history, event state before the selected window, smell reports and Open-Meteo context. It uses 6-hour, 24-hour and 7-day presets and custom ranges up to seven days. UTC instants are displayed in the site's timezone. Realtime has a one-minute polling fallback. Existing Inspect a Moment uses a 60-second ENS160 tolerance. No automatic raw deletion was found. Existing uncommitted maintenance changes are preserved.

This audit inspected repository code, not the live database, deployed collector configuration or physical hardware.

## 2. Architectural decisions

Keep existing collector identity, keys, ENS160 storage/ingestion, chart modes, smell reporting and context schemas. Add a `sensors` child registry and one independent `sensor_observations` row per physical sensor observation. A discriminated, database-validated `readings` JSON object contains only that sensor type's named measurements. This avoids a synchronized array row and avoids repeating acquisition/security/query machinery across separate sensor tables.

Optional SGP indices live in a separate `sensor_derived_values` table with algorithm provenance. No model outputs, features, proprietary IAQ dependency, BSEC or AI-Studio are introduced. Heater metadata remains optional. Pressure is consistently Pa. Missing measurements are omitted/null, never filled with zero.

The new per-sensor endpoint reuses collector credentials and validates the sensor's association with that collector. Separate requests and transactions isolate failures. A different sensor's traffic never advances the ENS160 heartbeat.

## 3. Significant files

- `supabase/migrations/202609170002_sensor_array.sql`: registry, observations, derived values, validation, RLS and registry configuration permissions.
- `supabase/migrations/202609170003_sensor_ingestion.sql`: atomic authenticated ingestion and immutable retry handling.
- `supabase/migrations/202609170004_sensor_queries.sql`: health, bounded chart aggregation and original-observation inspection.
- `lib/sensors/contract.ts`: versioned payload types and validation.
- `lib/sensors/ingest.ts`, `app/api/ingest/sensors/route.ts`: bounded request handling, authorization and HTTP responses.
- `lib/sensors/data.ts`: health derivation, dashboard data, nearest queries and research windows.
- `lib/sensors/charts.ts`: measurement labels/units and missing-bucket segmentation.
- `lib/domain/overview.ts`: restored byte-for-byte to the original; new-sensor requests run independently in `LiveSensorAnalysis`.
- `components/sensor-analysis.tsx`: health, separate charts, comparison controls and multi-sensor inspection.
- `components/overview.tsx`, `components/reading-chart.tsx`: shared selected moment and time window; existing ENS160 chart remains in place.
- `app/globals.css`: responsive sensor analysis styling using existing tokens.
- `tests/sensor-schema.test.ts`, `tests/sensor-contract.test.ts`, `tests/sensor-dashboard.test.tsx`: database, endpoint/domain and render tests.
- `package.json`: include TSX component tests in the standard test command.
- `.gitignore`: ignore the local dependency symlink as well as ordinary dependency directories.
- `PHASE-II-PLAN.md`, this document, `docs/phase-ii-bring-up.md`, README and security documentation: plan and handover.

## 4. Migrations and rollout

Apply the repository migration sequence in order after review. The existing `202609170001_maintenance.sql` belongs to the pre-existing work and is retained. The three Phase II migrations are additive and do not alter historical ENS160 rows.

`202609170002_sensor_array.sql` registers five sensors for each existing collector without inserting observations. Future collectors can be registered using the authenticated owner RPC `register_sensor_array(target_device)`, which is idempotent. It is intentionally not an unrestricted browser insert API. Registry configuration can be updated through owner-authorized column grants; sensor identity and collector association are not browser-writable. `updated_at` is maintained by a trigger.

`202609170003_sensor_ingestion.sql` adds the service-only `ingest_sensor_observation` transaction. It validates active collector credentials, registered sensor type and optional mux channel, then inserts an observation and optional derived indices atomically. It does not change `ingest_minute`.

`202609170004_sensor_queries.sql` adds security-invoker functions. Reads retain the caller's RLS. No privileged database client is introduced into dashboard code.

Before production application, back up data, compare migration history with the live project, and review the registry backfill assumption: each existing `devices` entry is an ENS160 collector intended to host this array. Register/configure only the intended collector if the production deployment differs. No production migration was attempted during implementation.

## 5. Exact relevant schema

The SQL migrations are the authoritative schema, including every grant and constraint.

| Table | Columns and types |
| --- | --- |
| `sensors` | `id uuid PK`; `device_id uuid FK devices`; `sensor_key text`; `sensor_type text`; `manufacturer text`; `model text`; `label text`; `location text default room_main`; `connection_type text`; `mux_channel integer nullable`; `enabled boolean default true`; `freshness_seconds integer default 180`; `metadata jsonb default {}`; `created_at, updated_at timestamptz default now()` |
| `sensor_observations` | `id uuid PK`; `sensor_id uuid`; `sensor_type text`; `observed_at timestamptz`; `received_at timestamptz default now()`; `sequence_number bigint default 0`; `status text`; `valid boolean`; `readings jsonb`; `acquisition, metadata jsonb default {}`; `error_code text nullable`; `last_error text nullable` |
| `sensor_derived_values` | `observation_id uuid PK/FK sensor_observations`; `algorithm text`; `algorithm_version text`; `voc_index, nox_index numeric nullable` |

Registry types: `ens160`, `bme690`, `sgp41`, `sps30`. Connection types: `i2c`, `i2c_mux`, `usb`. Mux channels are 0–7 and must be present exactly when connection type is `i2c_mux`. Freshness is configurable from 5–86,400 seconds and is a telemetry timeout, not an air-quality threshold. Registry uniqueness: `(device_id, sensor_key)` and `(id, sensor_type)`.

Observation types exclude ENS160 because its current minute pipeline remains authoritative. Composite FK `(sensor_id, sensor_type)` prevents type mismatch. Observed time must be finite and on/after 2000-01-01; API/RPC reject more than 60 seconds into the future. Sequence is 0–9,007,199,254,740,991. Valid observations require status `ok`. Status values: `ok`, `warming_up`, `invalid`, `error`, `disconnected`. Error code/text limits are 100/500 characters. JSON containers must be objects. Raw fields are validated by `valid_sensor_readings` as well as TypeScript.

Indexes: primary keys; registry unique indexes; observation unique `(sensor_id, observed_at, sequence_number)` for deduplication and time-window/newest queries; partial `(sensor_id, observed_at DESC) WHERE valid` for valid-reading history. No speculative per-measurement indexes.

Raw measurement fields (nullable/omittable except required fields on valid observations):

| Type | Fields | Canonical units |
| --- | --- | --- |
| BME690 | `temperature_c`, `humidity_pct`, `pressure_pa`, **`gas_resistance_ohm`** | °C, % RH, Pa, Ω |
| SGP41 | **`raw_voc_ticks`, `raw_nox_ticks`**, `compensation_temperature_c`, `compensation_humidity_pct` | unsigned 16-bit ticks; °C; % RH |
| SPS30 | **`pm1_ug_m3`, `pm2_5_ug_m3`, `pm4_ug_m3`, `pm10_ug_m3`**; `number_pm0_5_cm3`, `number_pm1_cm3`, `number_pm2_5_cm3`, `number_pm4_cm3`, `number_pm10_cm3`; `typical_particle_size_um` | µg/m³; particles/cm³; µm |

SPS30 number fields mean cumulative particle-size ranges **0.3 µm to the named upper size**, per the official datasheet. They are not counts above that size. SGP raw signals are sensor ticks, not gas concentrations. SPS PM4/PM10 are device-provided outputs; their presence does not imply independent direct measurements of each size bin.

Allowed acquisition keys: `mux_channel`, `heater_profile_id`, `heater_step`, `heater_target_temperature_c`, `heater_duration_ms`, `gas_valid`, `heater_stable`, `measurement_index`, `conditioning`, `device_status`, `error_flags`, `driver_version`, `firmware_version`. They are nullable or omitted when unsupported. Generic metadata can carry non-sensitive experiment/configuration provenance; it must not contain precise location or personal information. These fields do not assert that the eventual driver exposes every value.

## 6. Registry and current hardware

| Key | Hardware state | Role | Connection |
| --- | --- | --- | --- |
| `ens160_01` | Installed / operational per current project brief | Existing TVOC/eCO₂/AQI historical baseline | Direct I²C |
| `bme690_01` | Available / not connected | Primary gas response and default environment | Mux CH0 |
| `bme690_02` | Available / not connected | Independent comparison and future profile experiments | Mux CH1 |
| `sgp41_01` | Available / not connected | Independent VOC/NOx-sensitive raw channel | Mux CH2 |
| `sps30_01` | Ordered / not available | Particulate mass, number and size | Planned USB evaluation interface |

Every key is scoped to its collector. Frontend labels/identities come from the registry. ENS160 displays LIVE only if existing data is fresh; it is not forced live from the hardware description. New sensors initially have no observations and display AWAITING DATA.

```text
Raspberry Pi 5
  +-- DFRobot DFR0566 HAT
  |     +-- ENS160
  |     +-- Gravity -> Qwiic -> TCA9548A
  |                              +-- CH0 BME690 #1
  |                              +-- CH1 BME690 #2
  |                              +-- CH2 SGP41
  +-- USB -> SEK-SPS30 [planned / awaiting hardware]
```

## 7. Ingestion contract

`POST /api/ingest/sensors`, `Content-Type: application/json`, existing `Authorization: Bearer dn_…` collector credential. Maximum request size: 16 KiB, enforced while streaming even without Content-Length. Each request is one sensor observation. Existing ENS160 still uses `/api/ingest` unchanged.

**The following are synthetic schema examples, not genuine measurements. Do not upload them to production.**

```json
{
  "schema_version": 1,
  "device_identifier": "example_collector",
  "sensor_key": "bme690_01",
  "sensor_type": "bme690",
  "observed_at": "2026-09-17T15:42:14.820Z",
  "sequence_number": 120,
  "status": "ok",
  "valid": true,
  "readings": {"gas_resistance_ohm": 124000, "temperature_c": 22.1, "humidity_pct": 48.2, "pressure_pa": 101325},
  "acquisition": {"mux_channel": 0, "gas_valid": true},
  "metadata": {}
}
```

```json
{
  "schema_version": 1,
  "device_identifier": "example_collector",
  "sensor_key": "sgp41_01",
  "sensor_type": "sgp41",
  "observed_at": "2026-09-17T15:42:15.021Z",
  "sequence_number": 121,
  "status": "ok",
  "valid": true,
  "readings": {"raw_voc_ticks": 30000, "raw_nox_ticks": 18000, "compensation_temperature_c": 22.1, "compensation_humidity_pct": 48.2},
  "acquisition": {"mux_channel": 2, "conditioning": false},
  "metadata": {}
}
```

```json
{
  "schema_version": 1,
  "device_identifier": "example_collector",
  "sensor_key": "sps30_01",
  "sensor_type": "sps30",
  "observed_at": "2026-09-17T15:42:15.400Z",
  "sequence_number": 122,
  "status": "ok",
  "valid": true,
  "readings": {"pm1_ug_m3": 2.1, "pm2_5_ug_m3": 2.5, "pm4_ug_m3": 2.7, "pm10_ug_m3": 2.9, "number_pm0_5_cm3": 12, "number_pm1_cm3": 15, "number_pm2_5_cm3": 16, "number_pm4_cm3": 16.2, "number_pm10_cm3": 16.3, "typical_particle_size_um": 0.45},
  "acquisition": {"device_status": 0, "error_flags": 0},
  "metadata": {}
}
```

A structurally valid error/warmup record may have `valid:false`, empty readings and an explicit status/error. Never create a reading of zero to represent a failure. SGP conditioning can preserve VOC while NOx is absent. Invalid/warming records remain queryable in raw research windows but do not populate valid charts or nearest-valid selection.

Optional SGP derived data has shape `{"algorithm":"algorithm-name","algorithm_version":"version","voc_index":100,"nox_index":1}`. It is stored separately and never substitutes for required raw signals.

Validation rejects unsupported versions/types, unknown top-level/raw/acquisition fields, malformed/calendar-invalid/non-UTC timestamps, numeric strings, NaN/Infinity, negative resistance/PM/particle values, humidity outside 0–100%, temperatures below absolute zero, non-integer/out-of-range 16-bit raw ticks and unsafe sequence integers. Metadata cannot exceed eight nesting levels. A technical numeric magnitude bound of 1e100 protects computation; there are no pollution or health cutoffs. Sensor existence, enabled state, collector association and optional mux channel are checked transactionally.

## 8. Failures, retries and health

| Condition | Result |
| --- | --- |
| Missing new hardware | Registry remains present; no observation is generated; awaiting state |
| Recent valid reading | LIVE within configured freshness interval |
| Old observed time despite recent upload | STALE; receipt time cannot make old data current |
| Explicit conditioning | WARMING UP while that acquisition report is fresh |
| Explicit acquisition error/invalid status | ERROR while fresh; diagnostic text retained |
| Explicit disconnected report | DISCONNECTED while fresh; silence alone yields STALE |
| Never received valid data, no acquisition reports | AWAITING DATA |
| One request fails | Other sensors' requests and ENS160 are unaffected |
| Malformed request | HTTP 400; oversize 413; wrong media type 415 |
| Bad/revoked credential | HTTP 401 |
| Unknown/disabled/type-mismatched sensor or incorrect mux | HTTP 422 |
| Exact retry | HTTP 200 with `result: duplicate`, no extra row or new freshness |
| Same identity/time/sequence but changed content | HTTP 409; original observation remains immutable |
| Database/network failure | HTTP 503; collector should retain its outbox record |

Idempotency key: `(sensor_id, observed_at, sequence_number)`. An omitted sequence normalizes to zero. Keep timestamp and sequence unchanged across retries. Hardware counters that wrap are still disambiguated by timestamp. If multiple acquisitions share a timestamp, give them distinct stable sequence numbers. Derived provenance is included in conflict comparison.

New collector drivers/outboxes remain future work: persist independently per sensor; retain unacknowledged records, isolate retries and do not block other sensors behind a failing device.

## 9. Queries and alignment

`LiveSensorAnalysis` independently calls `loadSensorArray` for registry health and chart aggregates using ordinary authenticated clients, with cancellation and a 15-second request timeout. The existing overview loader is unchanged, so a stalled new query cannot block ENS160/context rendering or refresh. Failure produces an explicit sensor-analysis unavailable state without rejecting the ENS160 dashboard. The existing overview time refresh triggers a separate array refresh; no high-frequency raw-observation subscription is added.

`getSensorWindow(db, deviceId, start, end, sensorIds?)` pages each independent stream in stable timestamp/sequence order. It returns original timestamps, identity, validity and metadata with no interpolation. ENS160 is explicitly tagged `minute_aggregates`; new streams are `raw_observations`. Missing streams are empty arrays. `getContextualSensorWindow` adds timeline seeds/reports/weather after checking the collector belongs to the requested site. Windows are limited to seven days; longer research exports should page windows. For frozen training datasets, export against a database snapshot after late uploads have settled.

Dashboard aggregation runs in Postgres with `ceil(window_seconds/360)`-second buckets (minimum one second). Each present sensor/metric bucket preserves mean/min/max/count, original first/last times and the number of heater-setting variants. Results use a JSON response, avoiding the ordinary 1,000-row PostgREST cap. No empty buckets are manufactured. Raw storage is unchanged; scientific analysis must use the raw window, especially when heater settings differ. Database chart aggregation excludes maintenance-overlapping minutes using existing recorded context.

## 10. Dashboard

`SensorAnalysis` adds compact registry-driven health and explicit empty/loading/error states. `SensorPlot` shares selected start/end and moment, uses independent sensor series, min/max marks and separate scales per measurement, and breaks lines across missing buckets.

- BME690 #1/#2 share the gas-resistance chart with individual toggles.
- SGP41 VOC and NOx are separate raw-tick panels.
- SPS30 PM1/2.5/4/10 share the mass chart with series toggles. No empty zero line is drawn.
- Temperature, humidity and pressure use separate panels. Registry metadata selects BME690 #1 by default; comparison can include both sensors.
- Window shading, presence bands and smell markers reuse existing events. Weather remains shared context and appears in inspection, not beneath each new chart.
- Click/tap or keyboard arrows select a shared moment; ENS160 hover/event selection also updates that moment. Responsive SVG geometry follows available width.
- Detailed particle counts and acquisition metadata are expandable in inspection. No new score or thresholds are presented.

## 11. Inspect a Moment

`Overview` owns the selected instant. The existing ENS160 chart and new charts share it. A debounced, race-protected query fetches the nearest valid original observation for each new sensor within **±60 seconds**. Ties prefer the earlier timestamp, then lower sequence. No match returns null and displays **No nearby reading**. Original ISO timestamps and signed second deltas are shown; PostgreSQL retains microseconds, while browser selection/delta arithmetic has millisecond precision.

ENS160 remains an explicitly labelled minute aggregate within its existing 60-second tolerance. Weather uses ±15 minutes. Window/presence are as-of context, smell reports within 60 seconds retain their own timestamps, and maintenance is marked as excluded from interpretation. Registry health describes current acquisition, independently of an old selected window.

## 12. Synthetic data isolation

Test examples live only in `tests/` and disposable local temporary visual fixtures (outside the production app/public tree). The latter are served locally for QA and are not under `app/` or `public/`. Neither the production endpoint nor data loaders import fixtures. There is no fallback to demo observations on errors, no new production seed script, and no migration inserts into observation/derived tables. No production database was connected to during implementation. Synthetic schema examples in this document must not be uploaded.

This isolates application-generated test data. An authorized collector key necessarily trusts its sender's claims; software cannot cryptographically prove a measurement physically occurred. Driver provenance and operational discipline are still required.

## 13–14. Verification

Baseline: 54 existing Node tests, lint/typecheck and three Pi tests passed before changes. Phase II verification runs actual SQL in embedded PostgreSQL (PGlite), including all repository migrations in order, historical ENS160 preservation, registry backfill, RLS and privileges, independent sensor ingestion, exact/conflicting retries, raw validation, bounded aggregates and nearest/null results. Domain/HTTP/render tests cover valid sensor contracts, invalid numerics, request limits, error isolation, health transitions, empty/partial charts, two BME series, PM controls, gaps and loading/unavailable states.

Commands: `npm run check`, `npm run test:pi`, `npm run build -- --webpack`. Webpack is used for the local build because installed dependencies are reused from the existing checkout. The application retains its normal build script. Final results are recorded in `PHASE-II-PLAN.md`.

Local browser checks cover desktop/mobile empty-state layout, populated BME graph, independent series toggle and keyboard timestamp selection using clearly marked synthetic fixtures. Hosted Supabase Auth/Realtime, full authenticated browser ingestion-to-dashboard flows, sustained full-rate query load and physical sensors were not tested. Embedded PostgreSQL validation is not a production migration run.

## 15. Storage estimate

Planning assumptions, not enabled acquisition settings: BME690 #1 and #2 each persist one observation every 5 seconds; SGP41 one every 1 second; SPS30 one every 5 seconds; ENS160 retains one cloud minute aggregate. SGP41 physical measurement/conditioning cadence must follow its official interface even if later upload policy differs. Multi-step heater cycles increase BME row volume by their actual number of observations. Optional derived/error records and acquisition metadata increase storage.

| Stream | Rows/day | Rows/30-day month | Rows/365-day year |
| --- | ---: | ---: | ---: |
| ENS160 cloud aggregates | 1,440 | 43,200 | 525,600 |
| BME690 #1 | 17,280 | 518,400 | 6,307,200 |
| BME690 #2 | 17,280 | 518,400 | 6,307,200 |
| SGP41 | 86,400 | 2,592,000 | 31,536,000 |
| SPS30 | 17,280 | 518,400 | 6,307,200 |
| Total | 139,680 | 4,190,400 | 50,983,200 |

Assuming 1 KiB per new raw row including an approximate index allowance, and 320 bytes per ENS aggregate: approximately **142 MB/day, 4.26 GB/30 days, 51.84 GB/year** (decimal units). These are capacity estimates, not measured Postgres sizes; metadata, indexes, fill factors, WAL, backups, bloat and replicas change actual cost. Pi-local raw ENS160 adds 17,280 rows/day outside this cloud estimate. At one-second SPS30 persistence, total cloud volume becomes 208,800 rows/day. Measure real row/index sizes and query plans after bring-up. No automatic raw pruning is introduced.

## 16. Security

All three tables enable RLS. Anonymous users have no table privileges or query-function execution. Site members can read only their collector's registry/observations/derived data. Owners can register an array and update specified descriptive/topology/freshness columns; they cannot move sensor identity to another collector or edit observations. Only the service role can call ingestion. It validates the collector's active hashed key and child sensor association in the same transaction; raw credentials are never persisted/logged. Fixed search paths and fully qualified names protect security-definer functions. New dashboard query functions are security invoker.

## 17–18. Documentation and official references

This document, the bring-up checklist, README link, security addendum and staged plan describe the extension. Official sources consulted:

- [Bosch BME690 datasheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme690-ds001.pdf).
- [Bosch BME690 SensorAPI data structures](https://github.com/boschsensortec/BME690_SensorAPI/blob/master/bme69x_defs.h): pressure Pa, gas resistance Ω, gas/profile and measurement indices, validity/stability flags. Adapters must normalize the actual selected driver's numeric scaling.
- [Sensirion SGP41 datasheet](https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf): raw 16-bit signals, conditioning and compensation semantics.
- [Sensirion SPS30 datasheet](https://sensirion.com/media/documents/8600FF88/64A3B8D6/Sensirion_PM_Sensors_Datasheet_SPS30.pdf): mass/number units, particle-size ranges, status and interface behavior.
- [Sensirion SPS30 interface definitions](https://github.com/Sensirion/embedded-i2c-sps30/blob/master/sps30_i2c.h): measurement field names. This reference does not select I²C for the planned USB evaluation kit.
- [SparkFun Qwiic mux guide](https://learn.sparkfun.com/tutorials/qwiic-mux-hookup-guide/all): channel isolation and default 0x70 address.

## 19. Assumptions

Existing `devices` are collectors; selected collector owns this five-sensor array. Registry keys are scoped to it. Existing five-second ENS160 cadence is the repository reference, not independently verified running Pi behavior. Freshness starts at 180 seconds and must be configured for validated acquisition/upload cadence. UTC clocks are synchronized; late uploads retain original observation times. New hardware supports only the fields its chosen driver actually returns. No new sensor is currently verified.

## 20. Deliberately deferred

Physical drivers, mux arbitration and USB adapter setup; new Pi outboxes/sampling scheduler; production deployment/migration; sensor calibration; SSM/features/classification; restaurant/no-restaurant labels; generic health scores; heater-profile visualization; raw ENS160 cloud migration; infrastructure such as brokers or distributed pipelines. There is no change to smell-report UX/schema.

## 21–22. Bring-up and remaining work

Follow [the incremental bring-up checklist](phase-ii-bring-up.md). Review/apply migrations and deploy only with permission. Then implement and test each physical acquisition adapter, normalize units, preserve status/provenance, enqueue independent readings, validate credentials and observe genuine delivery. Establish stability, baselines, repeatability, drift, humidity/temperature effects, missing-data behavior and long-running performance before SSM training.

Future SSM must split validation by **event, day or time period**, never randomly by individual rows from the same correlated incident. Preserve sensor identity for ablation experiments (ENS-only, BME-only, BME+SGP, BME+SGP+SPS, full array). Context and weather are features, not labels or definitions of restaurant events. Raw rows remain independent; interpolation and feature engineering must be explicit downstream decisions.


## Follow-up preservation audit

See [the acceptance and preservation audit](phase-ii-audit.md) for the subsequent review, fixes, expanded test coverage and explicit rollout gates. This supersedes the earlier broad statement that all testing was complete: local automated validation is complete; hosted authenticated end-to-end testing, production-scale load validation and physical bring-up are separate outstanding checks.
