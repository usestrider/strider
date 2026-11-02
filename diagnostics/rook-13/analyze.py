#!/usr/bin/env python3
"""Pair every command by connection, session and ID; summarize attempts without sampling."""
import collections
import json
import gzip
import lzma
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
counts = collections.Counter()
failures = []
for line in (root / 'attempts.ndjson').open():
    row = json.loads(line)
    if row['event'] == 'end':
        counts[(row['server'], row['path'], row['area'], row['exit']['_tag'])] += 1
        if row['exit']['_tag'] != 'Success':
            failures.append(row)
pending = {}
captures = []
frame_events = collections.Counter()
wire = root / 'wire.ndjson'
if wire.exists():
    traffic = wire.open()
elif wire.with_suffix('.ndjson.xz').exists():
    traffic = lzma.open(wire.with_suffix('.ndjson.xz'), 'rt')
else:
    traffic = gzip.open(wire.with_suffix('.ndjson.gz'), 'rt')
for line in traffic:
    row = json.loads(line)
    message = row['message']
    key = (row['connection'], message.get('sessionId'), message.get('id'))
    if row['direction'] == 'out':
        pending[key] = row
    elif 'id' in message:
        sent = pending.pop(key, None)
        if sent and sent['method'] == 'Page.captureScreenshot':
            captures.append({'sent': sent, 'received': row, 'elapsedMs': row['monotonicMs'] - sent['monotonicMs']})
    elif row.get('method') in ['Page.frameResized', 'Page.screencastFrame', 'Page.lifecycleEvent']:
        frame_events[row['method']] += 1
summary = {
    'conditions': [{'server': k[0], 'path': k[1], 'area': k[2], 'exit': k[3], 'count': v} for k, v in sorted(counts.items())],
    'failures': failures,
    'answeredCaptures': len(captures),
    'captureLatencyMs': {'min': min((r['elapsedMs'] for r in captures), default=None), 'max': max((r['elapsedMs'] for r in captures), default=None)},
    'unansweredCaptures': [r for r in pending.values() if r['method'] == 'Page.captureScreenshot'],
    'otherUnansweredCommands': [r for r in pending.values() if r['method'] != 'Page.captureScreenshot'],
    'frameEvents': dict(frame_events),
    'firstAnsweredCapture': captures[:1]
}
print(json.dumps(summary, indent=2))
