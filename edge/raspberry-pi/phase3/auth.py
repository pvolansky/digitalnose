"""Serialized refresh of an operator-provisioned, dedicated uploader session.

No login/account creation or credential discovery. No service-role key on the Pi.
The operator supplies a private token file after reviewing uploader scope.
"""
import json
import os
from pathlib import Path
import stat
import time
from urllib.request import Request, build_opener

from phase2.bus import file_lock
from .archive import atomic
from .core import canonical


def access_token(path, origin, public_key, opener):
    path = Path(path)
    if path.is_symlink() or stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError('Uploader session file must be private and not a symlink')
    with file_lock(str(path) + '.lock', timeout=2):
        data = json.loads(path.read_text())
        if data['expires_at'] > time.time() + 120:
            return data['access_token']
        body = canonical({'refresh_token': data['refresh_token']}).encode()
        req = Request(origin + '/auth/v1/token?grant_type=refresh_token', data=body, method='POST',
                      headers={'apikey': public_key, 'Content-Type': 'application/json'})
        with opener.open(req, timeout=10) as response:
            raw = response.read(32769)
            if len(raw) > 32768:
                raise ValueError('Auth response too large')
            refreshed = json.loads(raw)
        saved = dict(access_token=refreshed['access_token'], refresh_token=refreshed['refresh_token'],
                     expires_at=time.time() + refreshed['expires_in'])
        # New refresh token is durable before any use of the new access token.
        # Process umask 0077 ensures the atomic replacement remains private.
        atomic(path, canonical(saved).encode())
        os.chmod(path, 0o600)
        return saved['access_token']
