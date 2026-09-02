#!/usr/bin/env bash
for f in /mnt/d/STAGE/agent-gmat-main/data/satellite-library/*.json; do
  echo "== $f =="
  python3 -c "
import json,io
raw = open('$f', encoding='utf-8-sig').read()
d = json.loads(raw)
print('id:', d.get('id'), '| version:', d.get('version'))
print('mission_templates:', json.dumps(d.get('mission_templates'), indent=1))
"
done
