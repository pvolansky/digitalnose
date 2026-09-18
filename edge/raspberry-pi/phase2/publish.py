"""Network delivery never owns the hardware or runs in acquisition processes."""
import json
import random
import re
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_credentials(url, key):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path != '/api/ingest/sensors'):
        raise ValueError('Use an HTTPS /api/ingest/sensors URL without credentials/query/fragment')
    if not re.fullmatch(r'dn_[A-Za-z0-9_-]{43}', key):
        raise ValueError('Invalid collector credential format')


def upload(url, key, body):
    check_credentials(url, key)
    req = Request(url, data=body, headers={'Authorization': 'Bearer ' + key,
                  'Content-Type': 'application/json'}, method='POST')
    try:
        with build_opener(NoRedirect()).open(req, timeout=10) as response:
            try:
                data = json.loads(response.read(4096))
            except (ValueError, UnicodeError):
                data = None
            return response.status, data
    except HTTPError as exc:
        code = exc.code
        exc.close()
        return code, None


def sync_once(box, url, key, now, sender=upload, jitter=lambda: random.uniform(0, 5)):
    row = box.next(now)
    if row is None:
        return None
    try:
        code, data = sender(url, key, bytes(row['body']))
    except (OSError, ValueError, TimeoutError):
        code, data = 0, None
    accepted = code == 200 and isinstance(data, dict) and data.get('ok') is True and data.get('result') in ('accepted', 'duplicate')
    if accepted:
        box.acknowledge(row)
        state = 'delivered'
    else:
        # 409 is a conflicting payload, NOT the successful duplicate response.
        quarantine = code in (400, 409, 413, 415, 422) or 300 <= code < 400
        delay = min(3600, 2 ** min(row['attempts'] + 1, 12)) + jitter()
        if code in (401, 403, 404):
            delay = 3600 + jitter()
        box.fail(row, code, now + delay, quarantine)
        state = 'quarantined' if quarantine else 'retry'
    return {'sequence_number': row['sequence'], 'http_status': code,
            'retry_state': state, 'attempt': row['attempts'] + 1}
