// RGA text CRDT. Same algorithm and operation format as backend/docs/crdt.py;
// both are tested against tests/fixtures/shared_ops.json so they cannot drift apart.
//
// op = { t: 'i', id: [counter, site], ref: [counter, site] | null, ch }   (insert after ref)
//    | { t: 'd', id: [counter, site] }                                    (delete = tombstone)

const key = (id) => id[0] + ':' + id[1];
const greater = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);

export const opKey = (op) => op.t + ':' + key(op.id);

export class RGA {
  constructor() {
    this.head = { id: null, ch: '', deleted: true, next: null }; // sentinel
    this.nodes = new Map(); // id key -> node  (O(1) lookup by id)
    this.pending = [];      // ops waiting for a dependency
    this.clock = 0;         // Lamport clock
  }

  *visible() {
    for (let n = this.head.next; n; n = n.next) if (!n.deleted) yield n;
  }

  text() {
    let s = '';
    for (const n of this.visible()) s += n.ch;
    return s;
  }

  get length() {
    let c = 0;
    for (const _ of this.visible()) c++;
    return c;
  }

  // Apply one op (local or remote). Idempotent. Returns effects:
  // [{type:'insert', index, ch} | {type:'delete', index}] with visible indexes.
  apply(op) {
    const effects = [];
    if (this._ready(op)) {
      const e = this._apply(op);
      if (e) effects.push(e);
      this._drain(effects);
    } else if (!this.pending.some((p) => opKey(p) === opKey(op))) {
      this.pending.push(op);
    }
    return effects;
  }

  _ready(op) {
    if (op.t === 'i') return op.ref === null || this.nodes.has(key(op.ref));
    return this.nodes.has(key(op.id));
  }

  _drain(effects) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const op of [...this.pending]) {
        if (this._ready(op)) {
          this.pending.splice(this.pending.indexOf(op), 1);
          const e = this._apply(op);
          if (e) effects.push(e);
          progress = true;
        }
      }
    }
  }

  _apply(op) {
    const k = key(op.id);
    if (op.t === 'i') {
      if (this.nodes.has(k)) return null; // duplicate delivery
      let prev = op.ref === null ? this.head : this.nodes.get(key(op.ref));
      while (prev.next && greater(prev.next.id, op.id)) prev = prev.next; // skip larger concurrent ids
      const node = { id: op.id, ch: op.ch, deleted: false, next: prev.next };
      prev.next = node;
      this.nodes.set(k, node);
      this.clock = Math.max(this.clock, op.id[0]);
      return { type: 'insert', index: this._indexOf(node), ch: op.ch };
    }
    const node = this.nodes.get(k);
    if (node.deleted) return null;
    const index = this._indexOf(node);
    node.deleted = true;
    return { type: 'delete', index };
  }

  _indexOf(target) {
    let i = 0;
    for (let n = this.head.next; n !== target; n = n.next) if (!n.deleted) i++;
    return i;
  }

  // ----- local edits: build ops, apply them, return them -----
  insertMany(index, chars, site) {
    let ref = null;
    if (index > 0) {
      let i = 0;
      for (const n of this.visible()) {
        if (i++ === index - 1) { ref = n.id; break; }
      }
    }
    const ops = [];
    for (const ch of chars) {
      const op = { t: 'i', id: [++this.clock, site], ref, ch };
      this.apply(op);
      ops.push(op);
      ref = op.id;
    }
    return ops;
  }

  deleteRange(index, count) {
    const targets = [];
    let i = 0;
    for (const n of this.visible()) {
      if (i >= index + count) break;
      if (i >= index) targets.push(n);
      i++;
    }
    const ops = targets.map((n) => ({ t: 'd', id: n.id }));
    ops.forEach((op) => this.apply(op));
    return ops;
  }
}
