# ADR-0008: Authenticated single-writer remote coordination

Status: Accepted

## Context

BroadcastChannel, `MessagePort`, WebSocket, and SharedWorker transport do not establish ordering,
identity, authorization, idempotency, or recovery. Applying caller-supplied remote commands directly
would admit stale epochs, duplicate transactions, revision forks, and unbounded presence state.

## Decision

Remote durable intake is an optional single-writer protocol. Every packet carries protocol,
workspace, session, sender-surface, and coordinator-epoch identity. Durable transactions also carry
transaction, actor, and base-revision identity; the coordinator assigns one next revision, reserves
bounded idempotency before application code runs, and rejects stale/future epochs or revision
conflicts. Lossy presence has an independent bounded sender/sequence channel and never enters durable
history.

The package offers browser-compatible HMAC-SHA-256 signing over deterministic bounded JSON. The
authenticator is separate from coordination so deployments can replace key management and
transport. The application supplies session keys, authorized surfaces, command decoding,
authorization, semantic dispatch, transport, durability, and epoch recovery.

## Consequences

- Transport packets cannot silently become semantic authority.
- Duplicate or reordered durable packets have deterministic results.
- Presence cannot reorder workspace transactions or exhaust an unbounded sender map.
- The primitive supports local, SharedWorker, or server coordinators without choosing one.
- It is not durable distributed collaboration until a product supplies authenticated transport,
  persistence, recovery, domain conflict policy, and corresponding failure evidence.
