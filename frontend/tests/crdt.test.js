import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RGA } from '../src/crdt.js';

const typed = (r, i, s, site) => r.insertMany(i, Array.from(s), site);

test('typing and deleting', () => {
  const r = new RGA();
  typed(r, 0, 'hello', 'a');
  r.deleteRange(1, 3);
  assert.equal(r.text(), 'ho');
});

test('concurrent inserts at the same spot converge', () => {
  const a = new RGA(), b = new RGA();
  typed(a, 0, 'ac', 'a').forEach((op) => b.apply(op));
  const opA = typed(a, 1, 'X', 'a');
  const opB = typed(b, 1, 'Y', 'b');
  opB.forEach((op) => a.apply(op));
  opA.forEach((op) => b.apply(op));
  assert.equal(a.text(), b.text());
});

test('duplicates are ignored and reversed delivery still converges', () => {
  const a = new RGA(), b = new RGA();
  const ops = [...typed(a, 0, 'abc', 'a'), ...a.deleteRange(0, 1)];
  [...ops, ...ops].reverse().forEach((op) => b.apply(op));
  assert.equal(b.text(), a.text());
  assert.equal(b.pending.length, 0);
});

test('random concurrent editing converges', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let round = 0; round < 100; round++) {
    const reps = [new RGA(), new RGA(), new RGA()];
    const inbox = [[], [], []];
    for (let s = 0; s < 60; s++) {
      const i = Math.floor(rnd() * 3), r = reps[i];
      const k = Math.floor(rnd() * (inbox[i].length + 1));
      inbox[i].splice(0, k).forEach((op) => r.apply(op));
      const n = r.length;
      const ops = n && rnd() < 0.3
        ? r.deleteRange(Math.floor(rnd() * n), 1)
        : r.insertMany(Math.floor(rnd() * (n + 1)), ['abc'[Math.floor(rnd() * 3)]], 'u' + i);
      reps.forEach((_, j) => { if (j !== i) inbox[j].push(...ops); });
    }
    reps.forEach((r, j) => inbox[j].reverse().forEach((op) => r.apply(op)));
    assert.equal(new Set(reps.map((r) => r.text())).size, 1);
  }
});

test('replays the Python-generated operations to the same text', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/shared_ops.json', import.meta.url)));
  const r = new RGA();
  data.ops.forEach((op) => r.apply(op));
  assert.equal(r.text(), data.expected);
  assert.equal(r.pending.length, 0);
});
