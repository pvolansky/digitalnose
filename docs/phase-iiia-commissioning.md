# Phase IIIA commissioning

Phase IIIA runs beside the existing PostgreSQL publisher. It preserves each
Phase II outbox record locally before the existing HTTP acknowledgement path,
builds minute summaries, publishes device health, and seals eligible raw data
as Parquet with a manifest in the private `digitalnose-raw` bucket.

The production-proven scope is limited to `sgp41_01` and `bme690_01`. Do not
enable BME690 #2, SPS30, or ENS160 without a separate commissioning run.

## Runtime layout

- `/etc/digitalnose/phase3.json`: SGP41 configuration.
- `/etc/digitalnose/phase3-<instance>.json`: instance-specific configuration,
  owned by `root:diginose` with mode `0640`.
- `/var/lib/digitalnose/phase3`: writable journal, spool, manifests, and local
  archive state.
- `/var/lib/digitalnose/phase3-auth/session.json`: dedicated uploader session;
  never commit or copy this file into reports.
- `digitalnose-archive@<instance>.service`: per-sensor archive worker.
- `digitalnose-device-health.timer`: device-level health publication.

The uploader is a dedicated Auth identity registered in `archive_uploaders`.
The bucket remains private. Storage policies permit that identity to insert
and select only within its registered device prefix; update, delete, anonymous,
owner-account, and service-role upload paths are outside this design.

## Coverage and summaries

`coverage_start` is the lower bound for new summary generation. On restart the
worker uses the later of the saved cursor and `coverage_start`. Retained raw
observations and checkpoints are not deleted, and late observations may still
revise already-covered minutes through the existing dirty-minute semantics.

Raw archive eligibility is the restaurant evidence window, 10:00–23:00
Europe/London. The local high-frequency stream remains available to the event
pipeline while eligible partitions are sealed and uploaded.

## Frozen commissioning gates

Immediate rollback conditions are a preservation failure, identity conflict,
loss or acknowledgement of an original queue row before successful
preservation, a preservation call of at least one second, missing acquired
identity, archive/hash/manifest mismatch, authentication failure, service
restart or instability, clock instability, or disk/spool safety breach.

During a shared outage, compare each publisher with its own observed request
attempts. For a 1 Hz stream, estimate transport backlog as cumulative seconds
blocked in HTTP plus observations arriving during retry/backoff. Add the small
measured preservation allowance. Queue depth alone is not evidence of a
Phase III regression when publishers received different timeout schedules.
The queue must remain no older than 120 seconds, begin draining after HTTP
recovery, return near baseline within 120 seconds, and reconcile every acquired
identity exactly once.

Receipt-lag recovery is evaluated independently for each sensor over three
completed minutes. At least two minutes must have mean lag at most 2 seconds,
p95 at most 6 seconds, and maximum at most 8 seconds. The first qualifying
minute must occur within 120 seconds and the second within 180 seconds of the
last shared failure or queue peak.

For successful preservation calls, record values above 100 ms and 250 ms as
diagnostics. Warn when completed-minute p95 exceeds 100 ms or p99 exceeds
250 ms. Roll back only when that warning persists for two consecutive minutes
and the publisher exceeds its attempt-normalized queue allowance in two
consecutive samples, or its queue fails to drain after HTTP recovery. Also roll
back when successful preservation consumes at least 12 seconds in each of two
consecutive completed minutes.

## Required archive proof

Commissioning requires continuous PostgreSQL ingestion, exact mirror identity
continuity, correct minute summaries, truthful device health, and a newly
sealed production Parquet part plus manifest. Verify the local files, upload,
perform a full authenticated GET, compare local and remote SHA-256 values,
compare the remote manifest, and confirm the verified state was recorded.
For BME690, validate gas resistance, temperature, relative humidity, pressure,
validity/status, timestamps, sequence identity, and acquisition provenance.

Keep commissioning output under `docs/local-reports/`; that directory is
ignored so operational evidence remains local without entering Git history.
