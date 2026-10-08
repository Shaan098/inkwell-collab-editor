"""Writes the ops file that BOTH the Python and JavaScript CRDTs must replay to the same text.
Run from backend/:  python -m docs.tests.gen_fixture"""
import json
import os
import random

from .sim import simulate

reps, ops = simulate(seed=2026, replicas=4, steps=250)
expected = reps[0].text()
assert all(r.text() == expected for r in reps)
random.Random(7).shuffle(ops)  # arbitrary delivery order on purpose
path = os.path.join(os.path.dirname(__file__), 'fixtures', 'shared_ops.json')
with open(path, 'w') as f:
    json.dump({'expected': expected, 'ops': ops}, f)
print('wrote', path, len(ops), 'ops ->', repr(expected))
