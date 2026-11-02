#!/usr/bin/env python3
import collections
import gzip
import json
import lzma
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
def rows(name):
    path = root / name
    if path.exists():
        source = path.open()
    elif pathlib.Path(str(path) + '.xz').exists():
        source = lzma.open(str(path) + '.xz', 'rt')
    else:
        source = gzip.open(str(path) + '.gz', 'rt')
    with source:
        return [json.loads(line) for line in source]
attempts = rows('attempts.ndjson')
wire = rows('wire.ndjson')
sent = {}
received = {}
for index, row in enumerate(wire):
    message = row['message']
    if 'id' not in message:
        continue
    key = (row['connection'], message.get('sessionId', ''), message['id'])
    if row['direction'] == 'out':
        sent[key] = (index, row)
    else:
        received[key] = (index, row)
counts = collections.Counter()
results = []
for attempt in attempts:
    if attempt['event'] != 'capture-result':
        continue
    counts[(attempt['order'], attempt['resize'], attempt['area'], attempt['capture']['status'])] += 1
    captures = []
    ids = attempt.get('captureIds', [{'id': attempt.get('captureId'), 'sessionId': attempt.get('sessionId')}])
    for capture in ids:
        found = [(key, value) for key, value in sent.items() if key[1:] == (capture['sessionId'], capture['id'])]
        assert len(found) == 1, capture
        key, (position, request) = found[0]
        response = received.get(key)
        same_connection = [(i, r) for i, r in enumerate(wire) if r['connection'] == key[0] and r['direction'] == 'out' and r['message'].get('sessionId', '') == key[1]]
        # Forced navigation is the adjacent outgoing page command, not the initial goto.
        adjacent = [(i, r) for i, r in same_connection if i == position - 1 or i == position + 1]
        nav = next((r for i, r in adjacent if r.get('method') == 'Page.navigate'), None)
        first = request if attempt['order'] == 'capture-navigation' else nav
        second = nav if attempt['order'] == 'capture-navigation' else request
        first_response_before_second = None
        if first is not None and second is not None:
            first_key = (first['connection'], first['message'].get('sessionId', ''), first['message']['id'])
            first_response = received.get(first_key)
            first_response_before_second = first_response is not None and first_response[1]['monotonicMs'] < second['monotonicMs']
        paints = [r for r in wire if r['connection'] == key[0] and r['direction'] == 'in' and r.get('method') == 'Page.lifecycleEvent' and r['message'].get('sessionId', '') == key[1] and r['monotonicMs'] > request['monotonicMs'] and 'Paint' in r['message']['params']['name']]
        frames = [r for r in wire if r['connection'] == key[0] and r.get('method') == 'Page.screencastFrame']
        captures.append({
            'connection': key[0], 'sessionId': key[1], 'captureId': key[2],
            'sentAt': request['at'], 'captureParams': request['message'].get('params'),
            'replyAt': response[1]['at'] if response else None,
            'replyError': response[1]['message'].get('error') if response else None,
            'replyElapsedMs': response[1]['monotonicMs'] - request['monotonicMs'] if response else None,
            'navigationId': nav['message']['id'] if nav else None,
            'navigationSentAt': nav['at'] if nav else None,
            'navigationMinusCaptureMs': nav['monotonicMs'] - request['monotonicMs'] if nav else None,
            'firstReplyBeforeSecondSend': first_response_before_second,
            'paintEventsAfterCapture': len(paints), 'screencastReceipts': len(frames)
        })
    results.append({ 'condition': { k: attempt[k] for k in ['order', 'resize', 'area', 'round'] },
                    'outcome': attempt['capture'], 'captureCommands': captures,
                    'navigation': attempt.get('navigation') })
summary = {
    'counts': [dict(zip(['order', 'resize', 'area', 'status'], key), count=count) for key, count in sorted(counts.items())],
    'setupErrors': [r for r in attempts if r['event'] == 'setup-error'],
    'results': results,
    'unansweredCaptures': [row for key, (index, row) in sent.items() if row.get('method') == 'Page.captureScreenshot' and key not in received],
    'lateCaptureReplies': [capture for r in results for capture in r['captureCommands'] if capture['replyElapsedMs'] is not None and capture['replyElapsedMs'] >= 30000],
    'postTimeoutFrames': [r for r in attempts if r['event'] == 'post-timeout-frame'],
    'wireRecords': len(wire)
}
print(json.dumps(summary, indent=2))
