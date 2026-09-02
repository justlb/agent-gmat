#!/usr/bin/env bash
sleep 3
base="http://127.0.0.1:3001/api"
echo "== /satellite-library =="
curl -s -o /tmp/sl2.json -w 'HTTP:%{http_code}\n' "$base/satellite-library"
python3 -c "
import json
data = json.load(open('/tmp/sl2.json'))
defs = data.get('definitions', [])
print('definitions:', len(defs))
for d in defs:
    print('-', d.get('id'), '| templates:', len(d.get('mission_templates', [])))
" 2>/dev/null || head -c 300 /tmp/sl2.json
echo
echo "== backend restart log =="
tmux capture-pane -t ocw-backend -p -S -25 2>/dev/null | grep -vE 'fetch failed|ECONNREFUSED|remote-gui|cosyvoice|FunASR|model-api|freecad' | tail -12
