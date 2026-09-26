"""Private Supabase Storage with mandatory full readback; no delete capability."""
import hashlib
import json
import os
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .archive import verify
from .core import canonical, now, safe_component


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Supabase:
    def __init__(self, url, key, token, bucket='digitalnose-raw'):
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
            raise ValueError('Expected HTTPS Supabase origin')
        if not key or not token:
            raise ValueError('Missing scoped archive credentials')
        self.url, self.key, self.token = url.rstrip('/'), key, token
        self.bucket = safe_component(bucket)
        self.opener = build_opener(NoRedirect())

    @classmethod
    def environment(cls):
        token_file = os.environ.get('PHASE3_SESSION_FILE')
        obj = cls(os.environ['PHASE3_SUPABASE_URL'], os.environ['PHASE3_SUPABASE_KEY'],
                  os.environ.get('PHASE3_ACCESS_TOKEN', '') or ('token-file' if token_file else ''),
                  os.environ.get('PHASE3_BUCKET', 'digitalnose-raw'))
        if token_file:
            from .auth import access_token
            obj.token = lambda: access_token(token_file, obj.url, obj.key, obj.opener)
        return obj

    def request(self, method, path, body=None, content_type='application/json', limit=32*1024*1024):
        req = Request(self.url + path, data=body, method=method, headers={
            'apikey': self.key, 'Authorization': 'Bearer ' + (self.token() if callable(self.token) else self.token),
            'Content-Type': content_type})
        with self.opener.open(req, timeout=30) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError('Remote response exceeds size bound')
            return data

    def path(self, key):
        if '..' in key.split('/') or key.startswith('/'):
            raise ValueError('Invalid object path')
        return '/storage/v1/object/' + self.bucket + '/' + quote(key, safe='/=')

    def put(self, key, body):
        try:
            self.request('POST', self.path(key), body, 'application/octet-stream')
        except HTTPError as exc:
            # Duplicate is not success until GET/hash comparison below. Other 400s
            # also proceed to GET, which must prove the exact intended object exists.
            code = exc.code
            exc.close()
            if code not in (400, 409):
                raise

    def get(self, key):
        return self.request('GET', self.path(key))

    def rpc(self, name, payload):
        safe_component(name)
        return self.request('POST', '/rest/v1/rpc/' + name, canonical(payload).encode())


def upload_one(spool, remote):
    item = spool.db.execute('SELECT * FROM parts WHERE verified_at IS NULL ORDER BY attempts,key LIMIT 1').fetchone()
    if item is None:
        return False
    manifest = json.loads(item['manifest'])
    key = item['key']
    try:
        path = spool.root / key
        verify(path, manifest)
        body = path.read_bytes()
        remote.put(key, body)
        downloaded = remote.get(key)
        if hashlib.sha256(downloaded).hexdigest() != manifest['sha256']:
            raise ValueError('Remote archive checksum mismatch')
        # Exact byte equivalence to locally read-back-verified Parquet.
        manifest_body = canonical(manifest).encode()
        remote.put(key + '.manifest.json', manifest_body)
        if remote.get(key + '.manifest.json') != manifest_body:
            raise ValueError('Remote manifest mismatch')
        for session in manifest['session_ids']:
            row = spool.db.execute('SELECT body FROM sessions WHERE id=?', (session,)).fetchone()
            if row is None:
                raise ValueError('Missing archive session provenance')
            session_key = f"sessions/device={manifest['device_id']}/{session}.json"
            remote.put(session_key, row[0].encode())
            if remote.get(session_key) != row[0].encode():
                raise ValueError('Remote session mismatch')
        with spool.db:
            spool.db.execute('UPDATE parts SET verified_at=?,last_error=NULL,attempts=attempts+1 WHERE key=?', (now(), key))
    except Exception as exc:
        with spool.db:
            # Store exception class only: provider exception text may contain credentials.
            spool.db.execute('UPDATE parts SET last_error=?,attempts=attempts+1 WHERE key=?', (type(exc).__name__, key))
        raise
    return True


def publish_summary(spool, remote):
    row = spool.db.execute('SELECT * FROM summaries WHERE published_revision<revision ORDER BY minute LIMIT 1').fetchone()
    if not row:
        return False
    payload = json.loads(row['body'])
    payload['revision'] = row['revision']
    response = json.loads(remote.rpc('phase3_put_summary', {'payload': payload}))
    if response != {'ok': True}:
        raise ValueError('Summary acknowledgement not verified')
    with spool.db:
        spool.db.execute('UPDATE summaries SET published_revision=? WHERE device=? AND sensor=? AND minute=? AND revision=?',
                         (row['revision'], row['device'], row['sensor'], row['minute'], row['revision']))
    return True
