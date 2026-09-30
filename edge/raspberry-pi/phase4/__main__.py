import os
import signal
from .client import CaptureClient
from .config import load_config
from .worker import CaptureWorker


def main():
    path = os.environ.get('DIGITALNOSE_PHASE4_CONFIG','/etc/digitalnose/phase4.json')
    credential = os.environ.get('DEVICE_API_KEY','')
    base_url = os.environ.get('DIGITALNOSE_APP_URL','')
    if not credential or not base_url:
        raise ValueError('DEVICE_API_KEY and DIGITALNOSE_APP_URL are required')
    worker = CaptureWorker(load_config(path),CaptureClient(base_url,credential))
    def stop(_signal,_frame): worker.stop = True
    signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
    try: worker.run()
    finally: worker.close()


if __name__ == '__main__': main()
