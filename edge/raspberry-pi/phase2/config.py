import json
import os
import re
from pathlib import Path


def load_config(path):
    config = json.loads(Path(path).read_text())
    if config.get('version') != 1:
        raise ValueError('Unsupported configuration version')
    if type(config.get('i2c_bus')) is not int or config['i2c_bus'] < 0:
        raise ValueError('Invalid bus')
    if type(config.get('mux_address')) is not int or not 0x70 <= config['mux_address'] <= 0x77:
        raise ValueError('Invalid mux address')
    if not Path(config['state_dir']).is_absolute() or not Path(config['mux_lock']).is_absolute():
        raise ValueError('State and lock paths must be absolute')
    channels = set()
    for key, item in config['sensors'].items():
        if not re.fullmatch(r'[a-z0-9_]{1,64}', key) or item.get('type') not in ('ens160', 'bme690', 'sgp41', 'sps30'):
            raise ValueError('Invalid sensor configuration')
        if type(item.get('enabled')) is not bool:
            raise ValueError('enabled must be explicit boolean')
        interval = item.get('interval_seconds')
        if type(interval) not in (int, float) or not 1 <= interval <= 3600:
            raise ValueError('Invalid sampling interval')
        if item['type'] == 'sgp41' and interval != 1:
            raise ValueError('SGP41 requires 1 Hz acquisition')
        if item['type'] in ('bme690', 'sgp41'):
            channel = item.get('mux_channel')
            if type(channel) is not int or not 0 <= channel <= 7 or channel in channels:
                raise ValueError('Mux channels must be distinct and between 0 and 7')
            channels.add(channel)
            if item.get('address') not in ((0x76, 0x77) if item['type'] == 'bme690' else (0x59,)):
                raise ValueError('Invalid sensor address')
            if item['address'] == config['mux_address']:
                raise ValueError('Mux address must not collide with a downstream sensor')
        if item['type'] == 'ens160' and item['enabled']:
            raise ValueError('ENS160 remains owned by the existing collector')
        if item['type'] == 'sps30' and (item.get('connection') != 'usb' or not isinstance(item.get('serial_port'), str)):
            raise ValueError('SPS30 needs an explicit USB serial device path')
    limits = config['outbox']
    for field in ('max_rows', 'max_bytes', 'max_db_bytes'):
        if type(limits.get(field)) is not int or limits[field] <= 0:
            raise ValueError('Invalid outbox limits')
    if limits['max_bytes'] < 16384 or limits['max_db_bytes'] < limits['max_bytes'] * 2:
        raise ValueError('Reserve database space for indexes and metadata')
    return config


def state_path(config, key):
    return Path(config['state_dir']) / (key + '.sqlite3')


def identifier():
    value = os.environ.get('DEVICE_IDENTIFIER', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise ValueError('DEVICE_IDENTIFIER is required')
    return value
