"""Summarize a complete synthetic run; errors are never scored as abstention."""
import collections
import json
import hashlib
import sys
from pathlib import Path

root = Path(sys.argv[1])
run = json.loads((root / 'run.json').read_text())
protocol_bytes = (root / 'protocol.json').read_bytes()
assert hashlib.sha256(protocol_bytes).hexdigest() == run['protocolHash'], 'protocol hash mismatch'
protocol = json.loads(protocol_bytes)
rows = [json.loads(line) for line in (root / 'results.jsonl').read_text().splitlines()]
expected_keys = {(r, c['id'], k['id']) for r in range(protocol['repeats'])
                 for c in protocol['cases'] for k in protocol['conditions']}
keys = {(row['repeat'], row['id'], row['condition']) for row in rows}
assert keys == expected_keys and len(rows) == len(expected_keys), 'incomplete or duplicate run'
print('LIVE observations' if run['live'] else 'FAKE: no quality evidence')
print('Calls:', len(rows), 'Errors:', sum('error' in row for row in rows))
models = {row['result']['model'] for row in rows if 'result' in row}
print('Models:', ', '.join(sorted(models)))
for condition in protocol['conditions']:
    print('\n' + condition['id'])
    correct = total = 0
    for case in protocol['cases']:
        samples = [row for row in rows if row['condition'] == condition['id'] and row['id'] == case['id']]
        labels = collections.Counter()
        probabilities = []
        for row in samples:
            if 'error' in row:
                labels['ERROR'] += 1
                continue
            answer = row['result']['answers']['destination']
            labels[answer['choice']] += 1
            probabilities.append(answer['probabilities'].get(row['expected'], 0))
        unavailable = not samples[0]['scorable']
        if not unavailable:
            total += len(samples)
            correct += sum(row.get('result', {}).get('answers', {}).get('destination', {}).get('choice') == row['expected'] for row in samples)
        extent = f'{min(probabilities):.2f}..{max(probabilities):.2f}' if probabilities else 'no answers'
        print(case['id'], dict(labels), 'expected-p=' + extent,
              '(not scored: underspecified baseline or unavailable outcome)' if unavailable else '')
    print('Expected agreement on representable cases:', correct, '/', total)

groups = collections.defaultdict(list)
for row in rows:
    if 'result' in row:
        groups[row['requestHash']].append(row['result']['answers']['destination'])
print('\nRepeated request groups:', len(groups))
print('Groups with label changes:', sum(len({a['choice'] for a in answers}) > 1 for answers in groups.values()))
print('Groups with distribution changes:', sum(len({json.dumps(a['probabilities'], sort_keys=True) for a in answers}) > 1 for answers in groups.values()))
ranges = [max(a['probabilities'][key] for a in answers) - min(a['probabilities'][key] for a in answers)
          for answers in groups.values() for key in answers[0]['probabilities']]
print('Maximum probability range:', round(max(ranges), 4) if ranges else 'no answers')
