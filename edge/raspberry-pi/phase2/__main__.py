"""python -m phase2 sensor-test <one sensor>; diagnostics never publish."""
import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from .bus import Mux, file_lock
from .config import load_config, identifier
from .drivers import Hardware
from .model import utc_now
from .runtime import collect, publish, open_box, stop_event, deadline, compensation, log
from .publish import check_credentials


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='/etc/digitalnose/sensors.json')
    parser.add_argument('command', choices=['check-config', 'sensor-test', 'collect', 'publish', 'queue-status'])
    parser.add_argument('sensor', nargs='?')
    parser.add_argument('--samples', type=int, default=15)
    parser.add_argument('--allow-unavailable-hardware', action='store_true')
    parser.add_argument('--exclusive-ens160', action='store_true')
    args = parser.parse_args()
    config = load_config(args.config)
    if args.command == 'check-config':
        print(json.dumps({'config': 'valid', 'enabled': [k for k, v in config['sensors'].items() if v['enabled']],
                          'python': sys.version.split()[0], 'hardware_verified': False}))
        return
    key = args.sensor
    if key != 'mux' and key not in config['sensors']:
        parser.error('Select one configured sensor or mux')
    if key == 'mux' and args.command != 'sensor-test':
        parser.error('Mux only supports sensor-test')
    Path(config['state_dir']).mkdir(parents=True, exist_ok=True)
    if key == 'mux':
        from smbus2 import SMBus
        with SMBus(config['i2c_bus']) as bus, deadline():
            print(json.dumps({'timestamp': utc_now(), 'mux': Mux(bus, config['mux_address'], config['mux_lock']).probe()}))
        return
    item = config['sensors'][key]
    if args.command == 'sensor-test':
        if not 1 <= args.samples <= 3600:
            parser.error('samples must be between 1 and 3600')
        if item['type'] == 'sps30' and not args.allow_unavailable_hardware:
            parser.error('SPS30 is not available; supply --allow-unavailable-hardware only after its arrival')
        if item['type'] == 'ens160':
            if not args.exclusive_ens160:
                parser.error('ENS160 diagnostic resets its mode; stop only its collector and pass --exclusive-ens160')
            active = subprocess.run(['systemctl', 'is-active', '--quiet', 'digitalnose.service'], check=False)
            if active.returncode not in (3,):
                parser.error('Could not confirm the legacy collector is inactive')
        stop = stop_event()
        with file_lock(str(Path(config['state_dir']) / (key + '.acquire.lock')), timeout=0):
            driver = Hardware(item, config, lambda: compensation(config))
            failures = 0
            valid_readings = 0
            try:
                for _ in range(args.samples):
                    if stop.is_set():
                        break
                    started = time.monotonic()
                    try:
                        with deadline():
                            observation = driver.read()
                        if item['type'] != 'ens160':
                            observation.payload('diagnostic_only', key, item['type'], 0)
                        valid_readings += int(observation.valid)
                        print(json.dumps({'sensor_key': key, 'sensor_type': item['type'],
                                          'mux_channel': item.get('mux_channel'), 'address': item.get('address'),
                                          'physical_response': True, **asdict(observation)}, allow_nan=False), flush=True)
                    except Exception as exc:
                        failures += 1
                        log('diagnostic_error', key, item['type'], driver_error=type(exc).__name__,
                            mux_channel=item.get('mux_channel'), address=item.get('address'))
                    stop.wait(max(0, item['interval_seconds'] - (time.monotonic() - started)))
            finally:
                with deadline():
                    driver.close()
            print(json.dumps({'sensor_key': key, 'valid_readings': valid_readings,
                              'errors': failures, 'publishing': False}), flush=True)
            if failures or not valid_readings:
                raise SystemExit(1 if failures else 2)
        return
    if item['type'] == 'ens160':
        parser.error('Use the existing ENS160 services/outbox')
    if args.command in ('collect', 'publish') and not item['enabled']:
        parser.error('Sensor is disabled; enable only after its individual hardware test')
    collector = identifier()
    if args.command == 'queue-status':
        box = open_box(config, key, collector)
        try:
            print(json.dumps(box.stats()))
        finally:
            box.close()
        return
    role = 'acquire' if args.command == 'collect' else 'publish'
    with file_lock(str(Path(config['state_dir']) / (key + '.' + role + '.lock')), timeout=0):
        stop = stop_event()
        if args.command == 'publish':
            if os.environ.get('DIGITALNOSE_SENSOR_PUBLISH') != 'true':
                parser.error('Publishing disabled; explicitly set DIGITALNOSE_SENSOR_PUBLISH=true')
            url, credential = os.environ.get('DIGITALNOSE_SENSOR_INGEST_URL', ''), os.environ.get('DEVICE_API_KEY', '')
            check_credentials(url, credential)
            publish(config, key, open_box(config, key, collector), url, credential, stop)
        else:
            collect(config, key, Hardware(item, config, lambda: compensation(config)),
                    open_box(config, key, collector), stop)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, KeyError) as exc:
        # No tracebacks containing credentials or vendor request internals.
        print(json.dumps({'timestamp': utc_now(), 'event': 'startup_error', 'error_type': type(exc).__name__}), file=sys.stderr)
        raise SystemExit(1)
