"""Physical observations and a strict subset of the existing v1 HTTP contract."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import re

FIELDS = {
    'bme690': ('temperature_c', 'humidity_pct', 'pressure_pa', 'gas_resistance_ohm'),
    'sgp41': ('raw_voc_ticks', 'raw_nox_ticks', 'compensation_temperature_c', 'compensation_humidity_pct'),
    'sps30': ('pm1_ug_m3', 'pm2_5_ug_m3', 'pm4_ug_m3', 'pm10_ug_m3',
              'number_pm0_5_cm3', 'number_pm1_cm3', 'number_pm2_5_cm3',
              'number_pm4_cm3', 'number_pm10_cm3', 'typical_particle_size_um'),
}
REQUIRED = {'bme690': ('gas_resistance_ohm',), 'sgp41': ('raw_voc_ticks', 'raw_nox_ticks'),
            'sps30': FIELDS['sps30'][:4]}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


@dataclass
class Observation:
    readings: dict
    status: str = 'ok'
    valid: bool = True
    observed_at: str = field(default_factory=utc_now)
    acquisition: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)
    error_code: str = ''

    def payload(self, identifier, key, kind, sequence):
        if kind not in FIELDS or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', identifier):
            raise ValueError('Invalid type or collector identifier')
        if not re.fullmatch(r'[a-z0-9_]{1,64}', key):
            raise ValueError('Invalid sensor key')
        if type(sequence) is not int or not 0 <= sequence <= 9007199254740991:
            raise ValueError('Invalid sequence')
        if self.status not in ('ok', 'warming_up', 'invalid', 'error', 'disconnected'):
            raise ValueError('Invalid status')
        if type(self.valid) is not bool or (self.valid and self.status != 'ok'):
            raise ValueError('Invalid validity')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z', self.observed_at):
            raise ValueError('Timestamp must be UTC with microseconds')
        parsed = datetime.fromisoformat(self.observed_at.replace('Z', '+00:00'))
        if parsed.year < 2000:
            raise ValueError('Clock not synchronized')
        if not isinstance(self.readings, dict):
            raise ValueError('Readings must be an object')
        for name, value in self.readings.items():
            if name not in FIELDS[kind]:
                raise ValueError('Unknown measurement')
            if value is None:
                continue
            if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e100:
                raise ValueError('Non-finite measurement')
            if name.endswith('temperature_c'):
                okay = value >= -273.15
            elif name.endswith('humidity_pct'):
                okay = 0 <= value <= 100
            elif name.startswith('raw_'):
                okay = 0 <= value <= 65535 and int(value) == value
            else:
                okay = value >= 0
            if not okay:
                raise ValueError('Out-of-range measurement')
        if self.valid and any(self.readings.get(k) is None for k in REQUIRED[kind]):
            raise ValueError('Missing primary measurement')
        if self.valid and (self.acquisition.get('gas_valid') is False or self.acquisition.get('conditioning') is True):
            raise ValueError('Invalid acquisition flags')
        result = dict(schema_version=1, device_identifier=identifier, sensor_key=key,
                      sensor_type=kind, observed_at=self.observed_at, sequence_number=sequence,
                      status=self.status, valid=self.valid, readings=self.readings,
                      acquisition=self.acquisition, metadata=self.metadata)
        if self.error_code:
            result['error_code'] = self.error_code[:100]
        return result
