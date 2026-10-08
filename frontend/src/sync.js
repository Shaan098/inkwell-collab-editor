// Everything about talking to the server, with no React in it, so the browser UI and the
// Node end-to-end script (scripts/e2e_check.mjs) run exactly the same code.
//
// Guarantees:
//  * local edits apply instantly and are never lost: every op this tab created is kept in
//    `mine` and re-sent after a reconnect if the server does not have it;
//  * the connection reconnects by itself with exponential backoff;
//  * delivery is not trusted: a heartbeat compares our operation count with the server's
//    and asks for a full resync when we are behind (repairs messages dropped by the relay).
import { RGA, opKey } from './crdt.js';

export class SyncClient {
  constructor({ url, getMe, onStatus, onEffects, onPeer, onLeave, onConnected, onReset, WebSocketImpl, heartbeatMs = 4000 }) {
    Object.assign(this, { url, getMe, WebSocketImpl, heartbeatMs });
    this.onStatus = onStatus || (() => {});
    this.onEffects = onEffects || (() => {});
    this.onPeer = onPeer || (() => {});
    this.onLeave = onLeave || (() => {});
    this.onConnected = onConnected || (() => {});
    this.onReset = onReset || (() => {});
    this.rga = new RGA();
    this.mine = [];          // every op created in this tab
    this.seen = new Set();   // keys of every op applied, pending or created here
    this.status = 'connecting';
    this.resyncs = 0;
    this.ws = null;
    this.closed = false;
    this.retry = 0;
  }

  start() { this.closed = false; this._connect(); }

  stop() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    if (this.ws) this.ws.close();
  }

  // Call with the ops returned by rga.insertMany / rga.deleteRange.
  sendLocal(ops) {
    if (!ops.length) return;
    for (const op of ops) this.seen.add(opKey(op));
    this.mine.push(...ops);
    if (this.status === 'connected') this._send({ type: 'ops', ops });
  }

  sendCursor(index) {
    const { site, name, color } = this.getMe();
    this._send({ type: 'cursor', site, name, color, index });
  }

  _setStatus(s) {
    if (this.status !== s) { this.status = s; this.onStatus(s); }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  _connect() {
    const WS = this.WebSocketImpl || globalThis.WebSocket;
    const sock = new WS(this.url);
    this.ws = sock;
    sock.onopen = () => {
      const { site, name, color } = this.getMe();
      this._send({ type: 'hello', site, name, color });
    };
    sock.onmessage = (e) => this._handle(JSON.parse(e.data));
    sock.onclose = (ev) => {
      if (this.ws !== sock) return; // an old socket closing late
      clearInterval(this.heartbeat);
      if (this.closed) return;
      if (ev.code === 4404) { this._setStatus('missing'); return; }
      this._setStatus('reconnecting');
      this.onReset();
      this.timer = setTimeout(() => this._connect(), Math.min(1000 * 2 ** this.retry++, 10000));
    };
  }

  _receive(ops) {
    const effects = [];
    for (const op of ops) {
      this.seen.add(opKey(op));
      effects.push(...this.rga.apply(op));
    }
    if (effects.length) this.onEffects(effects);
  }

  _handle(m) {
    if (m.type === 'sync') {
      this._receive(m.ops);
      const have = new Set(m.ops.map(opKey));
      const missing = this.mine.filter((o) => !have.has(opKey(o)));
      if (missing.length) this._send({ type: 'ops', ops: missing }); // the server never got these
      this.retry = 0;
      this._setStatus('connected');
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this._send({ type: 'ping' }), this.heartbeatMs);
      this.onConnected();
    } else if (m.type === 'ops') {
      this._receive(m.ops);
    } else if (m.type === 'pong') {
      if (m.total > this.seen.size) { this.resyncs++; this._send({ type: 'resync' }); }
    } else if (m.type === 'cursor' || m.type === 'join') {
      this.onPeer(m);
    } else if (m.type === 'leave') {
      this.onLeave(m.site);
    }
  }
}
