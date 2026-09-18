"""Bounded forward aggregation with grace and a two-minute late-arrival window."""
import logging
import sqlite3
import time
from database import connect,create_minute_aggregate,utc

def aggregate_once(db,now=None,max_minutes=60):
    now=time.time() if now is None else now
    cutoff=int(now-10)//60*60
    row=db.execute("SELECT value FROM phase1_metadata WHERE key='aggregation_cursor'").fetchone()
    if row is None: raise ValueError('Set an explicit aggregation boundary before running aggregator')
    cursor=int(row[0])
    boundary=db.execute("SELECT value FROM phase1_metadata WHERE key='aggregation_boundary'").fetchone()
    if boundary is None:
        with db: db.execute("INSERT INTO phase1_metadata VALUES ('aggregation_boundary',?)",(str(cursor),))
        floor=cursor
    else: floor=int(boundary[0])
    created=0
    end=min(cutoff,cursor+max_minutes*60)
    for minute in range(max(floor,cursor-120),end,60):
        outcome=create_minute_aggregate(db,utc(minute),utc(minute+60))
        logging.info('Minute %s: %s',utc(minute),outcome)
        created+=outcome=='created'
        if minute>=cursor:
            with db: db.execute("UPDATE phase1_metadata SET value=? WHERE key='aggregation_cursor'",(str(minute+60),))
    return created

def main():
    logging.basicConfig(level=logging.INFO)
    db=connect()
    try:
        while True:
            try: aggregate_once(db)
            except sqlite3.Error: logging.exception('Minute aggregation failed; will retry')
            time.sleep(10)
    finally: db.close()

if __name__=='__main__': main()
