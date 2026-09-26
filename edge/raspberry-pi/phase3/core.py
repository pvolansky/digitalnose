"""Canonical records, explicit UTC time and restaurant retention eligibility."""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import math
import re
from uuid import UUID
from zoneinfo import ZoneInfo

UTC = timezone.utc
LONDON = ZoneInfo('Europe/London')
METRICS = {
    'ens160': ('tvoc_ppb', 'eco2_ppm', 'aqi'),
    'bme690': ('temperature_c', 'humidity_pct', 'pressure_pa', 'gas_resistance_ohm'),
    'sgp41': ('raw_voc_ticks', 'raw_nox_ticks', 'compensation_temperature_c', 'compensation_humidity_pct'),
    'sps30': ('pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3',
              'number_pm0_5_cm3', 'number_pm1_cm3', 'number_pm2_5_cm3',
              'number_pm4_cm3', 'number_pm10_cm3', 'typical_particle_size_um'),
}


def instant(value):
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('An explicit timezone is required')
    return dt.astimezone(UTC)


def stamp(value):
    return instant(value).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def now():
    return stamp(datetime.now(UTC))


def eligible(value):
    local = instant(value).astimezone(LONDON)
    return (10, 0) <= (local.hour, local.minute) < (23, 55)


def minute(value):
    return stamp(instant(value).replace(second=0, microsecond=0))


def _json(value):
    if isinstance(value, datetime):
        return stamp(value)
    if isinstance(value, (UUID, Decimal)):
        # Decimal strings retain source precision, unlike conversion through float.
        return str(value)
    raise TypeError(type(value).__name__)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False, default=_json)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def safe_component(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        raise ValueError('Unsafe path identity')
    return value


def record(source, device, sensor, kind, identity, observed, original, readings=None,
           received=None, sequence=None, valid=None, status=None, session=None):
    safe_component(device)
    safe_component(sensor)
    safe_component(kind)
    safe_component(source)
    if sequence is not None and (type(sequence) is not int or not 0 <= sequence <= 2**63-1):
        raise ValueError('Invalid sequence')
    if valid is not None and type(valid) is not bool:
        raise ValueError('Invalid validity')
    for key, value in (readings or {}).items():
        if key not in METRICS.get(kind, ()):
            raise ValueError('Unknown measurement')
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
            raise ValueError('Invalid measurement')
    result = dict(source=source, device_id=device, sensor_id=sensor, sensor_type=kind,
                  identity=str(identity), observed_at=stamp(observed),
                  received_at=stamp(received) if received else None, sequence_number=sequence,
                  valid=valid, status=status, session_id=session, readings=readings or {},
                  source_json=canonical(original))
    result['record_id'] = digest([source, device, sensor, str(identity)])
    return result


def phase2_record(payload, device, sensor, session=None):
    return record('phase2_outbox', device, sensor, payload['sensor_type'],
                  canonical([payload['observed_at'], payload['sequence_number']]),
                  payload['observed_at'], payload, payload['readings'],
                  sequence=payload['sequence_number'], valid=payload['valid'],
                  status=payload['status'], session=session)


def ens_record(row, device, sensor='ens160_01', session=None):
    status = {0: 'ok', 1: 'warming_up', 2: 'startup', 3: 'invalid'}.get(row['sensor_status'], 'unknown')
    return record('sensor_readings', device, sensor, 'ens160', row['id'], row['recorded_at_utc'],
                  row, {k: row[k] for k in METRICS['ens160']}, sequence=row['id'],
                  valid=row['sensor_status'] == 0, status=status, session=session)
