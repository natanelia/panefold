# ADR-0012: Bound protocol actors and motion with explicit lifecycles

Status: Accepted

## Context

Drag, resize, close, transfer, recovery, and animation are temporal workflows, but they must never
become a second workspace database. Pointer cancellation, stale revisions, scope disposal, driver
failure, or optional View Transition failure must leave semantic state and owned resources in a
predictable condition.

## Decision

`@panefold/protocol` publishes a twelve-entry experimental descriptor catalog. Each descriptor
names the bounded actor and its principal states; `@panefold/protocol-xstate` supplies the matching
XState implementation. A scoped wrapper binds an actor to one identity and abort signal, rejects
stale identity/revision events, uses an injected clock, retains a bounded trace, and stops exactly
once when the owner closes.

Motion execution returns a managed lease with explicit `finish`, `cancel`, `skip`, and `dispose`
operations. Completion and cleanup are idempotent, queued work belongs to the same scope, and a
driver rejection applies the intended final state. View Transitions are progressive enhancement:
unsupported, skipped, failed, or disposed transitions commit semantic work once and fall back to
FLIP or immediate projection. The load planner degrades decoration before spatial continuity and
never degrades direct-input tracking.

Neither an actor nor a motion lease stores canonical workspace ownership. A semantic command is the
only durable commit; actor context, pointer previews, traces, and visual tombstones are disposable
operational state.

## Consequences

- Scope closure, cancellation, capture loss, and driver failure have explicit testable cleanup.
- The catalog prevents undocumented actor proliferation and enables inventory conformance checks.
- Optional animation cannot suppress or duplicate a semantic commit.
- Physical latency, one-pixel re-grab continuity, browser View Transition behavior, DOM tombstones,
  focus, and style ownership still require their own browser/manual evidence.
