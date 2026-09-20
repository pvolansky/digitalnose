# Phase II storage contention investigation — 20 September 2026

Historical first-investigation record. The second unattended reboot disproved queue-status as a necessary trigger. The subsequent local lifecycle implementation and updated acceptance procedure are in [Phase II lifecycle hardening](phase-ii-lifecycle-hardening.md); they supersede the recommendations below marked unimplemented.

Scope: local source review, temporary local SQLite databases, simulated sensor/HTTP I/O, and an existing local vendor environment. No Pi, production, Supabase or historical observation changes. The user's incident timestamps are evidence supplied by the operator, not newly collected host traces.

## Finding and confidence

High confidence: the old `queue-status` path is incorrectly write-capable, and acquisition couples storage failure to hardware teardown. Both are reproduced locally. Moderate confidence: shared storage/scheduling pressure plus per-database locking initiated or amplified this incident. Low-to-moderate confidence in a specific explanation of the SPS30 failure; production error classes do not identify the failing operation or original exception cause.

The first publisher/outbox OperationalErrors at 16:34:25–26 BST precede the four status commands at 16:34:29. SPS30 storage_backpressure at 16:34:28 also precedes them. Therefore those commands cannot be the sole initiating cause. They are a credible amplifier of already-existing contention, not proven necessary or sufficient to explain the complete incident. `OperationalError` alone also does not prove SQLITE_BUSY: the current log omits SQLite error codes and operation phases.

## Connection and transaction audit

`state_path()` produces one database per key: `/var/lib/digitalnose/phase2/<sensor_key>.sqlite3`. Within each file, acquisition and publishing have separate connections. They use a two-second connect/busy timeout, `journal_mode=DELETE`, `synchronous=FULL`, rollback journals and normal locking. FULL remains unchanged.

The writable constructor performs directory creation, PRAGMA configuration, page-cap configuration, schema/index initialization, and an `INSERT OR IGNORE` identity transaction. Even when the identity already exists, this SQL is a write statement that competes for the database's writer reservation. Before this patch, every queue-status invocation ran that constructor. It could also create an absent queue. There is no acquisition/publisher singleton lock protecting a status invocation from those workers.

Acquisition starts `BEGIN IMMEDIATE`, reads identity/counters, serializes the observation, inserts the immutable body, updates counters/sequence and commits. That lock covers serialization and commit/fsync. Publishing reads one eligible body, performs HTTP **outside** any database transaction, and then commits either acknowledgement/deletion/counter updates or retry metadata. No HTTP request deliberately holds a write transaction. Transactions are small in SQL scope, but their wall time is not bounded independently of lock waits and disk scheduling. The two-second busy timeout is a lock-wait setting, not a bound on all I/O or the whole acquisition operation.

SQLite locks are per database. BME01 does not directly lock SGP41's file. Nevertheless all workers share CPU, storage, filesystem journal/cache/writeback and logging. Slower commits lengthen each file's own lock occupancy. Several processes launching together or waking from the identical five-second retry delay can synchronize that pressure and later MUX initialization. There is no measured disk latency or lock ownership trace proving which shared resource initiated the production event.

## Causal chain: demonstrated versus inferred

1. **Observed:** publisher and acquisition storage errors on several sensors.
2. **Demonstrated in source/tests:** acquisition's three-second `deadline()` encloses the entire `runner.step()`, including capacity read, hardware read, enqueue/commit and counter lookup. Two individually tolerated waits plus device work can exceed the shared budget. Python signal exceptions can be delayed inside SQLite calls; the local busy-wait experiment delivered a 20ms deadline only after a roughly 150ms SQLite wait.
3. **Demonstrated:** a storage-path TimeoutError is an OSError, so `collect()` handles it as storage_backpressure. The loop closes hardware, waits five seconds, resets scheduling and adds the normal interval. A pending observation is retried before any new physical read. The test verifies the same object and original timestamp are persisted after retry.
4. **Demonstrated:** `Hardware.close()` clears the adapter. SGP41 heater-off requires conditioning on the next initialization. Storage pressure therefore defeats the recent jitter fix through a different path. Closing is defensible when initial conditioning must not be left active indefinitely or storage is persistently unavailable; resetting an already-running sensor for brief SQLITE_BUSY is unnecessarily disruptive.
5. **Inferred:** simultaneous recovery brings both BMEs and SGP41 back to the shared MUX together. BME initialization can include multiple operations, not just the ordinary 250ms conversion. SGP41's approximately 1006ms timeout matches the one-second MUX-lock timeout; BME02's simultaneous 1074ms operation supports contention. Neither duration alone proves the timeout site.
6. **Demonstrated path, inferred occurrence:** SPS30 storage recovery invokes stop/close and later serial reopen/start. This creates extra transport work and startup transitions without a USB disconnect. Existing device enumeration and quiet kernel logs do not establish whether a serial reply was delayed or missed.

The SPS30 5007ms value is the duration of driver work **plus error cleanup**, not a measured five-second read timeout. The locally inspected SHDLC implementation uses short serial reads and command response budgets; this application does not explicitly configure a five-second serial-read timeout. The acquisition SIGALRM is one-shot, and cleanup after an exception inside `Acquisition.step()` does not receive a fresh deadline there. Python signal delivery is also not a hard real-time cancellation mechanism.

An additional local experiment used pyserial 3.5's real POSIX `Serial.read()` on an OS pipe, with the application's deadline. It produced `SerialException: read failed: Driver deadline exceeded`, with `TimeoutError` as its exception context, in 22ms. pyserial catches OSError, which includes TimeoutError, and wraps it. Thus the logged class SerialException does not distinguish transport failure from application deadline expiry. This experiment proves possibility, not that the Pi's 5007ms incident followed that exact route. Exact dependency versions, stage timings and sanitized exception-chain types are needed to resolve it.

## WAL/reboot interpretation

Canonical Phase II is DELETE/FULL, so there are **no normal Phase II WAL checkpoints to blame**. The unchanged Phase I database does use WAL and could share the storage device. No production PRAGMA was read during this investigation; runtime drift from canonical settings is unverified.

A clean reboot does not imply hot-journal recovery. An interrupted transaction can require rollback recovery, and simultaneous opening, schema initialization, FULL commits, backlog delivery and filesystem activity can create an I/O burst. These are possibilities, not measured explanations of an event approximately 54 seconds after boot. If a database were externally converted to WAL, the old constructor's repeated request for DELETE would be an additional problematic journal-mode change. Do not switch to WAL as an unmeasured fix: retain FULL durability and plan checkpoint, backup and disk-budget behavior first.

## Local patch and further recommendations

Implemented only the narrow diagnostic fix:

- `outbox.read_queue_status()` opens an existing URI with `mode=ro`, autocommit (`isolation_level=None`), `query_only=ON` and a 50ms busy timeout.
- One indexed singleton SELECT obtains identity and counters consistently; the cursor and connection are immediately closed. Identity mismatches still fail.
- No schema setup, identity insert, journal/size changes, checkpoint, directory creation or queue creation. CLI output fields remain `next_seq`, `queued_rows`, `queued_bytes`.
- CLI SQLite failures produce a nonzero structured startup error, not a fabricated empty queue.

This is a short-lived reader, not a lock-free reader or a hard 50ms total-runtime guarantee. A SHARED lock can briefly delay a rollback-journal commit. Under an EXCLUSIVE lock, missing database, or required recovery, report unavailable and retry later manually. `query_only` is defense in depth; it is not by itself a read-only open. Do not use `immutable=1` for a database that live workers modify.

Recommended next work, **not implemented in this change**:

1. Separate device-operation deadlines from storage operations. Keep durable pending-observation retry and conservative handling of uncertain commit outcomes; never drop a sample or change its timestamp to escape contention.
2. Log storage phase, SQLite error code/name, lock/persist/driver/cleanup durations, and exception cause/context types without payloads or credentials. Distinguish SQLITE_BUSY/LOCKED from disk-full/corruption/I/O errors.
3. For bounded transient contention, preserve already-running SGP41/SPS30 hardware state while retaining the pending observation and pausing new acquisition. Keep explicit protections for initial conditioning and prolonged storage outages. Do not blanket-ignore storage failures.
4. Add bounded retry jitter or stagger heavy startup/recovery operations to avoid synchronized reinitialization. Do not independently change the nominal SGP41 sampling policy.

No writer durability setting, sensor driver, scheduler, publisher acknowledgement semantics, database schema or production data was changed.

## Experiments and regression results

- Old status constructor under a held RESERVED writer: OperationalError (`database is locked`) after **2.097s**.
- Patched status under RESERVED writer: reads the committed counters successfully; under EXCLUSIVE lock: fails promptly. Missing paths are not created. Read-only trace contains only query_only and SELECT. Database bytes remain identical; identity checks and URI escaping are covered.
- Four actual queue-status CLI processes against four databases with outstanding RESERVED writes: all read committed snapshots successfully.
- Twelve-process stress: four acquisition loops, four publishers with in-memory HTTP acknowledgements, and four repeatedly opening status readers; 40 observations per sensor (160 total), 100 status reads per sensor (400 total). All sequences delivered in order, all queues drained, next_seq=41, all integrity checks passed. Zero status busy failures; maximum status-call latency in the full-suite run was **6.36ms**. This is accelerated local SSD testing, not a reproduction of Pi storage latency or a physical reboot.
- Storage deadline reproduction verifies SGP41 teardown and retention/retry of the identical pending observation. SQLite delayed signal delivery and the separate pyserial wrapping experiment are also demonstrated.
- **63 Python tests passed**, including 12 new storage tests; **15 Phase II TypeScript tests passed**, including Phase I preservation and payload contracts. Commands: `python3 -m unittest discover -s edge/raspberry-pi -p 'test_*.py'` and `node --import tsx --test tests/sensor-*.test.ts tests/sensor-*.test.tsx`.

## Safer second reboot validation (procedure only)

Keep maintenance ON. Perform the next reboot only when separately authorized. Capture exact boot time and boot ID after reconnecting. Do not run the currently deployed queue-status CLI, sensor-test, integrity checks, vacuum or manual checkpoints during boot validation. Do not start duplicate workers.

After boot, use a few bounded, read-only systemd/journal checks and observe production arrival from a different computer. Wait at least two minutes before judging all sensor startup behavior, then inspect at least five minutes of steady-state data. Preserve and report every startup error separately; waiting does not erase the acceptance failure of an error-free reboot criterion.

Suggested Pi reads, sequentially (not executed here):

```sh
TZ=UTC uptime -s
cat /proc/sys/kernel/random/boot_id
date -u --iso-8601=seconds
sudo systemctl show 'digitalnose-sensor-acquire@*.service' \
  'digitalnose-sensor-publish@*.service' \
  -p Id -p ActiveState -p SubState -p NRestarts
sudo journalctl -b -u 'digitalnose-sensor-acquire@*.service' \
  -u 'digitalnose-sensor-publish@*.service' --since '-10 minutes' --no-pager -o short-iso
sudo journalctl -k -b --since '-10 minutes' --no-pager -o short-iso
```

Persisted/delivery log events already expose queued rows/bytes and sequence numbers without opening additional outbox connections. Prefer them for the first validation. Confirm production observed_at and received_at advance, correct channels/fields, monotonic retry sequences and no errors after the recorded boot boundary.

Only after the read-only status fix is separately reviewed/deployed, and only if queue inspection is still needed, run one sensor's status command, let it exit, and wait ten seconds before inspecting the next sensor. Use the existing DEVICE_IDENTIFIER environment. On busy/unavailable, stop queue probing and inspect logs; no tight retries or parallel `&`, `xargs -P`, or simultaneous subprocess launches.

Maintenance should remain ON until the storage/recovery issue is resolved and a controlled reboot plus a steady-state observation window passes. Retain historical errors as diagnostic evidence.

## Primary references

- [SQLite rollback locking](https://www.sqlite.org/lockingv3.html): SHARED/RESERVED/EXCLUSIVE locks and hot-journal recovery.
- [SQLite URI modes](https://www.sqlite.org/uri.html) and [PRAGMA documentation](https://www.sqlite.org/pragma.html): read-only open, query_only and busy timeout.
- [SQLite WAL](https://www.sqlite.org/wal.html): separate checkpoint behavior and durability tradeoffs.
- [Python signal execution](https://docs.python.org/3/library/signal.html#execution-of-python-signal-handlers): deferred delivery from C operations.
- [pyserial POSIX source](https://github.com/pyserial/pyserial/blob/v3.5/serial/serialposix.py): read exceptions and wrapping.
