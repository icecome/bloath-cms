import re
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.dirname(SCRIPT_DIR)

with open(os.path.join(WORKER_DIR, 'export.sql'), 'r', encoding='utf-8') as f:
    lines = f.readlines()

filtered = []
for l in lines:
    if not l.startswith('INSERT INTO'):
        continue
    m = re.search(r'INSERT INTO "?(\w+)"?', l)
    if m:
        tbl = m.group(1)
        if tbl in ('d1_migrations', '_cf_KV', 'sqlite_sequence'):
            continue
    filtered.append(l)

outdir = os.path.join(WORKER_DIR, 'data_split')
os.makedirs(outdir, exist_ok=True)

by_table = {}
for l in filtered:
    m = re.search(r'INSERT INTO "?(\w+)"?', l)
    if m:
        tbl = m.group(1)
        by_table.setdefault(tbl, []).append(l)

for tbl, tbl_lines in by_table.items():
    path = os.path.join(outdir, f'{tbl}.sql')
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(tbl_lines)
    print(f'{tbl}: {len(tbl_lines)} lines')
