"""Collect Phase I observations, retaining diagnostic validity information."""
import logging
import sqlite3
import time
from database import connect,insert_reading,utc
from sensor import RecoveringSensor

def main():
    logging.basicConfig(level=logging.INFO)
    db=connect()
    sensor=RecoveringSensor()
    try:
        while True:
            observation=sensor.observe()
            if observation is not None:
                try: insert_reading(db,utc(time.time()),observation)
                except sqlite3.Error: logging.exception('Phase I local persistence failed')
            time.sleep(max(.1,5-time.time()%5))
    finally:
        sensor.close()
        db.close()

if __name__=='__main__': main()
