# Phase IV — inspectable sensor response

Implemented and verified locally on 27 September 2026. The chart-only RPC replacement was also applied successfully to the connected Supabase project. No acquisition, drivers, retention, raw writes, thresholds or ML were changed.

## A. Root cause and verified data path

The existing Phase IV audit was used as ground truth, then checked against code and a fresh Pi window: **16:40–17:40 UTC / 17:40–18:40 Europe/London, 27 September 2026**. The table below uses that half-open hour. Raw ranges came from the Pi's persisted observations, independently of summary statistics. Both old and new migrations were executed against those actual summary bodies in local PGlite; the signed-in localhost dashboard then confirmed the new axes and point counts against hosted Supabase.

All requested channels follow persisted sensor readings → `phase3/summary.py::summarize/statistics` (valid-only per-metric n, arithmetic mean, min, max, first/last, Welford m2) → `sensor_minute_summaries.body.metrics` → `sensor_chart_window` → `loadSensorArray` → `SensorAnalysis/SensorPlot` → `preparePlot/chartAxis`.

The RPC uses sample-count-weighted means, minimum of minima, maximum of maxima and summed metric counts. Current 15/30/60-minute detail views use 60-second buckets. Legacy PostgreSQL raw observations remain a fallback only where no summary exists. No browser-side raw Parquet load is introduced.

| Chart | Cause of apparently static response | Source resolution / rounding |
|---|---|---|
| SGP41 VOC and NOx | Zero-based axes compress a small changing signal around large absolute tick values; minute averaging reduces short excursions; normal-only SQL removed otherwise valid minutes. | Integer raw ticks. No additional summary/SQL rounding. |
| BME690 gas #1/#2 | Zero-based axes, different absolute offsets between sensors on one shared axis, minute means, plus real vendor quantization. | Approximately 100 Ω vendor conversion steps. Mean can have fractional Ω; this is averaging, not recovered sensor precision. |
| SPS30 PM1/2.5/4/10 | Minute averaging conceals sampled peaks. Zero is useful here and retained. No filtered minutes occurred in this inspected hour. | Floating-point sensor outputs at the existing 3-second host cadence; no new data rounding. |
| BME690 temperature | Small local range compressed by zero axis and averaged over the minute. | 0.01 °C source resolution. |
| BME690 RH | Small local range compressed by zero axis and minute averaging. | 0.001 %RH source resolution. |
| BME690 pressure | A sub-hPa change around 1,010 hPa was compressed almost entirely by zero axis. | 1 Pa source resolution; display converts all statistics to hPa by dividing by 100. |

All these charts already received min/max; the revised rendering makes them a subtle **observed range**, with the mean as the main line. Tooltip values are formatted to at most two decimal places, and axis labels use step-dependent precision. Calculations and plotted positions retain floating-point values. Neither range bars nor fractional means imply higher hardware resolution.

## B. Files/functions changed

- `lib/sensors/charts.ts`: `displayBucket`, `preparePlot`, `chartAxis`, `axisLabel`, `pointQuality`, `coverageText`, and gap-aware `bucketGroups`.
- `components/sensor-analysis.tsx`: `SensorPlot` axes, modes, range/mean layers, quality styling, tooltips, baseline explanation and half-open visible-window filter; `SensorAnalysis` aggregation caption. Removed the incorrect scheduled-acquisition-pause message.
- `lib/sensors/data.ts`: optional/nullable coverage and internal-gap metadata in `Bucket`.
- `app/globals.css`: mode controls and chart explanation styles.
- `supabase/migrations/202609270002_phase4_chart_quality.sql`: chart RPC only, existing invoker security and execution grants retained.
- `tests/sensor-visualization.test.ts`, `tests/sensor-dashboard.test.tsx`, `tests/phase3-dashboard.test.ts`: axis/baseline/quality/gap and SQL regression coverage.

## C. Exact visualization rules

1. Absolute remains the default. Extent comes from the **full observed min/max of visible series**, never just the means. Hidden series do not set the scale.
2. Set span to the greater of observed extent and a display floor: VOC/NOx 20 ticks; BME gas 1,000 Ω; temperature 0.2 °C; RH 1 %RH; pressure 1 hPa. Fallback floor is 1 display unit (including PM). These are display safeguards, not detection thresholds.
3. Center that span on the extent, add 10% of the span at each end, then round outward to readable ticks selected from 1/2/2.5/5/10 × a power of ten, targeting roughly four intervals. Outward tick rounding can add more padding. Constant or quantized traces therefore do not fill the chart spuriously.
4. Absolute PM includes zero. Other absolute charts do not force zero; nonnegative channels clamp the padded lower bound at zero if reached. Temperature can cross zero. Relative views include zero as the local reference.
5. Gas-only optional modes: Δ = value − baseline; % = 100 × (value − baseline)/baseline. Baseline is the **median of visible bucket means, separately for each sensor/metric**, including partial buckets containing valid observations, with equal weight per bucket. It is not the raw-sample median, a clean-air reference, a rolling detector or a calibration. It updates with the visible window/data. A zero baseline disables percentage mode. Mean/min/max all receive the same transform; stored data is untouched.
6. Thin mean lines and faint vertical observed min–max ranges. Complete points are filled; partial/unknown points are hollow and adjoining segments dashed. Tooltips include mean, extrema, metric sample count, quality, valid sensor readings versus expected readings, cadence-slot coverage where known, and absolute mean/baseline in relative views.
7. No zero filling, forward filling or smoothing. Missing buckets break lines. Explicit internal empty-metric contributions break joining around a wider bucket. Lines between adjacent observed bucket means are visual connections, not extra observations. Buckets beginning exactly at the window end are excluded from rendering to avoid showing the following minute.

## D. SQL / aggregation change

Removed the blanket `health = normal` summary filter. Valid metric statistics survive even when cadence-slot classification is degraded; an empty metric still supplies no plotted value. The summary remains authoritative, so old raw rows cannot disguise a degraded or empty summary. Weighted means/extrema/count formulas, minimum bucket width, maintenance exclusion, RLS and grants stay in place.

Coverage is combined conservatively: unknown inputs remain unknown. Legacy raw fallback now reports unknown coverage rather than pretending its observed count proves 100% coverage. `has_internal_gap` records explicit empty metric contributions in a larger bucket. The migration changes the read function, not stored observations or summary bodies.

In the inspected hour, old filtering removed **10 SGP41 minutes** and **one BME690 #1 minute**, affecting all their corresponding metrics. The new chart shows those valid readings as partial. The other BME and SPS have no such removed minutes. All streams have 60 nonempty summary minutes after this change: these former whole-minute holes were display filtering, while incomplete underlying coverage remains real and visible in tooltips. Regression tests also cover 60 valid records with one missing cadence slot, zero-valid minutes, no raw substitution, maintenance and wider-bucket gaps.

## E. Numerical before/after evidence

Ranges below are in display units; pressure has been converted from raw Pa. BME gas axes are shared by both sensors. Environmental rows are per-sensor axes when viewed alone (the default shows #1); selecting both recomputes their combined extent. PM rows are individual channel views; PM2.5 is the default. Mean range is unchanged before/after in this particular hour even though more intermediate points are retained.

| Sensor / metric | Persisted raw min–max | Minute mean min–max (before = after) | Old axis | New axis | Minutes old → new (partial) |
|---|---:|---:|---:|---:|---:|
| bme690_01 / gas_resistance_ohm | 71,300–84,900 | 72,333.333–83,863.333 | 0–111,348 | 60,000–110,000 | 59 → 60 (1) |
| bme690_01 / humidity_pct | 49.531–52.463 | 49.641–51.918 | 0–56.66 | 49–53 | 59 → 60 (1) |
| bme690_01 / pressure_pa | 1,010.38–1,011.15 | 1,010.421–1,011.098 | 0–1,092.042 | 1,010–1,011.5 | 59 → 60 (1) |
| bme690_01 / temperature_c | 24.2–24.9 | 24.21–24.884 | 0–26.892 | 24–25 | 59 → 60 (1) |
| bme690_02 / gas_resistance_ohm | 82,400–103,100 | 83,920–100,775 | 0–111,348 | 60,000–110,000 | 60 → 60 (0) |
| bme690_02 / humidity_pct | 49.539–52.82 | 50.086–52.379 | 0–57.046 | 49–54 | 60 → 60 (0) |
| bme690_02 / pressure_pa | 1,001.23–1,002 | 1,001.268–1,001.953 | 0–1,082.16 | 1,001–1,002.5 | 60 → 60 (0) |
| bme690_02 / temperature_c | 24.27–24.97 | 24.279–24.96 | 0–26.968 | 24–25.25 | 60 → 60 (0) |
| sgp41_01 / raw_nox_ticks | 17,834–17,955 | 17,847.433–17,941.45 | 0–19,391.4 | 17,800–18,000 | 50 → 60 (10) |
| sgp41_01 / raw_voc_ticks | 31,032–31,290 | 31,061.95–31,267.317 | 0–33,793.2 | 31,000–31,400 | 50 → 60 (10) |
| sps30_01 / pm10_ug_m3 | 3.89–15.282 | 4.487–11.702 | 0–16.505 | 0–20 | 60 → 60 (0) |
| sps30_01 / pm1_ug_m3 | 3.66–14.307 | 4.243–10.957 | 0–15.452 | 0–20 | 60 → 60 (0) |
| sps30_01 / pm2_5_ug_m3 | 3.879–15.197 | 4.487–11.638 | 0–16.413 | 0–20 | 60 → 60 (0) |
| sps30_01 / pm4_ug_m3 | 3.886–15.253 | 4.487–11.68 | 0–16.473 | 0–20 | 60 → 60 (0) |

VOC mean movement occupies about 0.61% of the old Y span, versus 51.34% of the new span. NOx occupies about 0.48% versus 47.01%. Both axes still contain **all observed extrema plus padding**. This demonstrates that SGP41 no longer looks flat solely because the axis begins at zero. It does not demonstrate chemical identification or an odor threshold.

Raw observation counts: BME #1 3,599; BME #2 3,600; SGP41 3,590; SPS30 1,200. The retained minute extrema equal independently measured raw extrema for all tabulated channels. PM2.5's minute mean peaks at 11.638 µg/m³ while the observed range reaches 15.197 µg/m³; the range bars expose that sampled excursion without reconstructing a fictitious 1 Hz trace.

Local evidence files (intentionally ignored by Git): `docs/local-reports/phase-iv-chart-window-20260927.json` (Pi snapshot), `phase-iv-chart-evidence.json` (full-precision comparisons), `validate-chart.ts.txt` (reproduction source; copy to a .ts file in the same directory to run with `node --import tsx`), and `phase-iv-sgp-charts.png` (live localhost view).

Validation: `npm run check` passes lint, TypeScript and 82 tests; `npm run build -- --webpack` succeeds. Browser inspection confirms 60 points per SGP/PM/environment series and 120 combined BME gas points, the numeric axes above, and functioning Absolute/Δ/% controls. VOC baseline in this window is 31,231.1583 ticks; delta axis −300…100 ticks and percentage axis −0.75…0.5%. Returned to Absolute after testing.

## F. Remaining limitations

- Minute statistics preserve sampled amplitude but not within-minute event timing/shape. The existing acquisition cadence, quantization, compensation and conditioning limits still apply.
- Dynamic axes vary between windows; compare numbers/units and use relative modes when comparing sensor response. Shared absolute BME gas axes still reflect their different offsets.
- Equal-weight bucket medians can be influenced by very sparse partial buckets; sample counts and quality remain available. This transparent inspection baseline is not an event or ML baseline.
- SQL still uses minute summaries at window-relative bucket starts. Non-minute-aligned requests can omit the first overlapping summary and include data beyond the end inside the last overlapping summary; exact sub-minute clipping requires raw data. The validation window is minute-aligned. The frontend now excludes the separate bucket starting exactly at the end.
- Gaps within a minute cannot be drawn at individual sample timestamps. Wider RPC buckets flag explicit empty metric summaries but cannot prove all internal outages when summary rows themselves are absent. Current detail charts use one-minute buckets.
- Maintenance still removes any overlapping minute. Unknown legacy raw coverage stays unknown.
- The prior audit's stale raw-based health/nearest-reading cards and raw-only export limitations are unchanged. Headline “awaiting data” can coexist with these summary-backed charts; that is a separate task.
- At initial validation, frontend changes were running on localhost. The hosted chart function was updated directly through Supabase SQL Editor, with the matching migration retained in the repository. Production frontend releases follow the repository's main-branch deployment.
