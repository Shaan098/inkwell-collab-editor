"""
RGA (Replicated Growable Array): a sequence CRDT for text.

Every character gets a globally unique id = (lamport_counter, site_id).
An insert says "put this character right after the character with id `ref`"
(ref = None means the start of the document). A delete marks a character as
a tombstone; it is never physically removed, so later operations that point
at it still resolve.

Convergence rule: when several characters were inserted after the same
reference, the one with the LARGER id goes first. While walking right from
the reference we skip every node whose id is larger than the new one. Because
ids come from a Lamport clock, a character that causally follows another
always has a larger id, so every replica ends up with the same order no
matter how operations are delivered.

Operations are plain dicts so they can travel as JSON:
    {'t': 'i', 'id': [counter, site], 'ref': [counter, site] | None, 'ch': 'a'}
    {'t': 'd', 'id': [counter, site]}

apply() is idempotent (duplicates are ignored) and tolerates out-of-order
delivery: an operation whose target is not known yet waits in `pending`
until its dependency arrives.
"""


class Node:
    __slots__ = ('id', 'ch', 'deleted', 'next')

    def __init__(self, id, ch, deleted, next_node=None):
        self.id = id
        self.ch = ch
        self.deleted = deleted
        self.next = next_node


class RGA:
    def __init__(self):
        self.head = Node(None, '', True)  # sentinel, never shown
        self.nodes = {}                   # id tuple -> Node  (O(1) lookup by id)
        self.pending = []                 # ops waiting for a dependency
        self.clock = 0                    # Lamport clock

    # ---------- reading ----------
    def visible(self):
        node = self.head.next
        while node:
            if not node.deleted:
                yield node
            node = node.next

    def text(self):
        return ''.join(n.ch for n in self.visible())

    def __len__(self):
        return sum(1 for _ in self.visible())

    # ---------- applying operations (local or remote) ----------
    def apply(self, op):
        """Apply one op. Returns a list of effects [('insert', index, ch) | ('delete', index)]
        in the order they happened; the index is the visible position at that moment."""
        effects = []
        if self._ready(op):
            effect = self._apply(op)
            if effect:
                effects.append(effect)
            self._drain(effects)
        elif op not in self.pending:
            self.pending.append(op)
        return effects

    def _ready(self, op):
        if op['t'] == 'i':
            return op['ref'] is None or tuple(op['ref']) in self.nodes
        return tuple(op['id']) in self.nodes

    def _drain(self, effects):
        progress = True
        while progress:
            progress = False
            for op in list(self.pending):
                if self._ready(op):
                    self.pending.remove(op)
                    effect = self._apply(op)
                    if effect:
                        effects.append(effect)
                    progress = True

    def _apply(self, op):
        node_id = tuple(op['id'])
        if op['t'] == 'i':
            if node_id in self.nodes:          # duplicate delivery
                return None
            prev = self.head if op['ref'] is None else self.nodes[tuple(op['ref'])]
            while prev.next is not None and prev.next.id > node_id:
                prev = prev.next               # skip concurrent inserts with larger ids
            node = Node(node_id, op['ch'], False, prev.next)
            prev.next = node
            self.nodes[node_id] = node
            self.clock = max(self.clock, node_id[0])
            return ('insert', self._index_of(node), op['ch'])
        node = self.nodes[node_id]
        if node.deleted:
            return None
        index = self._index_of(node)           # position before it disappears
        node.deleted = True
        return ('delete', index)

    def _index_of(self, target):
        index = 0
        node = self.head.next
        while node is not target:
            if not node.deleted:
                index += 1
            node = node.next
        return index

    # ---------- local edits: create ops, apply them, return them ----------
    def local_insert_many(self, index, chars, site):
        ref = None
        if index > 0:
            ref = list(self._visible_at(index - 1).id)
        ops = []
        for ch in chars:
            self.clock += 1
            op = {'t': 'i', 'id': [self.clock, site], 'ref': ref, 'ch': ch}
            self.apply(op)
            ops.append(op)
            ref = op['id']
        return ops

    def local_delete_range(self, index, count):
        targets = []
        for i, node in enumerate(self.visible()):
            if i >= index + count:
                break
            if i >= index:
                targets.append(node)
        ops = [{'t': 'd', 'id': list(n.id)} for n in targets]
        for op in ops:
            self.apply(op)
        return ops

    def _visible_at(self, index):
        for i, node in enumerate(self.visible()):
            if i == index:
                return node
        raise IndexError(index)
