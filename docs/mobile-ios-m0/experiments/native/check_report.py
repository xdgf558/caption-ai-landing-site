import json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
items=[json.loads(x) for x in (root/'evidence/native-probe.jsonl').read_text().splitlines()]
e={x['event']:x['value'] for x in items}
assert e['item_status']==1
assert e['playing_before_seek'] and e['seek_requested']
assert e['buffered_to']>4 and e['rate_before_stop']==1
assert 0<e['time_before_stop']<4
assert e['hard_stop'] and e['loads_cancelled']
assert next(i for i,x in enumerate(items) if x['event']=='hard_stop')<next(i for i,x in enumerate(items) if x['event']=='late_permission_response')
print('Native media probe assertions passed; Keychain:',e['simulator_keychain_atomic_item'], 'codes:',e['keychain_status_codes'])
print('No device, HTTPS login, D1 or release acceptance implied.')
