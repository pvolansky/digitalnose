"""Upload bounded batches of minute aggregates, never raw sensor_readings.
Network calls occur outside SQLite transactions. Lost acknowledgements safely retry.
"""
import json
import logging
import os
import random
import sqlite3
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from database import connect

FIELDS = ("tvoc_mean", "tvoc_min", "tvoc_max", "eco2_mean", "eco2_min", "eco2_max", "aqi_max", "sample_count")

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a bearer credential to a redirect destination.
        return None


def upload(url, key, payload):
    request = Request(url, data=json.dumps(payload).encode(), headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
    with build_opener(NoRedirect()).open(request, timeout=10) as response:
        result = json.loads(response.read(4096))
        return response.status == 200 and isinstance(result, dict) and result.get("ok") is True


def sync_once(db, url, key, identifier, batch_size=50, sender=upload, now=None):
    now = int(time.time()) if now is None else int(now)
    rows = db.execute("""SELECT * FROM minute_aggregates WHERE synced_at IS NULL AND retry_at <= ?
      ORDER BY minute_start_utc LIMIT ?""", (now, batch_size)).fetchall()
    synced = 0
    for row in rows:
        payload = {field: row[field] for field in FIELDS}
        payload.update(device_identifier=identifier, minute_start_utc=datetime.fromtimestamp(row["minute_start_utc"], timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z"))
        try:
            success = sender(url, key, payload)
        except (HTTPError, URLError, OSError, ValueError):
            # Do not log request headers, API keys or response bodies.
            success = False
        with db:
            if success:
                db.execute("UPDATE minute_aggregates SET synced_at=? WHERE minute_start_utc=?", (now, row["minute_start_utc"]))
                synced += 1
            else:
                delay = min(3600, 15 * 2 ** min(row["attempts"], 8)) + random.randint(0, 10)
                db.execute("UPDATE minute_aggregates SET attempts=attempts+1,retry_at=? WHERE minute_start_utc=?", (now + delay, row["minute_start_utc"]))
                logging.warning("Minute %s not acknowledged; queued for retry", row["minute_start_utc"])
    return synced


def main():
    logging.basicConfig(level=logging.INFO)
    url, key, identifier = (os.environ[name] for name in ("DIGITALNOSE_INGEST_URL", "DEVICE_API_KEY", "DEVICE_IDENTIFIER"))
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("DIGITALNOSE_INGEST_URL must be an HTTPS URL without credentials")
    db = connect()
    try:
        while True:
            try:
                count = sync_once(db, url, key, identifier)
                if count:
                    logging.info("Synced %s minute aggregates", count)
            except sqlite3.Error:
                logging.exception("Local outbox unavailable; will retry")
            time.sleep(10)
    finally:
        db.close()

if __name__ == "__main__":
    main()
