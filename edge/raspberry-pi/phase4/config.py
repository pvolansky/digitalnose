import json
from pathlib import Path


def load_config(path):
    config = json.loads(Path(path).read_text())
    if config.get('version') != 1:
        raise ValueError('Unsupported Phase IV configuration')
    if not Path(config.get('state_path', '')).is_absolute():
        raise ValueError('Phase IV state_path must be absolute')
    if not isinstance(config.get('poll_seconds'), (int, float)) or not 1 <= config['poll_seconds'] <= 60:
        raise ValueError('Invalid command polling interval')
    if not isinstance(config.get('sensor_runtime'), dict):
        raise ValueError('Missing sensor runtime configuration')
    return config
