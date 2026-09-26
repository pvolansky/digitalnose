"""Recomputable minute statistics, with missing coverage kept distinct from zero."""
from .core import METRICS, digest, instant, minute
import json
import math


def statistics(samples):
    if not samples:
        return None
    samples = sorted(samples)
    count, mean, m2 = 0, 0.0, 0.0
    for _, _, value in samples:
        count += 1
        delta = value - mean
        mean += delta / count
        m2 += delta * (value - mean)
    low = min(samples, key=lambda s: s[2])
    high = max(samples, key=lambda s: s[2])
    return dict(n=count, min=low[2], max=high[2], mean=mean, m2=m2,
                first=samples[0][2], last=samples[-1][2],
                min_at=low[0], max_at=high[0])


def summarize(rows, device, sensor, kind, start, interval_seconds):
    if not 0 < interval_seconds <= 60:
        raise ValueError('Summary cadence must be between 0 and 60 seconds')
    start = minute(start)
    rows = sorted(rows, key=lambda r: (r['observed_at'], r['record_id']))
    if any((r['device_id'], r['sensor_id'], r['sensor_type'], minute(r['observed_at'])) !=
           (device, sensor, kind, start) for r in rows):
        raise ValueError('Mixed summary sensor/minute')
    if len({r['record_id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate summary input')
    expected = math.ceil(60 / interval_seconds)
    valid = [r for r in rows if r['valid'] is True]
    success = [r for r in rows if json.loads(r['source_json']).get('metadata', {}).get('phase3', {}).get(
        'read_success', r['status'] in ('ok', 'warming_up', 'startup', 'invalid'))]
    warm = sum(r['status'] in ('warming_up', 'startup') for r in rows)
    errors = sum(r['status'] in ('error', 'disconnected') for r in rows)
    # Occupied cadence slots distinguish a burst of duplicates/late samples from coverage.
    slots = {int((instant(r['observed_at']) - instant(start)).total_seconds() // interval_seconds) for r in rows}
    missing = max(0, expected - len(slots))
    metrics = {key: statistics([(r['observed_at'], r['record_id'], r['readings'][key])
                               for r in valid if r['readings'].get(key) is not None])
               for key in METRICS[kind]}
    # Historical attempts/retries cannot be inferred from a persistence sequence.
    provenance = dict(session_ids=sorted({r['session_id'] for r in rows if r['session_id']}),
                      attempts_observed=len(rows), attempted_samples=None,
                      retry_count=None, reinitialisation_count=None, read_latency_ms=None,
                      coverage_basis='UTC cadence slots; persisted observations only')
    sequences = [r['sequence_number'] for r in rows if r['sequence_number'] is not None]
    provenance['sequence_min'] = min(sequences) if sequences else None
    provenance['sequence_max'] = max(sequences) if sequences else None
    provenance['duplicate_sequences'] = len(sequences)-len(set(sequences)) if sequences else None
    provenance['sequence_gap_count'] = max(sequences)-min(sequences)+1-len(set(sequences)) if sequences else None
    provenance['duplicate_timestamps'] = len(rows)-len({r['observed_at'] for r in rows})
    telemetry = [json.loads(r['source_json']).get('metadata', {}).get('phase3') for r in rows]
    if telemetry and all(t is not None for t in telemetry):
        provenance['attempted_samples'] = len(telemetry)
        provenance['persistence_retry_count'] = sum(t.get('persistence_retry_count', 0) for t in telemetry)
        provenance['coverage_basis'] = 'Explicit persisted acquisition attempts; crashes before durable commit remain unknown'
        provenance['read_latency_ms'] = statistics([
            (r['observed_at'], r['record_id'], t['read_latency_ms']) for r, t in zip(rows, telemetry)])
        provenance['reinitialisation_count'] = sum(t['recovery_requested'] for t in telemetry)
        provenance['reinitialisation_semantics'] = 'close requested for lazy reinitialisation, not proven recovery'
    if kind == 'sgp41':
        from collections import Counter
        metadata = [json.loads(r['source_json']).get('metadata', {}) for r in rows]
        provenance['compensation_sources'] = dict(Counter(m.get('compensation_source', 'unknown') for m in metadata))
        times = [m['compensation_observed_at'] for m in metadata if m.get('compensation_observed_at')]
        provenance['compensation_observed_range'] = [min(times), max(times)] if times else None
    return dict(device_id=device, sensor_id=sensor, sensor_type=kind, minute_start=start,
                expected_samples=expected, observed_samples=len(rows), successful_reads=len(success),
                valid_samples=len(valid), warmup_samples=warm,
                invalid_samples=sum(r['status'] == 'invalid' or (r['status'] == 'ok' and not r['valid']) for r in rows), error_samples=errors,
                unknown_samples=sum(r['status'] not in ('ok', 'warming_up', 'startup', 'invalid', 'error', 'disconnected') for r in rows),
                missing_samples=missing, occupied_slots=len(slots), metrics=metrics,
                last_successful_observation=max((r['observed_at'] for r in success), default=None),
                health='unknown' if not rows else ('degraded' if missing or len(valid) != len(rows) else 'normal'),
                provenance=provenance, source_digest=digest(rows))
