"""Collect at most one raw reading per UTC five-second slot."""
import logging
import sqlite3
import time
from database import connect
from sensor import Sensor


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db = connect()
    sensor = Sensor()
    try:
        while True:
            slot = int(time.time()) // 5 * 5
            try:
                reading = sensor.read()
                if reading is not None:
                    with db:
                        db.execute("INSERT OR IGNORE INTO sensor_readings VALUES (?, ?, ?, ?)", (slot, *reading))
            except (OSError, sqlite3.Error):
                logging.exception("Sensor read or local storage failed")
            time.sleep(max(0.1, 5 - time.time() % 5))
    finally:
        sensor.close()
        db.close()

if __name__ == "__main__":
    main()
