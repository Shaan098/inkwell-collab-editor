import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SyncClient } from './sync';
import { api, wsUrl } from './api';
import { loadIdentity, saveIdentity } from './identity';

// The textarea speaks UTF-16 offsets; the CRDT stores one node per Unicode code point.
const cps = (s) => Array.from(s);
const cpIndex = (text, utf16Offset) => cps(text.slice(0, utf16Offset)).length;
const utf16Offset = (text, cpIdx) => cps(text).slice(0, cpIdx).join('').length;

// What changed between two texts? Common prefix + common suffix = one edit.
function diff(a, b) {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { p, del: a.length - p - s, ins: b.slice(p, b.length - s) };
}

// How does an edit at `index` move a position `pos`?
const shift = (pos, eff) => {
  if (pos === null || pos === undefined) return pos;
  if (eff.type === 'insert') return eff.index < pos ? pos + 1 : pos;
  return eff.index < pos ? pos - 1 : pos;
};

const STATUS = {
  connecting: 'Connecting',
  connected: 'Live',
  reconnecting: 'Offline. Your edits are kept and will sync.',
  missing: 'Page not found',
};

export default function Editor({ docId }) {
  const [me, setMe] = useState(loadIdentity);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('connecting');
  const [peers, setPeers] = useState({});
  const [copied, setCopied] = useState(false);

  const client = useRef(null);       // SyncClient: owns the CRDT, the socket and the resend logic
  const meRef = useRef(me);
  const valueRef = useRef('');
  const peersRef = useRef({});
  const taRef = useRef(null);
  const pendingSel = useRef(null);
  const lastCursor = useRef(0);
  const cursorTimer = useRef(null);

  meRef.current = me;

  const sendCursor = useCallback(() => {
    clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => client.current && client.current.sendCursor(lastCursor.current), 40);
  }, []);

  const setPeerMap = (next) => { peersRef.current = next; setPeers(next); };

  // ----- apply changes that came from other people (already applied to the CRDT) -----
  const applyEffects = useCallback((effects) => {
    const ta = taRef.current;
    const focused = ta && document.activeElement === ta;
    let selS = ta ? cpIndex(ta.value, ta.selectionStart) : 0;
    let selE = ta ? cpIndex(ta.value, ta.selectionEnd) : 0;
    const moved = { ...peersRef.current };
    for (const eff of effects) {
      selS = shift(selS, eff);
      selE = shift(selE, eff);
      for (const site of Object.keys(moved)) moved[site] = { ...moved[site], index: shift(moved[site].index, eff) };
    }
    const next = client.current.rga.text();
    if (next === valueRef.current) return;
    valueRef.current = next;
    if (focused) pendingSel.current = [selS, selE];
    lastCursor.current = selS;
    setPeerMap(moved);
    setText(next);
  }, []);

  // ----- connection: reconnect, resend and self-repair all live in SyncClient -----
  useEffect(() => {
    api.getDoc(docId).then((d) => setTitle(d.title)).catch(() => {});
    const c = new SyncClient({
      url: wsUrl(docId),
      getMe: () => meRef.current,
      onStatus: setStatus,
      onEffects: applyEffects,
      onConnected: sendCursor,
      onReset: () => setPeerMap({}),
      onPeer: (m) => {
        const old = peersRef.current[m.site];
        setPeerMap({ ...peersRef.current, [m.site]: { name: m.name, color: m.color, index: m.index ?? old?.index ?? null } });
        if (m.type === 'join') sendCursor(); // introduce ourselves to the newcomer
      },
      onLeave: (site) => {
        const { [site]: _gone, ...rest } = peersRef.current;
        setPeerMap(rest);
      },
    });
    client.current = c;
    c.start();
    return () => { c.stop(); client.current = null; };
  }, [docId, applyEffects, sendCursor]);

  // ----- the user typed something -----
  function onChange(e) {
    const prev = cps(valueRef.current);
    const next = cps(e.target.value);
    const d = diff(prev, next);
    const { rga } = client.current;
    const ops = [];
    if (d.del > 0) ops.push(...rga.deleteRange(d.p, d.del));
    if (d.ins.length) ops.push(...rga.insertMany(d.p, d.ins, meRef.current.site));
    client.current.sendLocal(ops);
    valueRef.current = rga.text();
    lastCursor.current = cpIndex(e.target.value, e.target.selectionStart);
    setText(valueRef.current);
    sendCursor();
  }

  const onSelect = () => {
    const ta = taRef.current;
    if (!ta) return;
    lastCursor.current = cpIndex(ta.value, ta.selectionStart);
    sendCursor();
  };

  // Restore the caret after a remote change and grow the textarea to fit its text.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    if (pendingSel.current) {
      const [s, e] = pendingSel.current;
      ta.setSelectionRange(utf16Offset(text, s), utf16Offset(text, e));
      pendingSel.current = null;
    }
  }, [text]);

  function rename(patch) {
    const next = { ...me, ...patch };
    setMe(next);
    saveIdentity(next);
    setTimeout(sendCursor, 0);
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }

  // Remote carets are drawn on a hidden mirror of the text that sits under the textarea.
  const caretPeers = Object.entries(peers).filter(([, p]) => p.index !== null && p.index !== undefined).sort((a, b) => a[1].index - b[1].index);
  const chars = cps(text);
  const overlay = [];
  let at = 0;
  for (const [site, p] of caretPeers) {
    const i = Math.min(p.index, chars.length);
    overlay.push(chars.slice(at, i).join(''));
    overlay.push(<span key={site} className="caret" style={{ '--c': p.color }}><span className="flag">{p.name}</span></span>);
    at = i;
  }
  overlay.push(chars.slice(at).join('') + '\u200b');

  const online = Object.entries(peers);

  if (status === 'missing') {
    return <main className="home"><h1>Page not found</h1><p className="lede">This link doesn't match a page. <a href="#/">Go back to your pages</a>.</p></main>;
  }

  return (
    <div className="editor-page">
      <div className="grain" aria-hidden="true" />
      <header className="bar">
        <a className="back" href="#/">Inkwell</a>
        <h1 className="doc-title">{title || 'Untitled'}</h1>
        <span className={`status ${status}`} role="status">{STATUS[status]}</span>
        <div className="who" aria-label="People on this page">
          <span className="dot you" style={{ background: me.color }} title="You" />
          {online.map(([site, p]) => <span key={site} className="dot" style={{ background: p.color }} title={p.name} />)}
          <span className="count">{online.length + 1} here</span>
        </div>
        <button className="btn" onClick={copyLink}>{copied ? 'Link copied ✓' : 'Copy link ↗'}</button>
      </header>

      <div className="identity identity-card">
        <span className="identity-title">You’re writing as</span>
        <label>Your name<input value={me.name} maxLength={30} onChange={(e) => rename({ name: e.target.value })} /></label>
        <label>Colour<input type="color" value={me.color} onChange={(e) => rename({ color: e.target.value })} /></label>
      </div>

      <div className="paper">
        <div className="paper-corner" aria-hidden="true" />
        <div className="mirror" aria-hidden="true">{overlay}</div>
        <textarea
          ref={taRef}
          className="surface"
          value={text}
          onChange={onChange}
          onSelect={onSelect}
          placeholder="Start writing. Anyone with this link can join you."
          aria-label="Document text"
          spellCheck="true"
        />
      </div>
      <p className="editor-footnote"><span>⌁</span> Everyone with the link can write here. Your cursor is the little flag.</p>
    </div>
  );
}
