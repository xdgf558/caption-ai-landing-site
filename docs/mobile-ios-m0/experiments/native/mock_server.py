"""Loopback-only synthetic MP3 fixture server; never reads production credentials."""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
import json,re,time
ROOT=Path(__file__).resolve().parents[2]
AUDIO=(Path(__file__).parent/'fixture.mp3').read_bytes()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_HEAD(self):self.serve(False)
    def do_GET(self):self.serve(True)
    def serve(self,body):
        if self.path=='/hang':
            time.sleep(12);self.send_response(503);self.end_headers();return
        auth=self.headers.get('Authorization')
        code=200 if auth=='Bearer fixture-a-s1' else (401 if not auth else 403)
        start,end=0,len(AUDIO)-1
        rng=self.headers.get('Range')
        if code==200 and rng:
            m=re.fullmatch(r'bytes=(\d+)-(\d*)',rng)
            if not m:code=416
            else:
                start=int(m[1]);end=min(end,int(m[2]) if m[2] else end)
                code=206 if start<=end else 416
        event={'method':self.command,'authorized':code in (200,206),'range':rng,'status':code,'deliveredBytes':end-start+1 if body and code in (200,206) else 0}
        with (ROOT/'evidence/native-requests.jsonl').open('a') as f:f.write(json.dumps(event)+'\n')
        self.send_response(code);self.send_header('Cache-Control','private, no-store')
        if code in (200,206):
            self.send_header('Content-Type','audio/mpeg');self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1))
            if code==206:self.send_header('Content-Range',f'bytes {start}-{end}/{len(AUDIO)}')
        self.end_headers()
        if body and code in (200,206):
            try:self.wfile.write(AUDIO[start:end+1])
            except (BrokenPipeError,ConnectionResetError):pass
ThreadingHTTPServer(('127.0.0.1',18761),Handler).serve_forever()
