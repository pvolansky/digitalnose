# Phase II — acquisition preparation and physical bring-up

Prepared 18 September 2026. Software is implemented and tested locally. No physical hardware has been tested, no Pi installation/service changes were made, and nothing was pushed or deployed. All new acquisition entries and network publishing are disabled by default. The existing HTTP/database contract is unchanged.

## 1. Existing collector architecture

This audit covers the checked-out reference implementation, not an SSH inspection of the running Pi. Its original files remain unchanged:

- `sensor.py` uses `smbus2` directly, checks ENS160 part ID, sets standard mode, reads status/AQI/TVOC/eCO2 registers and rejects warm-up/invalid/error measurements. Despite the PiicoDev board, the reference driver is not the PiicoDev Python library.
- `collector.py` reads once per five-second UTC slot and stores genuine valid results in SQLite. Invalid results leave gaps; uniqueness prevents duplicate slots after restart.
- `aggregator.py` finalizes closed minutes after ten seconds, creates means/extrema/AQI/count, processes at most one hour per pass and skips empty minutes.
- `sync.py` sends minute aggregates to the existing `/api/ingest`. Durable rows retain failed requests; retries use exponential backoff up to one hour and jitter. Requests time out after ten seconds; redirects are refused.
- Three systemd services isolate collection, aggregation and synchronization. The legacy raw database is not pruned. Legacy logs are Python logging; driver/local storage exceptions are handled in the collector, and systemd restarts a process that exits.

The new array is an additive sibling. `ENS160Driver` wraps the legacy driver for isolated diagnostics, but the new raw-observation service rejects ENS160 configuration. ENS160 continues using its existing collector, local tables, aggregation and endpoint.

## 2. Python/runtime environment

The confirmed Pi inventory is:

- Project: `/home/diginose/digital-nose`; this directory is **not a Git repository**.
- Python: **3.13.5**; account: **diginose**, already in **i2c** and **dialout**.
- Existing services: `digitalnose.service`, `digitalnose-aggregator.service`, `digitalnose-sync.service`.
- `/dev/i2c-1`: **0x10** existing DFRobot HAT; **0x53** existing ENS160; **0x70 absent**, expected before connecting TCA9548A.
- Check available disk before installation; per-sensor queue limits still apply.
- New package: `/home/diginose/digital-nose/phase2/`.
- New isolated environment: `/home/diginose/digital-nose/.venv-phase2`.
- New state: `/var/lib/digitalnose/phase2`.

The existing environment and service definitions are retained. Historical Phase I reference installation examples are not the deployment layout for this Pi. `phase2/pi-inventory.sh` rechecks the baseline without reading credentials or probing the bus. Local tests ran under Python 3.9.10; dependency installation and hardware operation under the actual Pi's Python 3.13.5 remain deployment validation gates.

Project naming: **Phase I — FOUNDATION** covers the original ENS160 collector, aggregator, sync, database/dashboard and initial real-world data collection. **Phase II — SENSOR ARRAY** covers the mux, both BMEs, SGP41, SPS30, independent raw acquisition, durable outbox, multi-sensor telemetry and calibration dataset collection. **Phase III — SSM / ML** is future dataset analysis, feature engineering, calibration, restaurant versus not-restaurant modelling, validation and Pi inference.

## 3–6. Selected libraries, evidence and limitations

| Hardware | Selected interface | Verified API and mapping |
| --- | --- | --- |
| BME690 | Pimoroni `bme690==1.0.0` | `get_sensor_data()` fills `data.temperature`, `.humidity`, `.pressure` and `.gas_resistance`. Convert the public pressure value from hPa to Pa by multiplying by 100. Gas is Ω. |
| SGP41 | Adafruit `adafruit-circuitpython-sgp41==1.0.2`, `adafruit-extended-bus==1.0.2` | `measure_raw(humidity=..., temperature=...)` returns VOC and NOx together. Do not read `raw_voc` and `raw_nox` separately: each property starts its own measurement. |
| TCA9548A | Small centralized `smbus2` adapter | Write a one-hot byte `1 << channel`; confirm it by readback, then deselect with zero after the complete operation. |
| SPS30 USB | Optional Sensirion `sensirion-uart-sps30==1.0.0` | `Sps30Device(ShdlcChannel(ShdlcSerialPort(...)))`; start float format `0x0103`; `read_measurement_values_float()` returns all ten fields. |

Official evidence:

- [Pimoroni BME690 source](https://github.com/pimoroni/bme690-python/blob/main/bme690/__init__.py), [constants](https://github.com/pimoroni/bme690-python/blob/main/bme690/constants.py), and [standard example](https://github.com/pimoroni/bme690-python/blob/main/examples/read-all.py).
- [Adafruit SGP41 source](https://github.com/adafruit/Adafruit_CircuitPython_SGP41/blob/main/adafruit_sgp41/sgp41.py) and [conditioning example](https://docs.circuitpython.org/projects/sgp41/en/latest/examples.html).
- [SparkFun Qwiic Mux guide](https://learn.sparkfun.com/tutorials/qwiic-mux-hookup-guide/all).
- [Sensirion SGP41 datasheet](https://sensirion.com/en/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf), including default compensation and conditioning limits.
- [Sensirion SPS30 start-up guidance](https://sensirion.com/media/documents/188A2C3C/6166F165/Sensirion_Particulate_Matter_AppNotes_SPS30_Low_Power_Operation_D1.pdf), recommending 30 seconds before using measurements.
- [Sensirion SPS30 UART example](https://sensirion.github.io/python-uart-sps30/execute-measurements.html) and [API reference](https://sensirion.github.io/python-uart-sps30/api.html).

The released package sources were also downloaded into a temporary local folder and inspected. Pinned packages were installed in a separate temporary local venv; dependency resolution, `pip check`, actual method signatures and imports passed. This is software/API verification, not a Pi or sensor test.

### BME690 initial mode

Both adapters use the vendor example's single standard profile: 320°C target, 150ms duration, profile 0, with the library's default T/P/H oversampling/filter settings. No BSEC, classification, proprietary model or experimental multi-step heater sweep is used.

The released driver exposes `data.status`, `heat_stable`, `gas_index` and `meas_index`. The adapter uses the documented masks for gas validity, maps the reported profile index to `heater_step`, and stores the measurement index. Repeated measurement indices are invalidated. Configured heater targets/durations are labeled as settings, not measured heater temperature. No raw ADC or measured heater-temperature field is invented.

**Pinned-library workaround:** in 1.0.0, `get_power_mode()` returns the whole register and mutates the target used by its caller's polling comparison. Its subsequent ten 10ms new-data polls also provide less time than the standard 150ms heater setting. A narrow subclass bypasses that mode poll and waits 250ms after forced mode (10ms after sleep) before the existing library reads/calibrates the data. The wrapper is unit-tested and was exercised against the actual released base class without hardware. This conservative timing and the resulting plausible values still need physical confirmation; the service bounds a complete driver operation to three seconds. Upstream calibration code is not rewritten.

### SGP41 conditioning and compensation

The adapter issues targeted `heater_off()` at initialization, then conditioning commands at approximately 1Hz for the first ten seconds, with no more than ten conditioning commands. Conditioning always sends the manufacturer-required default inputs, even when fresh BME measurements exist. It stores only genuine returned VOC ticks, with `status=warming_up`, `valid=false`; NOx is absent. After ten seconds it uses one paired raw call each second. Derived indices are not computed.

A read gap above two seconds restarts targeted conditioning. Storage backpressure closes the driver rather than leaving conditioning active while waiting for space. The ten-second conditioning limit and real scheduling must be checked during bring-up; a general-purpose OS is not a hard real-time controller. Valid raw acquisition does not imply that the longer sensor run-in or calibrated gas-response specifications have been reached. The service skips missed schedule slots rather than sending catch-up bursts. It never calls the vendor's general-call reset, which could affect other I2C devices.

Compensation prefers a valid BME690 #1 environmental sample no older than 30 seconds, shared through an atomic local cache. It records the source sensor and source timestamp. Values must fit the SGP41 compensation range; otherwise the driver uses its documented 25°C/50%RH defaults and explicitly labels them as manufacturer defaults, not observations. The fallback is not presented as a measured room condition.

## 7. Mux implementation and failure isolation

`bus.py` owns all channel writes. A cross-process `flock` covers selection, driver initialization, the complete conversion/read and deselection in `finally`. The lock prevents commands from one channel being paired with responses from another. Each sensor also has a lifetime acquisition lock, so diagnostics refuse to compete with its running acquisition worker. There are no downstream scans during the mux diagnostic.

Each acquisition and uploader is a separate systemd process instance. Driver exceptions become that sensor's error observation, and the driver is closed and lazily recreated. HTTP calls never run in acquisition processes. A slow worker waiting for the mux times out; read operations have a deadline. Shared wiring/electrical faults can still affect the physical bus and must be tested. The legacy upstream ENS160 address must remain distinct from downstream device addresses; its existing code does not participate in the new lock, and new downstream devices must not duplicate it.

## 8. SPS30 USB approach

SPS30 stays disabled and its diagnostic refuses to initialize it without `--allow-unavailable-hardware`. Once the kit arrives, identify its actual USB adapter and a stable `/dev/serial/by-id/...` path. The implemented path expects the SPS30 USB-to-UART SHDLC interface at 115200 baud. It is **not** a SEK-SensorBridge I2C driver; if the supplied interface is SensorBridge, choose the appropriate documented transport adapter before enabling anything, without changing the measurement contract.

The driver marks the first 30 seconds as warm-up, retaining available early raw measurements, requests float output, maps the returned tuple in vendor order to all ten existing fields and reads device-status bits without clearing them. Nonzero status is conservatively invalid. If the status query fails after measurement, the raw values are retained with `status=error`. Typical size is µm; particle number is particles/cm³, cumulative 0.3µm-to-upper-size bins. No serial port is guessed or automatically opened.

## 9–10. Code structure and configuration

`edge/raspberry-pi/phase2/` contains:

- `model.py`: observation and existing-contract mapping.
- `drivers.py`: four independent adapters and lazy hardware ownership.
- `bus.py`: inter-process locks and mux selection.
- `outbox.py`: durable payload/sequence storage.
- `publish.py`: bounded HTTPS delivery and retry decisions.
- `runtime.py`: acquisition/publishing loops, diagnostics and environmental cache.
- `config.py`, `__main__.py`: validated JSON config and CLI.
- `sensors.example.json`, `.env.example`, requirements files, service templates and read-only inventory script.

JSON avoids a new YAML dependency. Addresses in JSON are decimal: mux 112 = 0x70; BME 118 = 0x76; SGP 89 = 0x59. Intended channels are CH0 `bme690_01`, CH1 `bme690_02`, CH2 `sgp41_01`. All are initially `enabled: false`; this is intended topology, not verified wiring. Config checks unique channels, supported addresses and the required 1Hz SGP interval. Standard initial BME and SPS intervals are also one second.

API credentials are read from environment only. Publishing additionally requires `DIGITALNOSE_SENSOR_PUBLISH=true`. The URL must be HTTPS and end exactly in `/api/ingest/sensors`, without embedded credentials, query or fragment. **The new public endpoint has not yet been deployed**; Phase II currently runs locally at port 3001. Do not enable Pi publishing against an absent production endpoint or use `localhost` on the Pi to refer to the Mac.

## 11–12. Durable queue, retention and idempotency

Each sensor has a separate SQLite file under `/var/lib/digitalnose/phase2`. The existing ENS160 database is never opened by these workers. Queue identity binds the collector identifier, sensor key and type; reopening under a different identity is rejected.

A single transaction allocates the next sequence and persists canonical UTF-8 JSON bytes. Sequences start at 1, increase per sensor and survive deletion of delivered rows and process restart. The timestamp is captured immediately after the physical read completes, before later publishing, using UTC with six fractional digits. Requests resend the exact stored bytes; retries never read the sensor again or change the timestamp/sequence. The database uniqueness key remains `(sensor_id, observed_at, sequence_number)`.

SQLite uses full synchronous commits and rollback journaling. HTTP happens outside transactions. Accepted/duplicate acknowledgements delete only the corresponding queued row, while the sequence counter remains. A lost acknowledgement is retried unchanged. `409` is quarantined, not mistaken for a successful duplicate. Malformed/permanent 400/413/415/422 responses and redirects are also quarantined. Temporary/network failures retry with exponential delay and jitter; auth/absent-endpoint failures retry hourly. Later eligible rows can progress around a failed row. Quarantined rows are never automatically deleted or altered.

Default limits **per sensor**: 100,000 queued rows, 128MiB of payload and 256MiB main database. Reserve up to twice the main-file cap for rollback journals, plus OS/log space; four new sensors can therefore require roughly 2GiB peak local disk allowance. At 1Hz, the row cap covers about **27.8 hours** of outage per sensor (payload/storage limits may be reached earlier). Size a larger approved budget for longer studies. The database reuses freed pages; its allocated file does not shrink automatically.

When the queue is full, new acquisition pauses before another read; existing undelivered data is retained and a backpressure event is logged. Other sensors keep their own budgets. There will be an explicit unsampled gap after capacity is exhausted. If persistence fails after a read, the observation is held in memory and retried before any further acquisition; a crash or forced shutdown before that commit can still lose this one unpersisted observation. Finite storage cannot guarantee unlimited offline capture. Delivered raw data lives in Supabase; the edge outbox is not a permanent second research archive. Do not delete queue files or reset sequences to recover space.

## 13. Status and logging

Valid result → `ok/true`; heater/conditioning/not-ready → `warming_up/false`; returned invalid data → `invalid/false`; driver exception → `error/false`. No fabricated zeros are used. Malformed non-finite/incorrect results become invalid diagnostics without malformed measurement fields. All adapters emit the existing schema; no database migration was added.

JSON log events include UTC timestamp, sensor identity, channel, duration, status/validity, sequence, queue size, HTTP status and retry state where relevant. Exception classes are logged, not arbitrary exception messages, HTTP bodies, URLs, payloads or secrets. Diagnostics print actual observations to stdout, but do not queue or transmit them.

## 14. Tests and validation

- 29 new Python tests plus the 3 unchanged legacy tests: **32 pass**.
- **69 Node tests pass**, including the preservation fingerprints and a new cross-language test feeding six Python adapter payloads through the unchanged TypeScript validator.
- Post-rename verification: `npm run test:pi` (32 pass), `npm run check` (lint, typecheck and 69 Node tests pass), and `npm run build -- --webpack` (production build passes). The 58-file Phase I fingerprint check passes; all 11 existing top-level Pi files also match the pre-rename hashes. Source and filename scans contain no functional old phase identifiers; Phase III is reserved for the future SSM/ML stage. Python modules compile. Vendor dependency resolution/import/signature checks and `pip check` pass in a temporary local venv.
- Tests cover conversion/units, paired raw SGP, ten-second warm-up, default/measured compensation, gaps, SPS status, mux selection/deselection and exclusion, independent failures, microsecond timestamps, restart-safe sequences, transaction rollback, exact retries, lost acknowledgement replay, HTTP ack validation, redirect refusal, 409 quarantine, temporary/auth failures, malformed data, queue bounds, persistence failure, shutdown/reopen and driver deadlines.

No successful production raw-sensor request was manufactured for testing. Physical detection, cadence, electrical behavior, driver measurements, calibration plausibility, systemd on the Pi and full-array soak remain unverified.

## 15. Exact staged commands

These commands are prepared for a later authorized deployment; **none have been run on the Pi**. Copy only the new package. Do not use Git, replace the existing project, or copy legacy collector files.

### Copy from the Mac — only after deployment approval

Replace `PI_HOST` with the Pi's actual hostname or IP (not yet supplied):

```sh
PI_HOST='REPLACE_WITH_PI_HOSTNAME_OR_IP'
cd /path/to/digital-nose-source
ssh "diginose@$PI_HOST" 'mkdir -p /home/diginose/digital-nose/phase2'
rsync -av --exclude='__pycache__/' --exclude='*.pyc' \
  edge/raspberry-pi/phase2/ \
  "diginose@$PI_HOST:/home/diginose/digital-nose/phase2/"
ssh "diginose@$PI_HOST"
```

The following commands run on the Pi as `diginose`.

### Read-only baseline — with no new wiring

```sh
cd /home/diginose/digital-nose
sh phase2/pi-inventory.sh
systemctl is-active digitalnose.service digitalnose-aggregator.service digitalnose-sync.service
journalctl -u digitalnose.service -u digitalnose-sync.service -n 30 --no-pager
```

Confirm ENS160 is still arriving in the dashboard. The absent 0x70 is expected at this stage; do not run the mux diagnostic before connecting it. Keep environment files and credentials private.

### Prepare isolated runtime, without enabling hardware

Run this block in a subshell so any failed prerequisite stops installation:

```sh
(
set -eu
cd /home/diginose/digital-nose
python3 --version  # Expected Python 3.13.5
python3 -m venv .venv-phase2
.venv-phase2/bin/python -m pip install -r phase2/requirements.txt
.venv-phase2/bin/python -m pip check
.venv-phase2/bin/python -m pip freeze > .venv-phase2/installed-requirements.txt
sudo install -d -o diginose -g "$(id -gn diginose)" -m 700 /var/lib/digitalnose/phase2
sudo mkdir -p /etc/digitalnose
if ! sudo test -e /etc/digitalnose/sensors.json; then
  sudo install -m 644 phase2/sensors.example.json /etc/digitalnose/sensors.json
fi
if ! sudo test -e /etc/digitalnose/sensors.env; then
  sudo install -m 600 phase2/.env.example /etc/digitalnose/sensors.env
fi
.venv-phase2/bin/python -m phase2 --config /etc/digitalnose/sensors.json check-config
sudo systemd-analyze verify "$PWD/phase2/digitalnose-sensor-acquire@.service" "$PWD/phase2/digitalnose-sensor-publish@.service"
sudo install -m 644 phase2/digitalnose-sensor-acquire@.service phase2/digitalnose-sensor-publish@.service /etc/systemd/system/
sudo systemctl daemon-reload
)
```

If `venv` is unavailable, install the OS venv package appropriate to this Python 3.13.5 installation before retrying; do not replace the working interpreter or legacy environment. Keep all sensors disabled and publishing false. Later, use `sudoedit /etc/digitalnose/sensors.env` to set the actual collector identifier and approved endpoint/key. Existing configuration files are preserved on repeat installation. No new user or group membership is needed. No service is enabled, stopped or restarted by the installation block.

The new templates run as `diginose`, using that user's primary group. `ProtectHome=read-only` permits execution from the actual home-directory project while keeping it read-only inside the service; only the new state directory is writable. Existing service units are never installed or edited here.

### One-device diagnostics

After the baseline, power off the Pi before wiring. Connect only the mux at its main/input connector, boot, verify the existing ENS160 path, then:

```sh
sudo -u diginose /home/diginose/digital-nose/.venv-phase2/bin/python -m phase2 sensor-test mux
```

The commands below are separate stages, not a batch to run after wiring everything. Before each new sensor: power off, connect only that next device, boot, and verify ENS160 again. Run from `/home/diginose/digital-nose`:

```sh
sudo -u diginose .venv-phase2/bin/python -m phase2 sensor-test bme690_01 --samples 30
# After BME #1 is verified and BME #2 is separately connected:
sudo -u diginose .venv-phase2/bin/python -m phase2 sensor-test bme690_02 --samples 30
# Only after both BMEs are verified:
sudo -u diginose .venv-phase2/bin/python -m phase2 sensor-test sgp41_01 --samples 30
```

Diagnostics report valid-reading/error totals and exit nonzero if errors occur or no valid readings are obtained. A diagnostic works while its config is disabled, but refuses to contend with that sensor's running acquisition lock. It does not enable a service, use an API key or write production data. First successful BME initialization includes the driver's chip-ID check; SGP initialization checks its serial-number response. Printed addresses/channels identify the configured device. A chip-ID check alone is not proof of a unique board model; check the physical board label and wiring too.

The ENS160 wrapper is optional; do **not** run it concurrently with its collector because initializing the driver changes ENS160 mode. For a later explicitly planned exclusive test:

```sh
sudo systemctl stop digitalnose.service
sudo -u diginose .venv-phase2/bin/python -m phase2 sensor-test ens160_01 --exclusive-ens160 --samples 3
sudo systemctl start digitalnose.service
```

This optional wrapper requires the existing compatible `sensor.py` module to be importable from the project root; do not replace it to satisfy the diagnostic. Restart the collector even if the diagnostic fails. The normal first baseline uses the already-running collector and requires no interruption.

### Enable only the individually verified sensor

After its genuine diagnostic passes, set only that sensor's `enabled` to true in `/etc/digitalnose/sensors.json`. Copy the correct collector identifier into `sensors.env`. Then, for BME #1 alone:

```sh
sudo systemctl enable --now digitalnose-sensor-acquire@bme690_01
sudo journalctl -u digitalnose-sensor-acquire@bme690_01 -f
```

Acquisition buffers locally while publishing remains off. **Do not leave it unattended until its queue budget and disk allowance are checked.** After the separately approved public endpoint deployment, verify its URL, configure the existing device key and set `DIGITALNOSE_SENSOR_PUBLISH=true`. Then enable just its uploader:

```sh
sudo systemctl enable --now digitalnose-sensor-publish@bme690_01
sudo journalctl -u digitalnose-sensor-publish@bme690_01 -f
```

Verify real observations in the database/dashboard, then repeat individually for BME #2 and SGP41. For SGP41, keep a verified BME acquisition running to supply fresh compensation; otherwise the diagnostic explicitly reports manufacturer defaults. Shutdown signals stop scheduling, finish bounded work and close driver/database handles. Services use `Restart=on-failure`, ten-second restart delay and twenty-second stop timeout; network failure stays inside the uploader retry loop.

### SPS30 only after arrival

Identify the actual kit's adapter first. With the intended SHDLC USB cable, set its stable serial path in config, install the optional package, then run only its diagnostic:

```sh
.venv-phase2/bin/python -m pip install -r phase2/requirements-sps30.txt
ls -l /dev/serial/by-id/
sudo -u diginose .venv-phase2/bin/python -m phase2 sensor-test sps30_01 --allow-unavailable-hardware --samples 45
```

Keep it disabled until that test passes. Full-array soak is last: check genuine database delivery, mux errors, missed slots, clock drift, queue growth, reboot/retry, CPU/disk usage and BME agreement while confirming ENS160 remains unaffected.

## 16–19. Files, dependencies, installation and privilege impact

New files: `PHASE-II-ACQUISITION-PLAN.md`, this report, `edge/raspberry-pi/phase2/` (Python modules, config, service templates, dependency files, inventory script and `.env.example`), `edge/raspberry-pi/test_phase2.py`, and `tests/sensor-python-contract.test.ts`. `.gitignore` adds `.venv-phase2/`. No existing ENS160 source/service/requirements file, API contract or database migration was changed.

Direct Phase II dependencies: existing `smbus2==0.5.0`, new `bme690==1.0.0`, `adafruit-circuitpython-sgp41==1.0.2` and `adafruit-extended-bus==1.0.2`. Optional SPS30: `sensirion-uart-sps30==1.0.0`. Blinka/busdevice and Sensirion transport/support libraries are transitive dependencies. The local resolver selected Sensirion SHDLC 0.1.5 and driver-adapters 2.3.1 to satisfy SPS30's requirements; do not independently force the newest SHDLC major version. Direct dependencies are pinned; a platform-specific transitive freeze should be recorded after successful installation on the actual Pi.

Nothing must be installed into the legacy venv. Pi installation may need the OS `python3-venv` package if absent. Do not run vendor install scripts that replace environments or enable unrelated interfaces. I2C is already used by ENS160; do not toggle/reconfigure it without checking the baseline. Linux device permissions and Pi 5/Blinka compatibility must be verified on that machine.

`sudo` is needed only for OS package installation if required, `/etc` files, state-directory ownership, systemd unit installation/control and safe power-off. Ordinary venv package installation does not require sudo if the deployment account owns the code directory. No software reboot is inherently required by this code; power-off/boot cycles are required for staged physical wiring.

## 20. Exact first hardware step

**Do not connect a new sensor yet.** Run the read-only baseline commands and confirm the running ENS160 still uploads. Once the supplied Pi baseline is rechecked and the prepared diagnostics are installed, the first physical change is: power off, connect only the TCA9548A input to the intended HAT/Qwiic path, power on, verify ENS160, and run `sensor-test mux`. CH0/CH1/CH2 remain intended mappings until individually tested.
