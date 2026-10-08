import json
import os

from django.test import SimpleTestCase

from docs.crdt import RGA

from .sim import simulate


def typed(rga, index, text, site):
    return rga.local_insert_many(index, list(text), site)


class RGATests(SimpleTestCase):
    def test_typing_and_deleting(self):
        r = RGA()
        typed(r, 0, 'hello', 'a')
        self.assertEqual(r.text(), 'hello')
        r.local_delete_range(1, 3)
        self.assertEqual(r.text(), 'ho')
        typed(r, 1, 'i', 'a')
        self.assertEqual(r.text(), 'hio')

    def test_concurrent_inserts_at_same_spot_converge(self):
        a, b = RGA(), RGA()
        base = typed(a, 0, 'ac', 'a')
        for op in base:
            b.apply(op)
        op_a = typed(a, 1, 'X', 'a')   # both users type between 'a' and 'c'
        op_b = typed(b, 1, 'Y', 'b')
        for op in op_b:
            a.apply(op)
        for op in op_a:
            b.apply(op)
        self.assertEqual(a.text(), b.text())
        self.assertEqual(sorted(a.text()), sorted('aXYc'))

    def test_duplicate_ops_are_ignored(self):
        a, b = RGA(), RGA()
        ops = typed(a, 0, 'hi', 'a')
        for op in ops + ops + ops:
            b.apply(op)
        self.assertEqual(b.text(), 'hi')

    def test_delete_twice_is_harmless(self):
        a, b = RGA(), RGA()
        ops = typed(a, 0, 'abc', 'a')
        dele = a.local_delete_range(1, 1)
        for op in ops + dele + dele:
            b.apply(op)
        self.assertEqual(b.text(), 'ac')

    def test_out_of_order_delivery_waits_for_dependencies(self):
        a, b = RGA(), RGA()
        ops = typed(a, 0, 'abc', 'a') + a.local_delete_range(0, 1)
        for op in reversed(ops):          # worst case: fully reversed
            b.apply(op)
        self.assertEqual(b.text(), a.text())
        self.assertEqual(b.pending, [])

    def test_delete_keeps_later_inserts_anchored(self):
        a, b = RGA(), RGA()
        for op in typed(a, 0, 'ab', 'a'):
            b.apply(op)
        op_b = typed(b, 1, 'Z', 'b')       # b inserts after 'a'
        del_a = a.local_delete_range(0, 1)  # a deletes 'a' at the same time
        for op in op_b:
            a.apply(op)
        for op in del_a:
            b.apply(op)
        self.assertEqual(a.text(), b.text())
        self.assertEqual(a.text(), 'Zb')

    def test_effects_report_visible_index(self):
        r = RGA()
        ops = typed(r, 0, 'abc', 'a')
        other = RGA()
        effects = [e for op in ops for e in other.apply(op)]
        self.assertEqual(effects, [('insert', 0, 'a'), ('insert', 1, 'b'), ('insert', 2, 'c')])
        self.assertEqual(other.apply(r.local_delete_range(1, 1)[0]), [('delete', 1)])

    def test_unicode_characters(self):
        a, b = RGA(), RGA()
        for op in typed(a, 0, 'hi 👋 नमस्ते', 'a'):
            b.apply(op)
        self.assertEqual(b.text(), 'hi 👋 नमस्ते')

    def test_random_concurrent_editing_always_converges(self):
        for seed in range(200):
            reps, _ = simulate(seed)
            texts = {r.text() for r in reps}
            self.assertEqual(len(texts), 1, 'seed %d diverged: %r' % (seed, texts))
            self.assertTrue(all(r.pending == [] for r in reps), 'seed %d left pending ops' % seed)

    def test_shared_fixture_replays_to_expected_text(self):
        path = os.path.join(os.path.dirname(__file__), 'fixtures', 'shared_ops.json')
        with open(path) as f:
            data = json.load(f)
        r = RGA()
        for op in data['ops']:
            r.apply(op)
        self.assertEqual(r.text(), data['expected'])
        self.assertEqual(r.pending, [])
