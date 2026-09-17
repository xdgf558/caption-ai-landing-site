#!/usr/bin/env python3
"""Read repository migrations into memory; never opens a live database or executes cleanup."""
import argparse,hashlib,json,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/mobile-ios-m2/deletion-plan'
DOMAINS={'reader':['migrations','migrations-mobile'],'music':['migrations-music']}
def schema(domain):
    db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
    for directory in DOMAINS[domain]:
        for path in sorted((ROOT/directory).glob('*.sql')):db.executescript(path.read_text())
    return db
def inventory(domain):
    db=schema(domain);result={}
    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        result[name]={'columns':[row[1] for row in db.execute('PRAGMA table_info("'+name+'")')],
          'foreignKeys':[{'id':r[0],'seq':r[1],'column':r[3],'parent':r[2],'parentColumn':r[4],'onDelete':r[6]} for r in db.execute('PRAGMA foreign_key_list("'+name+'")')]}
    db.close();return result

def inspect():
    policy=json.loads((DOC/'policy-draft.json').read_text());domains={d:inventory(d) for d in DOMAINS}
    assert policy['approved'] is False and policy['executionEnabled'] is False, 'This is a review-only draft, not an executor'
    for domain,tables in domains.items():
        classified={}
        for category,rows in policy['tables'][domain].items():
            for table in rows:
                assert table not in classified, 'Duplicate classification: '+table
                assert category in policy['actions'], 'Unknown action: '+category
                classified[table]=category
        assert set(classified)==set(tables), 'Unreviewed schema drift in '+domain+': '+str(set(classified)^set(tables))
        for table,data in tables.items():data['category']=classified[table]
    sources={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for dirs in DOMAINS.values() for directory in dirs for p in sorted((ROOT/directory).glob('*.sql'))}
    return {'kind':'repository-schema-only','liveDataAccess':False,'sources':sources,'databases':domains}

def foreign_key_groups(rows):
    groups={}
    for row in rows:groups.setdefault(row['id'],[]).append(row)
    return [sorted(groups[key],key=lambda row:row['seq']) for key in sorted(groups)]

def render(snapshot):
    lines=['# 销户数据分类矩阵（草案）','','由实际迁移在内存 SQLite 中重建；不是生产数据扫描。分类未批准，无执行入口。','', '| 数据库 / 表 | 拟定处理分类 | 外键删除行为 |','| --- | --- | --- |']
    for domain,tables in snapshot['databases'].items():
        for table,data in tables.items():
            links='；'.join(f"FK {group[0]['id']} ({', '.join(f['column'] for f in group)}) → {group[0]['parent']} ({', '.join(f['parentColumn'] for f in group)})：{group[0]['onDelete']}" for group in foreign_key_groups(data['foreignKeys'])) or '无外键；仍须核对软关联/JSON'
            lines.append(f"| {domain} / `{table}` | `{data['category']}` | {links} |")
    return '\n'.join(lines)+'\n'

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--write',action='store_true');args=parser.parse_args()
    data=inspect();encoded=json.dumps(data,ensure_ascii=False,indent=2)+'\n';matrix=render(data)
    if args.write:
        (DOC/'schema-inventory.json').write_text(encoded);(DOC/'table-matrix.md').write_text(matrix)
    else:
        assert (DOC/'schema-inventory.json').read_text()==encoded, 'Inventory changed; review policy and regenerate'
        assert (DOC/'table-matrix.md').read_text()==matrix, 'Table matrix changed; regenerate'
    print('Reviewed classifications cover '+str(sum(len(t) for t in data['databases'].values()))+' tables; in-memory schema only; cleanup disabled.')
