# Phase I reconciliation: local implementation and future cutover

No deployment is performed by these instructions or the release builder. Phase II and the immutable `pi-running-phase1/` evidence are outside the release artifact.

## Storage and behaviour

Schema version 1 preserves the exact live raw/aggregate tables. New side tables hold diagnostics, retry scheduling and aggregation progress. Unknown layouts (including the former canonical integer timestamp schema) are rejected before schema initialization. Unversioned live databases require explicit upgrade and a UTC minute boundary; no existing rows are rewritten. Existing aggregate rows, acknowledged or not, are immutable to aggregation.

Fresh databases also require an explicit aggregation boundary before the aggregator runs. The boundary is inclusive. The worker waits ten seconds after minute closure, advances through at most 60 forward minutes per pass and revisits the previous two minutes for late arrivals. It never scans before its boundary. Empty/warm-up minutes remain empty. Older late arrivals are retained raw but require separately approved reconciliation.

Eligibility requires validity 0, running flag, no device error, NEWDAT and API-compatible ranges. Diagnostics retain non-eligible successful reads. For more than one eligible observation in a five-second UTC slot, the earliest inserted eligible observation is used; all raw rows remain stored. Thus aggregate values and count describe the same at-most-12 samples.

Recovery reopens after three consecutive I/O failures. Reopen attempts back off from 1 to 60 seconds. Continuous unusable output triggers recovery after 60 seconds; warm-up is allowed 300 seconds and initial startup 3900 seconds. Output-triggered resets are separated by at least 300 seconds. Hardware failures cannot be repaired in software; repeated failures remain visible in logs. No shared-bus reset is performed.

Sync preserves `/api/ingest` fields and UTC minute identity. It requires HTTP 200 plus JSON `ok: true`, disables redirects, limits responses to 4096 bytes and preserves pending rows on failure. Retry state is per row, persisted separately, with exponential backoff and jitter. Existing sync markers remain untouched. No credentials or response bodies are logged.

## Validation and release approval

Run `npm run test:pi`, `npm run check`, `npm run build` and `npm run format:check`. Review and commit only the intended canonical changes. The current workspace may contain untracked project files; do not invent a release commit or publish an artifact from unrelated HEAD.

Build from the reviewed commit on the development computer:

```sh
python3 edge/raspberry-pi/build_release.py --commit REVIEWED_COMMIT --output /tmp/digitalnose-phase1.tar
shasum -a 256 /tmp/digitalnose-phase1.tar
scp /tmp/digitalnose-phase1.tar diginose@PI_HOST:/home/diginose/digital-nose/
```

Replace REVIEWED_COMMIT and PI_HOST explicitly. The builder reads only committed allowlisted Phase I files, never environment files, data, reference snapshots or Phase II. The deterministic tar includes commit/schema metadata and checksums. Preserve test results alongside the reviewed release record.

## Future Pi staging (requires deployment approval)

Set COMMIT to the exact manifest commit. Verify the transferred tar hash against the independently recorded development-machine hash before extraction.

```sh
cd /home/diginose/digital-nose
COMMIT=REVIEWED_COMMIT
sha256sum digitalnose-phase1.tar
mkdir -p releases/phase1
tar -xf digitalnose-phase1.tar -C releases/phase1
RELEASE=/home/diginose/digital-nose/releases/phase1/phase1-$COMMIT
cd "$RELEASE"
sha256sum -c SHA256SUMS
/usr/bin/python3 --version
/usr/bin/python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip freeze > INSTALLED-DEPENDENCIES.txt
```

This uses a separate Phase I environment; never use `.venv-phase2`. Pinning includes smbus2 0.5.0. Record Python 3.13.5, architecture and installed package versions in the deployment record. No sensor reads or database opens are needed for staging.

Before activation, privately verify `/etc/digitalnose.env` contains the existing `DIGITALNOSE_DB`, `DIGITALNOSE_INGEST_URL`, `DEVICE_IDENTIFIER`, `DEVICE_API_KEY`. Do not print it. The database must be `/home/diginose/digital-nose/data/digitalnose.db`. Do not change production identity, endpoint or key. The optional ENS160_BUS/ENS160_ADDRESS defaults are 1/0x53.

New units retain service names/user and remove cross-worker Requires coupling: collector, aggregator and sync can recover independently. Review this intentional dependency change. All three use the existing environment file. Do not install the obsolete digitalnose-collector.service.

## Approved maintenance cutover

Record the previous active release target, service files and software. For the first cutover, the original root-level scripts remain in place for rollback. Record Phase II service status read-only before/after.

```sh
sudo systemctl stop digitalnose-sync.service digitalnose-aggregator.service digitalnose.service
systemctl is-active digitalnose.service digitalnose-aggregator.service digitalnose-sync.service
```

Require all three inactive before proceeding. Create a private backup directory, retain the units, and use SQLite's backup API (not a lone copy of a WAL database):

```sh
umask 077
BACKUP=/home/diginose/digital-nose/backups/phase1-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP"
sudo cp /etc/systemd/system/digitalnose.service /etc/systemd/system/digitalnose-aggregator.service /etc/systemd/system/digitalnose-sync.service "$BACKUP/"
/usr/bin/python3 - "$BACKUP/database.sqlite3" <<'PY'
import sqlite3,sys
source=sqlite3.connect('file:/home/diginose/digital-nose/data/digitalnose.db?mode=ro',uri=True)
target=sqlite3.connect(sys.argv[1])
source.backup(target)
target.close(); source.close()
PY
```

Record raw/aggregate counts and pending/acknowledged counts privately. Choose the UTC minute at cutover as the inclusive aggregation boundary; leave all earlier raw history untouched. Existing pending aggregates still sync normally.

```sh
BOUNDARY=$(date -u +%Y-%m-%dT%H:%M:00Z)
DIGITALNOSE_DB=/home/diginose/digital-nose/data/digitalnose.db "$RELEASE/.venv/bin/python" "$RELEASE/database.py" --upgrade --aggregation-start "$BOUNDARY"
cd /home/diginose/digital-nose
ln -s "$RELEASE" phase1-next
mv -Tf phase1-next phase1-current
sudo install -m 644 "$RELEASE/digitalnose.service" /etc/systemd/system/digitalnose.service
sudo install -m 644 "$RELEASE/digitalnose-aggregator.service" /etc/systemd/system/digitalnose-aggregator.service
sudo install -m 644 "$RELEASE/digitalnose-sync.service" /etc/systemd/system/digitalnose-sync.service
sudo systemctl daemon-reload
sudo systemctl start digitalnose.service digitalnose-aggregator.service
```

First verify acquisition, diagnostic persistence, warm-up exclusion and one valid aggregate. Then start sync explicitly:

```sh
sudo systemctl start digitalnose-sync.service
systemctl is-active digitalnose.service digitalnose-aggregator.service digitalnose-sync.service
journalctl -u digitalnose.service -u digitalnose-aggregator.service -u digitalnose-sync.service --since '10 minutes ago' --no-pager
```

Verify an acknowledged new minute, unchanged historical aggregates, database integrity and unchanged SPS30 operation. Do not simulate bus disconnection on the live shared bus. Do not backfill the warm-up gap. Preserve current boot enablement; verify is-enabled for all three services.

## Rollback

Stop the three Phase I services in the same order. Restore the saved service definitions (and previous phase1-current target for subsequent releases), reload systemd, then restart Phase I deliberately. For first cutover the saved units point to untouched root-level scripts.

The additive tables do not prevent the original live code from reading the database. Keep the current database and new observations; do not overwrite it with the pre-cutover backup. Original code reintroduces its known aggregate-replacement/logging defects, so rollback is a temporary operational measure. Never drop side tables while workers run. Never change Phase II services or its outbox.

Approval is required for selecting/committing the release, copying/installing it, the maintenance window, private Pi backup, explicit schema upgrade and activation. No cloud migration or historical-data rewrite is required.
