# ADR-0001: One authoritative pure kernel

Status: Accepted

## Context

Docking systems often let React state, DOM order, drag libraries, persistence, and popout windows
each own fragments of layout truth. That makes replay, recovery, undo, focus, and accessibility
inconsistent.

## Decision

One synchronous TypeScript kernel is the sole authority for committed workspace state. Every
semantic mutation enters through a typed command, then reduction, canonicalization, invariant
validation, inverse derivation, and patch production. The kernel imports only the zero-dependency
model package.

Geometry, protocol actors, motion, frameworks, DOM, persistence, and remote surfaces consume
snapshots or patches and cannot mutate canonical records.

## Consequences

- Commands replay deterministically and failures are atomic.
- Framework adapters stay replaceable and fine-grained.
- Temporary pointer and animation state must live outside canonical state.
- Fallible work requires explicit prepare/post-commit contracts.
- The architecture carries more up-front structure than a component-only docking library.
