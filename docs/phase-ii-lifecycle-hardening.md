# Phase II lifecycle hardening — local implementation, 20 September 2026

No Pi access, production queries/writes, Supabase changes, deployment, maintenance changes or historical edits were performed for this implementation. Maintenance must remain ON pending a separately authorized deployment and successful third reboot acceptance test.

## Established defects versus initial trigger

The second unattended reboot reproduced the relapse without SSH, queue-status or Pi diagnostics. Those activities are not necessary triggers. The first incident also began before the queue-status commands. The earlier read-only queue-status correction remains useful independently.

Established, high confidence, from source and local reproduction:

1. `collect()` previously put the whole `Acquisition.step()` under one three-second SIGALRM: capacity query, physical measurement, insert/commit, and post-commit stats query. Storage consumed the same budget as hardware.
2. Its storage exception handler called `driver.close()` on QueueFull, SQLite errors and OSError (which includes TimeoutError). Hardware.close clears the adapter and transport. A subsequent measurement reinitializes BME690, restarts SGP41 conditioning, or reopens/restarts SPS30. Contiguous persisted sequences are entirely compatible with pauses and recreation.
3. Hardware cleanup shared the old operation budget, or occurred after its one-shot alarm fired; the logged acquisition duration included recovery. A 5007ms event was not proof of a configured five-second serial timeout.
4. SPS30 treated any nonzero status-register bit as a fault, including reserved bit 20.

Unknown: the original storage disturbance and whether every second-reboot pause was caused by SQLite. Production observation timing alone cannot establish lock ownership, SQLITE_BUSY versus I/O/full-disk error, host scheduling pressure, service restart, or the SPS30 exception's origin. The lifecycle amplification is demonstrated; its application to every production event remains an inference.

## Architecture and deadlines

The acquisition state machine is now:

- **No pending observation:** run capacity preflight outside the sensor alarm. If capacity/storage is unavailable, pause without touching hardware.
- **Acquire:** start a fresh three-second sensor-operation deadline for `driver.read()` only. This includes cadence guarding, MUX selection/initialization and sensor calls. Validate the returned Observation after cancelling that deadline.
- **Hardware error:** create the error observation and use a separate three-second close/recovery deadline. Hardware is lazily recreated on its next read. Returned adapter error observations (including SPS30 status-query errors) also take this path; invalid/warming-up observations do not.
- **Pending:** retain the exact Observation object, original timestamp, readings and metadata. Do not acquire again until it commits. Sequence allocation, identity and payload insertion remain in the existing atomic transaction.
- **Storage error:** retain pending and retry after 0.25, 0.5, 1, 2, 4, then at most 5 seconds per backoff. Attempts continue while the process runs. There is no driver close/reset and no fabricated hardware error observation.
- **Committed:** clear pending immediately after enqueue succeeds, before logging. The fallible post-commit stats query was removed. Resume nominal cadence, skipping missed slots rather than issuing catch-up bursts.
- **Graceful shutdown:** retry pending persistence before closing hardware. Log every failed flush. A forced kill, systemd's existing 20-second stop timeout, or power loss can still lose an uncommitted RAM observation. In-memory retention is not crash durability. Do not intentionally restart a worker while it has unresolved pending-storage errors.

SQLite's existing 2000ms busy timeout bounds each lock wait independently. FULL synchronous commits, DELETE journaling, transaction boundaries, limits, publisher acknowledgement/idempotency and schema remain unchanged. No application SIGALRM surrounds SQLite or database close. A busy timeout cannot bound a stalled filesystem/fsync call; safely imposing hard process cancellation on commit would introduce ambiguous commit outcomes. This patch does not promise hard real-time filesystem cancellation or unlimited offline sampling.

Python executes signal handlers on the main interpreter thread, and delivery may be deferred during a C call. Thus an alarm raised during SQLite can surface later as TimeoutError; pyserial's POSIX read catches OSError, which includes TimeoutError, and can wrap it as SerialException. The new `sensor_deadline_expired` log flag remains true even if a vendor catches/wraps the timeout. Storage can no longer consume that sensor-operation budget. Actual CPU starvation can still cause a true sensor-operation deadline expiry; it is not hidden.

## Structured diagnostics (journal only)

No timing fields were added to canonical observation payloads.

- `acquisition`: status/validity, driver_error, error_domain, sensor_deadline_expired, duration_ms. Hardware supplies cadence_wait_ms, mux_wait_ms, sensor_io_ms.
- `mux_wait_ms`: lock acquisition wait, not the duration holding the lock. MUX selection/deselection stays protected by the same exclusive lock. `sensor_io_ms` includes initialization and the adapter call, including vendor conversion waits. Total duration additionally includes MUX selection/deselection and wrapper work.
- `hardware_recovery`: reason, close_error, recovery_action, recovery_ms. Acquisition timing excludes recovery now.
- `storage_preflight_failed`: operation=capacity and elapsed persistence_ms.
- `persistence_retry`: operation=enqueue, pending_observed_at, attempt count, persistence_ms, SQLite code/name.
- `storage_backpressure`: pending flag, retry count and retry delay.
- `persisted`: sequence, original observation timestamp, attempt persistence_ms, total persistence_wait_ms since acquisition (including backoff/recovery), number of failed attempts. No additional SQLite stats read.
- `storage_initialized` / `storage_initialization_failed`: time spent opening/configuring a queue.
- Publisher `outbox_unavailable` and shutdown-pending events include storage error type/code/name.

Only safe exception classes are logged, not arbitrary vendor messages or secrets. sqlite_errorcode/sqlite_errorname are null on Python versions that do not expose them (notably the local Python 3.9 test interpreter); they are populated when available. Logs must not interpret null as SQLITE_BUSY.

## Startup investigation

Local evidence inspected: both Phase II systemd templates, canonical Phase I collector/database/aggregator/sync and units, plus the archived `pi-running-phase1` snapshot. These are source/configuration evidence, not a current Pi service inventory.

- Both Phase II service templates use `After=local-fs.target time-sync.target network.target`, Type=simple, RestartSec=10 and TimeoutStopSec=20. No dependency serializes the eight workers, and `After=` alone does not prove clock synchronization readiness. There is no explicit 40–60-second startup task in those templates.
- Each sensor uses its own database; acquisition and publisher connections initialize it concurrently. Opening runs PRAGMAs, CREATE IF NOT EXISTS and INSERT OR IGNORE. These can compete within the same file at initial startup. After workers reach healthy operation, initialization does not spontaneously repeat unless a process restarts. That alone does not explain the delayed relapse.
- Phase II uses DELETE journals, not WAL. All four databases still share storage hardware, filesystem journaling, fsync/writeback, CPU and logging. Publisher acknowledgements and acquisition FULL commits can overlap. HTTP itself stays outside write transactions.
- Canonical Phase I uses WAL, five-second collection, aggregation every ten seconds with ten-second grace, and sync polling every ten seconds. The archived older snapshot uses WAL/NORMAL and five-second aggregator polling around UTC minute boundaries. Neither version proves what ran during this reboot.
- WAL automatic checkpoints are normally page-threshold/connection-lifecycle driven, not a fixed 40–60-second boot timer. Periodic aggregation, backlog catch-up, WAL checkpoints or OS services could contribute shared I/O, but no trace proves this. No timer definitions or current OS service inventory are available in the repository. APT/logrotate/filesystem jobs must not be blamed without evidence.

The first exact boot was 15:33:31 UTC and storage errors began around 15:34:25–26 (54–55 seconds later). The second inferred boot interruption spans about 15:46:12–33; its later gap starts around 15:47:16. This supports investigating a delayed shared disturbance but does not identify a timer. No Phase I code, systemd ordering, WAL policy or journal durability setting was changed speculatively.

## SPS30 status 1048576

Inspected the locally cached, pinned `sensirion-uart-sps30==1.0.0` source: `ReadDeviceStatusRegister`, command 0xD2, returns `RxData('>IB')` (32-bit raw status plus reserved byte). `read_device_status_register(False)` does not clear the register and does not translate the bits. This matches the version reported in production observations; the Pi installation was not accessed.

1048576 = 0x00100000 = bit 20. Sensirion's SPS30 datasheet section 4.4 marks bit 20 reserved and says reserved bits may be either value and must be ignored. Its internal meaning is not publicly specified. It is **not** SPEED (bit 21), LASER (bit 5), or FAN (bit 4). The adapter now masks only those documented bits for invalidity, retaining the entire raw register as `acquisition.device_status`. Bit 20 alone preserves warming_up during initial warm-up and allows ok afterwards. Documented warning/error bits still invalidate. Historical records remain untouched.

## Tests

Local only, with temporary databases and fake sensor/HTTP transports:

- Repeated actual SQLITE_BUSY with each healthy BME690/SGP41/SPS30 adapter; same pending object, no extra read, no recreation, no heater-off/serial close.
- Writer reservation failure and COMMIT blocked by a reader; rollback preserves next_seq/counters, retry commits the original exactly once.
- Bounded exponential retries through collect, storage recovery and graceful shutdown flush.
- Preflight failure never calls hardware; no sensor timer is armed during persistence; no post-commit stats query.
- Genuine I2C/serial errors and SPS30 status-query exceptions still persist error observations and recreate only the affected driver.
- Wrapped sensor deadline is identified independently of its SerialException class.
- Separate MUX/sensor timing and reserved/public SPS30 status-bit tests.
- Deterministic 421-second boot simulation: four acquisition workers, four publisher connections, shared outage injected at t=45 through t=52, followed by over six minutes healthy. No synchronized reconditioning, all queues drained, contiguous sequences, database integrity OK.
- Existing separate-process stress: four acquisition + four publisher + four status processes, 160 observations and 400 status reads. HTTP uses a local fake sender only.

Run from repository root:

```sh
python3 -m unittest discover -s edge/raspberry-pi -p 'test_*.py'
node --import tsx --test tests/sensor-*.test.ts tests/sensor-*.test.tsx
```

Final results: **75 Python tests passed** (5.044 seconds), including 12 new lifecycle tests; **15 TypeScript contract/integration tests passed**. Multiprocess stress delivered all 160 observations, performed 400 status reads with no busy failures, and preserved database integrity; maximum status-read time was 5.484ms in the final run. These tests prove recovery policy and persistence invariants, not the Pi's original storage trigger or physical transport reliability.

## Minimal later deployment (NOT executed)

No database/schema/API migration, dependency install or systemd daemon-reload is required. Keep maintenance ON. Deploy only when existing workers have no unresolved pending-storage errors; do not clear queues or reset sequences.

From the canonical Mac repository, after separate deployment authorization:

```sh
ssh diginose@PI_HOST 'mkdir -p /home/diginose/digital-nose/phase2-lifecycle-stage'
rsync -av edge/raspberry-pi/phase2/{runtime.py,drivers.py,bus.py,outbox.py,__main__.py} \
  diginose@PI_HOST:/home/diginose/digital-nose/phase2-lifecycle-stage/
```

On the Pi, only after that authorization:

```sh
set -eu
cd /home/diginose/digital-nose
.venv-phase2/bin/python -m py_compile phase2-lifecycle-stage/*.py
cp -a phase2 "phase2.before-lifecycle-$(date -u +%Y%m%dT%H%M%SZ)"
for sensor in bme690_01 bme690_02 sgp41_01 sps30_01; do
  sudo systemctl stop "digitalnose-sensor-acquire@$sensor.service"
  test "$(systemctl show "digitalnose-sensor-acquire@$sensor.service" -p Result --value)" = success
  test "$(systemctl show "digitalnose-sensor-acquire@$sensor.service" -p ExecMainStatus --value)" = 0
done
for sensor in bme690_01 bme690_02 sgp41_01 sps30_01; do
  sudo systemctl stop "digitalnose-sensor-publish@$sensor.service"
done
cp phase2-lifecycle-stage/{runtime.py,drivers.py,bus.py,outbox.py,__main__.py} phase2/
.venv-phase2/bin/python -m phase2 --config /etc/digitalnose/sensors.json check-config
for sensor in bme690_01 bme690_02 sgp41_01 sps30_01; do
  sudo systemctl start "digitalnose-sensor-acquire@$sensor.service"
  sudo systemctl start "digitalnose-sensor-publish@$sensor.service"
done
```

The stop-result checks intentionally halt if a worker did not stop cleanly. Investigate before copying/restarting; do not force-kill pending observations. This procedure does not copy config/env, service units, requirements, Phase I files or database files. The outbox/__main__ files include the prior local read-only queue-status correction. Rollback, if needed, restores only the backed-up code after cleanly stopping Phase II workers; never restore an old queue database.

## Third reboot acceptance

After separately authorized deployment, first confirm all streams recover normally and preserve maintenance ON. Then authorize one unattended reboot. From another machine, use only production read queries during startup: no SSH, queue-status, sensor-test or Pi SQLite inspection. Record every observation and received_at, sequences, status/error and channel; infer the boundary from the shared gap. Do not delete or relabel history.

Observe initial conditioning separately, then at least ten minutes from resumption and at least five continuous minutes after the last sensor becomes healthy, whichever ends later. PASS requires correct fields/channels, SGP41 compensation from bme690_01, continuous arrivals, no unexpected sequence duplicates/reversals, no post-steady-state warming-up/invalid/error relapse. The full reboot window matters; do not erase a relapse by restarting the acceptance clock. Report expected startup warming-up without classifying it as failure by itself.

Only after that production-only window, and with separate read-only Pi access authorized, retrieve the existing journal sequentially. Correlate storage_operation, SQLite code/name, persistence retries/wait, mux wait, sensor deadline and hardware recovery with uptime/boot ID and service timestamps. Inspect existing timer/service schedules and Phase I logs then; do not run SQLite maintenance or start load-generating probes. A storage retry must have no associated healthy-driver recovery. Unexplained repeated storage errors or long arrival gaps remain an investigation blocker even if hardware now stays open.

## Primary references

- [Sensirion SPS30 1.0.0 API](https://sensirion.github.io/python-uart-sps30/api.html)
- [Sensirion SPS30 datasheet, section 4.4](https://sensirion.com/resource/datasheet/sps30)
- [Python signal execution](https://docs.python.org/3/library/signal.html#execution-of-python-signal-handlers)
- [pyserial 3.5 POSIX read](https://github.com/pyserial/pyserial/blob/v3.5/serial/serialposix.py)
- [SQLite WAL checkpoint behavior](https://www.sqlite.org/wal.html)
