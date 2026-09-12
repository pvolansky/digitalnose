# Raspberry Pi reference pipeline

The web platform accepts the existing Pi's one-minute aggregates. If you already have a collector and aggregator, adapt only the outbox mapping in `sync.py`; inspect and back up the existing database first. The bundled schema stores timestamps as Unix UTC seconds locally. It is not an automatic migration for another edge database.

## Fresh installation

Use Raspberry Pi OS with Python 3.10+, I²C enabled (`sudo raspi-config`), an ENS160 on bus 1 at address 0x53 (0x52 can be configured), and time synchronisation enabled. Follow the sensor board vendor's voltage/wiring guidance.

Place this repository at `/opt/digitalnose`, then:

```sh
sudo useradd --system --home /var/lib/digitalnose --groups i2c digitalnose
sudo install -d -o digitalnose -g digitalnose -m 700 /var/lib/digitalnose
sudo install -d -m 755 /etc/digitalnose
cd /opt/digitalnose/edge/raspberry-pi
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
sudo install -m 600 .env.example /etc/digitalnose/edge.env
sudoedit /etc/digitalnose/edge.env
```

Fill in the HTTPS ingest URL, device identifier and key generated in web Settings. `EnvironmentFile` is read by systemd; it does not need to be world-readable. The three services run as the dedicated account. Keep application code owned by your deployment account, with read/execute access for the service account.

```sh
sudo cp digitalnose-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now digitalnose-collector digitalnose-aggregator digitalnose-sync
sudo journalctl -u digitalnose-sync -f
```

The sync service does not wait for network-online and tolerates unavailable internet. Collector and aggregator have no network dependency. Services use short SQLite transactions and WAL; sync never holds a database write lock during an HTTP request.

## Behaviour

- `sensor.py`: reads ENS160 standard-mode registers, checks part ID and rejects warm-up, initial start-up, invalid status, error status and out-of-range measurements. It does not fabricate substitute readings. See the [ENS160 register datasheet](https://cdn.sparkfun.com/assets/9/f/e/9/c/ENS160_datasheet.pdf) and [SparkFun's ENS160 driver](https://github.com/sparkfun/qwiic_ens160_py).
- `collector.py`: stores at most one measurement per five-second UTC slot. Invalid sensor data creates a gap. A database unique key prevents more than 12 samples/minute after restart.
- `aggregator.py`: finalises closed UTC minutes after a ten-second grace period. It averages TVOC/eCO₂, records extrema and maximum AQI, and counts actual samples. No interpolation or filling. Work is bounded to one hour of raw input per pass and skips empty gaps.
- `sync.py`: reads up to 50 eligible unsynced minutes, sends each to `/api/ingest`, and marks a row synced only after a 200 response with `ok: true`. Network failures and lost acknowledgements leave the row queued. Each failed row gets exponential backoff capped at one hour, with jitter, without blocking later rows indefinitely. Redirects are refused to avoid forwarding bearer credentials elsewhere.

The local raw data is not pruned or uploaded. Monitor disk usage and define a backed-up retention policy appropriate to the study before prolonged deployment. Keep NTP working; the server rejects timestamps more than one minute in the future. ENS160 start-up can take time; missing data during validity warm-up is expected. No hardware validation was performed on a physical Pi during this web build.

## Key rotation and recovery

1. Generate a replacement in web Settings (revokes earlier keys for that device).
2. Update `DEVICE_API_KEY` in `/etc/digitalnose/edge.env`.
3. `sudo systemctl restart digitalnose-sync`.

Queued minutes will retry with the replacement key. Do not change the identifier of an existing Pi without also updating its local configuration. Do not reuse an outbox for a different physical device/site.

For failures, inspect `journalctl`, verify device identifier and HTTPS URL, and check `attempts`/`retry_at` in the local outbox. Failed rows are retained, including validation/auth errors. Correct the underlying issue before resetting retry times if an immediate retry is needed.

Run `python3 -m unittest discover -s edge/raspberry-pi -p 'test_*.py'` from the repository root. The tests use temporary SQLite files and fake HTTP acknowledgements; no sensor, network or third-party Python package is needed.
