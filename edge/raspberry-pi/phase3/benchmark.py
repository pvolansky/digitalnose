"""Reproducible synthetic compression benchmark, never presented as live evidence."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import random
import tempfile
import time

from .archive import write_part
from .core import METRICS, canonical, phase2_record, ens_record, stamp


def benchmark():
    results = []
    randomizer = random.Random(20260924)
    for kind in ('bme690', 'sgp41', 'sps30', 'ens160'):
        rows = []
        total = 720 if kind == 'ens160' else 3600
        for index in range(total):
            if kind == 'ens160':
                rows.append(ens_record(dict(id=index+1,
                    recorded_at_utc=stamp(datetime(2026,9,24,10,tzinfo=timezone.utc)+timedelta(seconds=index*5)),
                    tvoc_ppb=randomizer.randrange(0,700), eco2_ppm=randomizer.randrange(400,1800),
                    aqi=randomizer.randrange(1,6), sensor_status=0), 'benchmark', 'ens160'))
                continue
            readings = {}
            for field in METRICS[kind]:
                base = 30000 if field.startswith('raw_') else (100000 if field in ('pressure_pa', 'gas_resistance_ohm') else 20)
                readings[field] = int(base + randomizer.randrange(-100, 100)) if field.startswith('raw_') else base + randomizer.random()
            payload = dict(sensor_type=kind, readings=readings, sequence_number=index,
                           observed_at=stamp(datetime(2026, 9, 24, 10, tzinfo=timezone.utc)+timedelta(seconds=index)),
                           valid=True, status='ok', acquisition={'driver_version': 'synthetic-test'}, metadata={})
            rows.append(phase2_record(payload, 'benchmark', kind))
        for size in ((12, 120, 720) if kind == 'ens160' else (60, 600, 3600)):
            with tempfile.TemporaryDirectory(prefix='phase3-synthetic-benchmark-') as root:
                start = time.perf_counter()
                part = write_part(root, rows[:size])
                results.append(dict(sensor_type=kind, rows=size, parquet_bytes=part['bytes'],
                                    bytes_per_row=round(part['bytes']/size, 2),
                                    source_envelope_bytes=len(canonical(rows[:size]).encode()),
                                    write_and_verify_ms=round((time.perf_counter()-start)*1000, 2)))
    return dict(dataset='synthetic independent varying channels, seed=20260924; NOT historical measurement', results=results)


if __name__ == '__main__':
    print(canonical(benchmark()))
