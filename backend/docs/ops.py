"""Validation for operations arriving over the websocket (never trust the client)."""
import re

SITE_RE = re.compile(r'^[A-Za-z0-9]{1,16}$')
MAX_OPS_PER_MESSAGE = 1000


def _id(value):
    ok = (
        isinstance(value, (list, tuple)) and len(value) == 2
        and isinstance(value[0], int) and not isinstance(value[0], bool)
        and 0 <= value[0] < 2 ** 53
        and isinstance(value[1], str) and SITE_RE.match(value[1])
    )
    if not ok:
        raise ValueError('bad id')
    return [value[0], value[1]]


def clean_op(op):
    if not isinstance(op, dict):
        raise ValueError('op must be an object')
    kind = op.get('t')
    if kind == 'i':
        ch = op.get('ch')
        if not isinstance(ch, str) or len(ch) != 1:
            raise ValueError('ch must be exactly one character')
        try:
            ch.encode('utf-8')  # rejects lone surrogates that would break the database
        except UnicodeEncodeError:
            raise ValueError('bad character')
        ref = op.get('ref')
        return {'t': 'i', 'id': _id(op.get('id')), 'ref': None if ref is None else _id(ref), 'ch': ch}
    if kind == 'd':
        return {'t': 'd', 'id': _id(op.get('id'))}
    raise ValueError('unknown op type')


def clean_ops(ops):
    if not isinstance(ops, list) or len(ops) > MAX_OPS_PER_MESSAGE:
        raise ValueError('ops must be a list of at most %d items' % MAX_OPS_PER_MESSAGE)
    return [clean_op(o) for o in ops]


def op_key(op):
    """Unique per operation: used by the database to drop duplicate deliveries."""
    return '%s:%d:%s' % (op['t'], op['id'][0], op['id'][1])
