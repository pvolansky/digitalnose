import json
import urllib.request


class CaptureClient:
    def __init__(self, base_url, credential, timeout=15):
        self.base_url, self.credential, self.timeout = base_url.rstrip('/'), credential, timeout

    def request(self, path, method='GET', body=None):
        data = None if body is None else json.dumps(body,separators=(',',':')).encode()
        request = urllib.request.Request(self.base_url+path,data=data,method=method,headers={
            'Authorization':'Bearer '+self.credential,
            **({'Content-Type':'application/json'} if data is not None else {})})
        with urllib.request.urlopen(request,timeout=self.timeout) as response:
            return json.loads(response.read())

    def command(self):
        return self.request('/api/captures/command')

    def event(self, session_id, event, **fields):
        return self.request('/api/captures/command','POST',{'session_id':session_id,'event':event,**fields})

    def measurements(self, session_id, rows):
        return self.request('/api/captures/measurements','POST',{'session_id':session_id,'measurements':rows})

    def cleanup(self, session_id, outcomes, completed_at):
        return self.request('/api/captures/cleanup','POST',{
            'session_id':session_id,'outcomes':outcomes,'completed_at':completed_at})
