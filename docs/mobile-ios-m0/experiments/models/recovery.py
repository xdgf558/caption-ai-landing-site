"""M0 local fault models. SQLite, atomic files and fake credentials; NOT D1/Keychain/auth implementation."""
import copy, hashlib, json, os, secrets, sqlite3
from pathlib import Path

class Failure(Exception): pass

def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()

def atomic_save(path, value, fail=False):
    if fail: raise Failure('STORE_UNAVAILABLE')
    tmp = Path(str(path)+'.pending-write')
    with tmp.open('w') as f:
        json.dump(value, f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp,path)

def load(path): return json.loads(Path(path).read_text())

class RefreshServer:
    def __init__(self,path):
        self.db=sqlite3.connect(path,timeout=10)
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS family(id TEXT PRIMARY KEY, gen INTEGER, current_hash TEXT, revoked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS operations(old_hash TEXT PRIMARY KEY, request TEXT, body_hash TEXT, gen INTEGER, replay_until REAL, result TEXT);
        ''')
        self.db.execute('INSERT OR IGNORE INTO family VALUES(?,?,?,0)',('f',0,digest('fixture-old')));self.db.commit()
    def refresh(self,token,request='r',body='canonical-v1',now=0,fail=None,expected=None):
        # Test-only result storage is plaintext fake data. Production must encrypt replay payloads.
        h=digest(token)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            gen,current,revoked=self.db.execute('SELECT gen,current_hash,revoked FROM family WHERE id="f"').fetchone()
            old=self.db.execute('SELECT request,body_hash,gen,replay_until,result FROM operations WHERE old_hash=?',(h,)).fetchone()
            if revoked: raise Failure('REVOKED')
            if old:
                if old[0]!=request:
                    self.db.execute('UPDATE family SET revoked=1 WHERE id="f"');self.db.commit();raise Failure('REUSE')
                if old[1]!=digest(body): raise Failure('MISMATCH')
                if old[2]!=gen: raise Failure('SUPERSEDED')
                if now>=old[3] or old[4] is None: raise Failure('RECOVERY_EXPIRED')
                result=json.loads(old[4]);self.db.commit();return result
            if h!=current: raise Failure('UNKNOWN_TOKEN')
            new=secrets.token_hex(16)
            result={'token':new,'generation':gen+1,'session':'s','request':request,'replayUntil':now+120}
            changed=self.db.execute('UPDATE family SET gen=?,current_hash=? WHERE id="f" AND gen=? AND revoked=0',(gen+1,digest(new),gen if expected is None else expected)).rowcount
            if changed!=1: raise Failure('CAS_MISS')
            if fail=='after_cas': raise Failure('INJECTED')
            self.db.execute('INSERT INTO operations VALUES(?,?,?,?,?,?)',(h,request,digest(body),gen+1,now+120,json.dumps(result)))
            if fail=='after_result': raise Failure('INJECTED')
            self.db.commit();return result
        except Exception:
            self.db.rollback();raise

class RefreshClient:
    def __init__(self,path): self.path=path
    def prepare(self,fail=False):
        e=load(self.path)
        if not e.get('pending'):
            e['pending']={'request':'fixed-operation','generation':e['generation'],'body':'canonical-v1'}
            atomic_save(self.path,e,fail)
        return e
    def save_result(self,e,result,fail=False):
        current=load(self.path)
        if current!=e or result['session']!=e['session'] or result['generation']!=e['generation']+1 or result['request']!=e['pending']['request']:
            raise Failure('STALE_RESPONSE')
        atomic_save(self.path,{'token':result['token'],'generation':result['generation'],'session':'s','pending':None},fail)

class DeletionServer:
    def __init__(self,path):
        new_database=not Path(path).exists()
        self.db=sqlite3.connect(path)
        self.db.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS account(id TEXT PRIMARY KEY, active INTEGER);
        CREATE TABLE IF NOT EXISTS session(id TEXT PRIMARY KEY, active INTEGER);
        CREATE TABLE IF NOT EXISTS deletion(id TEXT PRIMARY KEY, account TEXT UNIQUE, receipt_hash TEXT, status TEXT, prepare_id TEXT, confirm_id TEXT, prepare_until REAL, receipt_until REAL);
        CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, sent INTEGER DEFAULT 0);
        ''')
        if new_database:
            with self.db:
                self.db.execute("INSERT INTO account VALUES('a',1)")
                self.db.execute("INSERT INTO session VALUES('s',1)")
    def prepare(self,receipt,request='d',prepare='p',now=0):
        old=self.db.execute('SELECT id,receipt_hash,prepare_id FROM deletion WHERE account="a"').fetchone()
        if old:
            if old!=(request,digest(receipt),prepare): raise Failure('PREPARATION_EXISTS')
            return
        with self.db:
            self.db.execute('INSERT INTO deletion VALUES(?,?,?,?,?,?,?,?)',(request,'a',digest(receipt),'prepared',prepare,None,now+600,now+1209600))
    def confirm(self,request='d',op='c',now=0,fail=None):
        with self.db:
            if not self.db.execute('SELECT active FROM session').fetchone()[0]: raise Failure('UNAUTHORIZED')
            row=self.db.execute('SELECT status,prepare_until FROM deletion WHERE id=?',(request,)).fetchone()
            if row is None or row[0]!='prepared' or now>=row[1]: raise Failure('PREPARATION_EXPIRED')
            self.db.execute('UPDATE deletion SET status="accepted",confirm_id=? WHERE id=?',(op,request))
            self.db.execute('UPDATE account SET active=0');self.db.execute('UPDATE session SET active=0')
            if fail: raise Failure('INJECTED')
            self.db.execute('INSERT INTO outbox(id) VALUES(?)',(request,))
    def status(self,receipt,request='d',now=0,fail=False):
        if fail: raise Failure('UNAVAILABLE')
        row=self.db.execute('SELECT receipt_hash,status,prepare_until,receipt_until FROM deletion WHERE id=?',(request,)).fetchone()
        if not row or row[0]!=digest(receipt) or now>=row[3]: raise Failure('NOT_FOUND')
        state='preparation_expired' if row[1]=='prepared' and now>=row[2] else row[1]
        return {'id':request,'status':state,'confirmAccepted':state not in ('prepared','preparation_expired')}

class DeadlinePlayer:
    def __init__(self):
        self.deadline=None; self.playing=False; self.item=False; self.pending_loads=0; self.sequence=0; self.needs_user=False
    def install(self,server_now,valid_until,t0,t1,sequence=0,session='s'):
        if session!='s' or sequence!=self.sequence or server_now is None or valid_until is None: return False
        budget=max(0,valid_until-server_now-(t1-t0)-2)
        if budget<=0: return False
        self.deadline=t1+budget;self.item=True
        return True
    def start(self):
        if self.item: self.playing=True;self.needs_user=False
    def stop(self):
        self.playing=False;self.item=False;self.pending_loads=0;self.needs_user=True
    def tick(self,continuous):
        if self.deadline is not None and continuous>=self.deadline: self.stop()
    def deny(self): self.sequence+=1;self.stop()
    def soft_failure(self,kind): pass # must not renew a hard budget

def media_decision(grant,bearer,method='GET',now=0,available=True):
    if method not in ('GET','HEAD'): return 405
    if not available: return 503
    if now>=grant['until']: return 410
    if bearer is not None and bearer.get('invalid'): return 401
    if grant['mode']=='public': return 200 if grant['policy'] in ('free','preview') else 403
    if grant['mode']!='session_bearer': return 403
    if bearer is None: return 401
    if (bearer['account'],bearer['session'])!=(grant['account'],grant['session']): return 403
    return 200
