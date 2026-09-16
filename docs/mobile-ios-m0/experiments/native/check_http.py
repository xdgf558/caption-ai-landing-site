"""Run while mock_server.py is listening. Test identities only."""
import urllib.request,urllib.error,json
from pathlib import Path
rows=[]
for method in ('GET','HEAD'):
    for range_ in (None,'bytes=0-1'):
        for who,header,want in [('missing',None,401),('B','Bearer fixture-b',403),('A-other-session','Bearer fixture-a-s2',403),('A','Bearer fixture-a-s1',206 if range_ else 200)]:
            req=urllib.request.Request('http://127.0.0.1:18761/audio',method=method)
            if header:req.add_header('Authorization',header)
            if range_:req.add_header('Range',range_)
            try:
                with urllib.request.urlopen(req,timeout=5) as r:code=r.status;data=r.read()
            except urllib.error.HTTPError as e:code=e.code;data=e.read()
            assert code==want,(who,method,range_,code,want)
            if code>=400:assert not data
            rows.append({'principal':who,'method':method,'range':range_,'status':code,'pass':True})
(Path(__file__).resolve().parents[2]/'evidence/http-identity-matrix.json').write_text(json.dumps(rows,indent=2))
print(len(rows),'HTTP identity cases passed (loopback fixture, not production)')
