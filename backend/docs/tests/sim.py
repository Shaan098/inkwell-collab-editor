"""Shared simulation helper: N replicas edit concurrently, ops are delivered late and out of order."""
import random

from docs.crdt import RGA


def simulate(seed, replicas=3, steps=80, alphabet='abcde'):
    rnd = random.Random(seed)
    reps = [RGA() for _ in range(replicas)]
    sites = ['u%d' % i for i in range(replicas)]
    inbox = [[] for _ in range(replicas)]
    all_ops = []
    for _ in range(steps):
        i = rnd.randrange(replicas)
        rep = reps[i]
        rnd.shuffle(inbox[i])
        k = rnd.randint(0, len(inbox[i]))
        for op in inbox[i][:k]:
            rep.apply(op)
        inbox[i] = inbox[i][k:]
        n = len(rep)
        if n and rnd.random() < 0.3:
            ops = rep.local_delete_range(rnd.randrange(n), 1)
        else:
            ops = rep.local_insert_many(rnd.randint(0, n), [rnd.choice(alphabet)], sites[i])
        all_ops.extend(ops)
        for j in range(replicas):
            if j != i:
                inbox[j].extend(ops)
    for j in range(replicas):
        rnd.shuffle(inbox[j])
        for op in inbox[j]:
            reps[j].apply(op)
    return reps, all_ops
