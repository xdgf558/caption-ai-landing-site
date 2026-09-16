import os,sys
from recovery import RefreshClient,RefreshServer
path,db,point=sys.argv[1:]
c=RefreshClient(path); e=c.prepare()
if point=='prepared': os._exit(71)
r=RefreshServer(db).refresh(e['token'],e['pending']['request'])
if point in ('committed','received'): os._exit(72)
c.save_result(e,r)
if point=='saved': os._exit(73)
