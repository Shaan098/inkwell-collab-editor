// Live end-to-end check against a RUNNING server (node 22+). Uses the SAME SyncClient the browser UI uses.
//   cd backend && python manage.py runserver 8000      (terminal 1)
//   node scripts/e2e_check.mjs                         (terminal 2)
// Optional stress: start the server with CHANNEL_CAPACITY=5 to force the relay to drop messages.
import { SyncClient } from '../frontend/src/sync.js';

const HTTP = process.env.HTTP || 'http://localhost:8000';
const WS = HTTP.replace('http', 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 99;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const doc = await (await fetch(`${HTTP}/api/docs/`, { method: 'POST', body: '{"title":"e2e"}', headers: { 'Content-Type': 'application/json' } })).json();

function user(site) {
  const c = new SyncClient({ url: `${WS}/ws/docs/${doc.id}/`, getMe: () => ({ site, name: site, color: '#112233' }), heartbeatMs: 400 });
  c.site = site;
  c.start();
  return c;
}
function edit(c) {
  const n = c.rga.length;
  const ops = n > 3 && rnd() < 0.25
    ? c.rga.deleteRange(Math.floor(rnd() * n), 1 + Math.floor(rnd() * 2))
    : c.rga.insertMany(Math.floor(rnd() * (n + 1)), Array.from('ab😀cd').slice(0, 1 + Math.floor(rnd() * 4)), c.site);
  c.sendLocal(ops);
}
const connected = async (cs) => { while (!cs.every((c) => c.status === 'connected')) await sleep(50); };
const texts = (cs) => cs.map((c) => c.rga.text());
const same = (cs) => new Set(texts(cs)).size === 1;

const [a, b, c] = ['alice', 'bob', 'carol'].map(user);
await connected([a, b, c]);

console.log('1) three users type at the same time...');
for (let i = 0; i < 80; i++) { [a, b, c].forEach(edit); await sleep(4); }
await sleep(2500); // heartbeats repair anything the relay dropped
console.log('   converged:', same([a, b, c]), '| length', a.rga.length, '| self-repairs:', a.resyncs + b.resyncs + c.resyncs);

console.log('2) carol loses her connection, everyone keeps typing, carol comes back...');
c.ws.close();
await sleep(50);
for (let i = 0; i < 30; i++) { [a, b, c].forEach(edit); await sleep(4); }
await connected([a, b, c]);
await sleep(2500);
console.log('   converged:', same([a, b, c]), '| length', a.rga.length);

console.log('3) a brand-new visitor and the REST API agree with everyone...');
const d = user('dave');
await connected([d]);
const rest = (await (await fetch(`${HTTP}/api/docs/${doc.id}/`)).json()).text;
const everyone = [...texts([a, b, c, d]), rest];
const allSame = new Set(everyone).size === 1;
console.log('   all five views identical:', allSame);

[a, b, c, d].forEach((u) => u.stop());
const ok = same([a, b, c]) && allSame;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
