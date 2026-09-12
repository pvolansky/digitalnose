"""Finalize closed minutes after a ten-second grace period. Preserve raw rows."""
import logging
import sqlite3
import time
from database import connect


def aggregate_once(db, now=None):
    now = time.time() if now is None else now
    cutoff = int(now - 10) // 60 * 60
    last = db.execute("SELECT MAX(minute_start_utc) FROM minute_aggregates").fetchone()[0]
    start = db.execute("SELECT MIN(observed_at) FROM sensor_readings WHERE observed_at >= ?", (last + 60 if last is not None else 0,)).fetchone()[0]
    if start is None:
        return 0
    # Bounded work and short writes allow collection and sync to continue independently.
    end = min(cutoff, start // 60 * 60 + 3600)
    rows = db.execute("""SELECT observed_at / 60 * 60 AS minute,
      AVG(tvoc), MIN(tvoc), MAX(tvoc), AVG(eco2), MIN(eco2), MAX(eco2), MAX(aqi), COUNT(*)
      FROM sensor_readings WHERE observed_at >= ? AND observed_at < ? GROUP BY minute""", (start, end)).fetchall()
    with db:
        db.executemany("""INSERT OR IGNORE INTO minute_aggregates
          (minute_start_utc,tvoc_mean,tvoc_min,tvoc_max,eco2_mean,eco2_min,eco2_max,aqi_max,sample_count)
          VALUES (?,?,?,?,?,?,?,?,?)""", [tuple(row) for row in rows])
    return len(rows)


def main():
    logging.basicConfig(level=logging.INFO)
    db = connect()
    try:
        while True:
            try:
                aggregate_once(db)
            except sqlite3.Error:
                logging.exception("Minute aggregation failed; will retry")
            time.sleep(10)
    finally:
        db.close()

if __name__ == "__main__":
    main()
