# Inkwell: real-time collaborative text editor

Open a page, share the link, and write together. Edits from different people merge
automatically, even when two people type in the same spot at the same time, or when
someone goes offline and comes back.

Stack: React (Vite), Django, Django Channels (WebSockets), SQLite. The merging is done by a
CRDT written from scratch (no Yjs or Automerge)

## How it works

**The CRDT (RGA, "replicated growable array").** Every character has a unique id
`(lamport_counter, site_id)`. An insert means "put this character right after character X".
A delete leaves a tombstone instead of removing the character, so later operations that point
at it still make sense. When two people insert after the same character, the larger id goes
first, so every replica ends up in the same order no matter in which order operations arrive.
Operations are idempotent (duplicates are ignored) and one that arrives before its dependency
waits in a pending list until the dependency shows up.

**The server is deliberately simple.** It validates operations, stores them in an append-only
log (the document is that log), and relays them to everyone else in the document's group. It
makes no decisions about the text, because the CRDT guarantees all clients converge.

**Reliability.**
- Local edits apply instantly, so typing never waits for the network.
- Every operation a tab created is remembered. After a reconnect, anything the server doesn't
  have is re-sent, so offline edits are never lost.
- Channel layers can drop relayed messages when a buffer fills up (found and fixed while
  testing). Clients ping the server every few seconds, compare operation counts, and ask for a
  full resync if they are behind.
- The same algorithm exists in Python (`backend/docs/crdt.py`) and JavaScript
  (`frontend/src/crdt.js`) and both are tested against one shared file of operations.

```
 React textarea ──edits──> RGA (JS) ──ops──> WebSocket ──> Django Channels consumer
        ^                                                      |  validate, save to DB, relay
        └────────── remote ops <── WebSocket <── group ────────┘
```

## Run it locally (Node 18+, Python 3.10+)

Backend (terminal 1):
```bash
cd backend
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

Frontend (terminal 2):
```bash
cd frontend
npm install
npm run dev          # open http://localhost:5173
```

Try it: start a page, copy the link, open it in a second browser window (or a private window),
and type in both. Turn off Wi-Fi in one window, keep typing, and turn it back on.

## Tests
```bash
cd backend && python manage.py test docs     # 17 tests incl. 200 randomized convergence runs
cd frontend && npm test                      # 5 tests, replays the same operations as Python
node scripts/e2e_check.mjs                   # live check against a running server
```
The live check runs three simulated users typing at once, one losing her connection, and a late
joiner. To stress the repair logic, start the server with `CHANNEL_CAPACITY=3` so it drops
messages on purpose, then run the script again.

## Deploy
- Backend (Render, Railway, Fly): `pip install -r requirements.txt`, then
  `python manage.py migrate && daphne -b 0.0.0.0 -p $PORT collab.asgi:application`.
  Set `SECRET_KEY`, `DEBUG=0`, and `ALLOWED_HOSTS`. SQLite resets on free tiers that wipe disk;
  mount a volume and set `SQLITE_PATH`, or switch `DATABASES` to Postgres.
  For more than one server process set `REDIS_URL` and install `channels-redis`.
- Frontend (Vercel/Netlify): root `frontend`, set `VITE_API_URL=https://<backend>` and
  `VITE_WS_URL=wss://<backend>`.

## Known limits (good things to mention honestly)
- Tombstones are never garbage-collected, so very long editing histories grow.
- Finding a character by position walks the list: O(n) per edit. Fine for documents of tens of
  thousands of characters; a balanced tree or skip list would be the next step.
- Loading a document replays its whole operation log; snapshots would fix that.
- No login: anyone with a link can edit. Page ids are random UUIDs.
- Cursors are shared as character positions; text formatting is out of scope.
