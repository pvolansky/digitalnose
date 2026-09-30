# Phase IV — manual labelled captures

Phase IV adds deliberate, confirmed capture sessions for the existing sensor hardware. The two-minute recording duration is an experimental project default, not a Bosch requirement. Phase V will cover a separate physical array for simultaneous profile comparison.

The established ENS160 dashboard remains available unchanged: TVOC, eCO₂, AQI, consolidated view, context bands, smell markers and wind history continue to use the existing minute pipeline. Phase IV stops continuous acquisition for the separate BME690, SGP41 and SPS30 array; their services remain idle between captures while device health, command polling and durable upload recovery continue.

## Capture lifecycle

1. A site owner opens **Start capture**, chooses Smell present, Low odour or Other, optionally records intensity and notes, and reviews the immutable configuration and experimental duration.
2. Closing the dialog creates nothing. Confirmation inserts one idempotent `requested` session. A partial unique index prevents overlap.
3. The Pi polls with its existing device credential and acknowledges `preparing`. The UI does not say recording yet.
4. Preparation and settling samples are stored with those phases. The Pi acknowledges `recording` only when usable acquisition starts.
5. Completion, early cancellation or failure keeps all uploaded measurements. Request, preparation, device start and completion timestamps remain distinct.
6. The Captures page lists outcomes. Detail pages keep heater steps separate, show validity and coverage, expose the immutable configuration, and offer a local raw JSON download.

Low odour is a user label, not proof of clean air. No capture establishes a pollutant concentration, source identity or health safety.

## Configuration status

The current repository driver for BME690 is Pimoroni `bme690` 1.0.0 in forced mode. Configured targets are not measured heater temperatures. Fresh-data gating, gas-valid, heater-stable, selected-profile matching and measurement-index evidence are retained when exposed.

BME690 #1 stays on the fixed project reference of 320 °C for 150 ms. BME690 #2 uses the installed driver's supported heater profile registers 0–4 in explicitly controlled forced-mode measurements: 200, 250, 300, 350 and 400 °C, each for 150 ms. The application selects the next register before every fresh conversion and records the step, cycle, configured target, duration and profile-match validity. This exploratory sequence is named `experimental-200-400C-5step-150ms-v1`; it is not called HP-354 and makes no claim of Bosch BSEC gas classification or validation for frying fumes.

Recording can begin between two heater steps. The cycle identity therefore continues across the preparation boundary: a recording window may contain a leading or trailing partial cycle even when every step has the same number of samples. Partial cycles are retained and never renumbered. Drift is reported per step as session diagnostics only; it cannot distinguish sensor startup from changing air.

SGP41's mandatory first ten seconds use the manufacturer's 25 °C / 50 % RH conditioning inputs. Subsequent preparation and recording commands use the latest measured temperature and relative humidity from BME690 #1, with source and observation time stored per sample. SPS30 preparation follows the existing 30-second readiness gate. Unknown requested, applied or read-back settings are stored as unknown rather than inferred.

## Reversible activation

The live Pi inventory, immutable configuration and commissioning evidence were recorded before activation.

1. Apply `202609300001_manual_captures.sql` and insert one disabled immutable configuration snapshot whose SHA-256 is calculated from canonical JSON.
2. Stage `phase4/`, its service unit and configuration on the Pi. Keep the service disabled.
3. Stop and disable only the separate array acquisition, publisher and Phase III archive workers. Keep `digitalnose.service`, `digitalnose-aggregator.service`, `digitalnose-sync.service` and the Phase III device-health timer running so the standard ENS160 view continues.
4. Verify no array process owns the MUX, I²C sensors or SPS30 serial port. Enable the Phase IV command worker, then enable the reviewed database configuration.
5. Run one neutral **Other** commissioning capture. Verify requested → preparing → recording → completed, measurements/settings association, raw download, local spool drain and no background array publishing.

Rollback: disable `digitalnose-capture.service`, disable the capture configuration, then re-enable the prior array services. The new tables and historical data are additive and remain intact.

No production cutover or database migration should be performed merely by merging the code. Activation requires the live sensor audit and a reviewed configuration snapshot.
