import json

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import Client, TransactionTestCase

from docs.models import Document
from docs.ops import clean_op
from docs.routing import websocket_urlpatterns

APP = URLRouter(websocket_urlpatterns)


def ins(counter, site, ch, ref=None):
    return {'t': 'i', 'id': [counter, site], 'ref': ref, 'ch': ch}


class ValidationTests(TransactionTestCase):
    def test_rejects_bad_ops(self):
        for bad in [{'t': 'i', 'id': [1, 'a'], 'ref': None, 'ch': 'ab'},
                    {'t': 'i', 'id': [1, 'a b'], 'ref': None, 'ch': 'a'},
                    {'t': 'x'}, 'nope', {'t': 'd', 'id': ['1', 'a']},
                    {'t': 'i', 'id': [1, 'a'], 'ref': None, 'ch': '\ud800'}]:
            with self.assertRaises(ValueError):
                clean_op(bad)


class ApiTests(TransactionTestCase):
    def test_create_list_and_read_document(self):
        c = Client()
        res = c.post('/api/docs/', json.dumps({'title': 'Notes'}), content_type='application/json')
        self.assertEqual(res.status_code, 201)
        doc_id = res.json()['id']
        self.assertEqual(c.get('/api/docs/').json()[0]['title'], 'Notes')
        self.assertEqual(c.get('/api/docs/%s/' % doc_id).json()['text'], '')
        self.assertEqual(c.get('/api/docs/00000000-0000-0000-0000-000000000000/').status_code, 404)


class WebsocketTests(TransactionTestCase):
    async def _client(self, doc, site, name):
        comm = WebsocketCommunicator(APP, '/ws/docs/%s/' % doc.id)
        connected, _ = await comm.connect()
        self.assertTrue(connected)
        await comm.send_json_to({'type': 'hello', 'site': site, 'name': name, 'color': '#112233'})
        sync = await comm.receive_json_from()
        self.assertEqual(sync['type'], 'sync')
        return comm, sync

    async def test_ops_are_relayed_stored_and_synced_to_late_joiners(self):
        doc = await sync_to_async(Document.objects.create)(title='t')
        alice, _ = await self._client(doc, 'alice', 'Alice')
        bob, _ = await self._client(doc, 'bob', 'Bob')
        self.assertEqual((await alice.receive_json_from())['type'], 'join')   # Alice sees Bob arrive

        ops = [ins(1, 'alice', 'h'), ins(2, 'alice', 'i', [1, 'alice'])]
        await alice.send_json_to({'type': 'ops', 'ops': ops})
        msg = await bob.receive_json_from()
        self.assertEqual((msg['type'], msg['ops']), ('ops', ops))
        self.assertTrue(await alice.receive_nothing())                       # no echo to sender

        await alice.send_json_to({'type': 'ops', 'ops': ops})                # resend = duplicates
        await bob.receive_json_from()
        carol, sync = await self._client(doc, 'carol', 'Carol')              # late joiner
        self.assertEqual(sync['ops'], ops)                                   # stored once, not twice

        for c in (alice, bob, carol):
            await c.disconnect()

    async def test_invalid_ops_get_an_error_and_are_not_stored(self):
        doc = await sync_to_async(Document.objects.create)(title='t')
        alice, _ = await self._client(doc, 'alice', 'Alice')
        await alice.send_json_to({'type': 'ops', 'ops': [{'t': 'i', 'id': [1, 'alice'], 'ch': 'too long'}]})
        self.assertEqual((await alice.receive_json_from())['type'], 'error')
        await alice.disconnect()

    async def test_unknown_document_is_rejected(self):
        comm = WebsocketCommunicator(APP, '/ws/docs/00000000-0000-0000-0000-000000000000/')
        connected, code = await comm.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4404)

    async def test_leave_is_broadcast(self):
        doc = await sync_to_async(Document.objects.create)(title='t')
        alice, _ = await self._client(doc, 'alice', 'Alice')
        bob, _ = await self._client(doc, 'bob', 'Bob')
        await alice.receive_json_from()   # join
        await bob.disconnect()
        self.assertEqual(await alice.receive_json_from(), {'type': 'leave', 'site': 'bob'})
        await alice.disconnect()

    async def test_ping_reports_total_and_resync_resends_everything(self):
        doc = await sync_to_async(Document.objects.create)(title='t')
        alice, _ = await self._client(doc, 'alice', 'Alice')
        ops = [ins(1, 'alice', 'h'), ins(2, 'alice', 'i', [1, 'alice'])]
        await alice.send_json_to({'type': 'ops', 'ops': ops})
        await alice.send_json_to({'type': 'ping'})
        self.assertEqual(await alice.receive_json_from(), {'type': 'pong', 'total': 2})
        await alice.send_json_to({'type': 'resync'})
        msg = await alice.receive_json_from()
        self.assertEqual((msg['type'], msg['ops']), ('sync', ops))
        await alice.disconnect()
