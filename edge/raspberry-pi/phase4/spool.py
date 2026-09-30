import json
import sqlite3
from pathlib import Path


class CaptureSpool:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute('pragma journal_mode=wal')
        self.db.executescript('''
          create table if not exists measurements(
            session_id text not null, sensor_key text not null, sequence_number integer not null,
            body text not null, uploaded integer not null default 0,
            primary key(session_id,sensor_key,sequence_number));
          create table if not exists state(key text primary key,value text not null);
        ''')

    def append(self, session_id, row):
        self.db.execute('insert or ignore into measurements values(?,?,?,?,0)',
                        (session_id,row['sensor_key'],row['sequence_number'],
                         json.dumps(row,separators=(',',':'),sort_keys=True)))
        self.db.commit()

    def pending(self, session_id, limit=100):
        rows = self.db.execute('select sensor_key,sequence_number,body from measurements '
                               'where session_id=? and uploaded=0 order by sequence_number,sensor_key limit ?',
                               (session_id,limit)).fetchall()
        return [(key,sequence,json.loads(body)) for key,sequence,body in rows]

    def acknowledge(self, session_id, keys):
        self.db.executemany('update measurements set uploaded=1 where session_id=? and sensor_key=? and sequence_number=?',
                            [(session_id,key,sequence) for key,sequence in keys])
        self.db.commit()

    def set_active(self, value):
        if value is None:
            self.db.execute("delete from state where key='active_session'")
        else:
            self.db.execute("insert into state values('active_session',?) on conflict(key) do update set value=excluded.value",(value,))
        self.db.commit()

    def active(self):
        row = self.db.execute("select value from state where key='active_session'").fetchone()
        return row[0] if row else None

    def set_state(self, key, value):
        self.db.execute("insert into state values(?,?) on conflict(key) do update set value=excluded.value",
                        (key, json.dumps(value, separators=(',',':'), sort_keys=True)))
        self.db.commit()

    def state(self, key, default=None):
        row = self.db.execute('select value from state where key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def close(self):
        self.db.close()
