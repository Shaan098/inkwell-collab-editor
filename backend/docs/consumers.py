import re

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

from .models import Document, Operation
from .ops import SITE_RE, clean_ops, op_key

COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


class DocConsumer(AsyncJsonWebsocketConsumer):
    """
    One websocket per open editor tab. The server does not decide anything about
    the text: it validates operations, stores them, and relays them to everyone
    else in the document's group. The CRDT guarantees that all clients converge.

    client -> server: hello {site,name,color} | ops {ops:[...]} | cursor {site,name,color,index}
                      | ping | resync
    server -> client: sync {ops} | ops {ops} | cursor {...} | join {...} | leave {site} | pong {total}

    Channel layers may drop relayed messages when a buffer is full, so delivery is
    not trusted: clients ping periodically, compare `total` with how many operations
    they have, and ask for a `resync` when they are behind (see frontend/src/sync.js).
    """

    async def connect(self):
        self.doc_id = str(self.scope['url_route']['kwargs']['doc_id'])
        self.group = 'doc_' + self.doc_id
        self.site = None
        self.name = 'Guest'
        self.color = '#0e7c86'
        if not await self._doc_exists():
            await self.close(code=4404)
            return
        # Join the group BEFORE sending the snapshot so no live op can fall in the gap.
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if not hasattr(self, 'group'):
            return
        await self.channel_layer.group_discard(self.group, self.channel_name)
        if self.site:
            await self._broadcast({'type': 'leave', 'site': self.site})

    async def receive_json(self, content, **kwargs):
        kind = content.get('type') if isinstance(content, dict) else None
        if kind == 'hello':
            await self._hello(content)
        elif self.site is None:
            await self.send_json({'type': 'error', 'error': 'send hello first'})
        elif kind == 'ping':
            await self.send_json({'type': 'pong', 'total': await self._count()})
        elif kind == 'resync':
            await self.send_json({'type': 'sync', 'ops': await self._all_ops()})
        elif kind == 'ops':
            await self._ops(content)
        elif kind == 'cursor':
            index = content.get('index')
            if isinstance(index, int) and index >= 0:
                await self._broadcast({'type': 'cursor', 'site': self.site, 'name': self.name,
                                       'color': self.color, 'index': index})

    async def _hello(self, content):
        site, name, color = content.get('site'), content.get('name'), content.get('color')
        if not (isinstance(site, str) and SITE_RE.match(site)):
            await self.send_json({'type': 'error', 'error': 'bad site id'})
            return
        self.site = site
        self.name = str(name or 'Guest')[:30]
        self.color = color if isinstance(color, str) and COLOR_RE.match(color) else '#0e7c86'
        await self.send_json({'type': 'sync', 'ops': await self._all_ops()})
        await self._broadcast({'type': 'join', 'site': self.site, 'name': self.name, 'color': self.color})

    async def _ops(self, content):
        try:
            ops = clean_ops(content.get('ops'))
        except ValueError as exc:
            await self.send_json({'type': 'error', 'error': str(exc)})
            return
        if not ops:
            return
        await self._save(ops)  # save first, then relay: DB order always respects causality
        await self._broadcast({'type': 'ops', 'ops': ops})

    # ----- group plumbing -----
    async def _broadcast(self, payload):
        await self.channel_layer.group_send(
            self.group, {'type': 'relay', 'payload': payload, 'sender': self.channel_name})

    async def relay(self, event):
        if event['sender'] != self.channel_name:  # don't echo to the sender
            await self.send_json(event['payload'])

    # ----- database -----
    @database_sync_to_async
    def _doc_exists(self):
        return Document.objects.filter(pk=self.doc_id).exists()

    @database_sync_to_async
    def _count(self):
        return Operation.objects.filter(document_id=self.doc_id).count()

    @database_sync_to_async
    def _all_ops(self):
        return list(Operation.objects.filter(document_id=self.doc_id).values_list('data', flat=True))

    @database_sync_to_async
    def _save(self, ops):
        Operation.objects.bulk_create(
            [Operation(document_id=self.doc_id, key=op_key(op), data=op) for op in ops],
            ignore_conflicts=True,  # a resent op is simply ignored
        )
        Document.objects.filter(pk=self.doc_id).update(updated_at=timezone.now())
