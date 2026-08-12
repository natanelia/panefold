# ADR-0005: Versioned, bounded, atomic workspace persistence

Status: Accepted

## Context

Persisting a typed snapshot directly is unsafe. Storage can be truncated, corrupted, newer than the
running application, or intentionally hostile. Panel checkpoints must also become durable before a
snapshot is allowed to reference them.

## Decision

Durable snapshots use a versioned envelope with separate kernel, application-layout, protocol, and
panel-type versions plus a SHA-256 checksum. Decoding is iterative and bounded by byte, depth, node,
array, object-key, and string limits. It rejects cycles, sparse arrays, accessors, unsafe keys,
non-finite numbers, and non-plain prototypes before canonicalization and invariant validation.

Persistence uses one atomic bundle containing panel checkpoints, a monotonic semantic-command
journal, the latest snapshot, and a last-known-good snapshot. Commits validate required checkpoint
references before publishing. Recovery verifies the latest envelope, falls back to the
last-known-good snapshot, and replays only contiguous commands whose resulting canonical hashes
match. The IndexedDB adapter performs each bundle update in one native read-write transaction;
Effect is confined to the fallible operational wrapper.

The durable runtime offers three explicit policies: `strict` waits for the journal after the
in-memory semantic commit, `balanced` drains a bounded asynchronous queue, and `session` writes
compacted snapshots. Storage failure never replaces in-memory truth; it produces a typed degraded
state with export/retry remediation.

## Consequences

- Applications must run recovery before constructing a runtime from persisted state.
- `strict` means durable acknowledgement, not rollback of a semantic commit after a storage fault.
- Application-layout and panel checkpoint migrations remain application-owned and must be supplied
  explicitly.
- Real browser crash, quota, and corruption certification remains a release-evidence task even
  though failure injection is automated.
