# ADR-0003: Schema v2 and the complete semantic command catalog

Status: Accepted

## Context

The first executable slice exposed only twenty commands even though Appendix B defines a broader
semantic catalog. Adding group operations, collapse, import, remote intake, and external-surface
ownership also introduced state that cannot be reconstructed safely from the old snapshot shape.

## Decision

Workspace schema version 2 adds a bounded applied-remote-transaction ledger. The public
`WORKSPACE_COMMAND_TYPES` constant is the authoritative inventory for all thirty-six command
variants and is checked exhaustively against the TypeScript union. IDs needed for replay are always
provided by callers.

Batch commands reduce atomically. Patch replay is a separate state-transition oracle with explicit
preconditions. Closing the last live panel may preserve a canonical placeholder group solely so a
recoverable panel still has a deterministic destination. Cross-document ownership changes require
prepared tokens and epoch checks; a direct move cannot bypass that boundary.

## Consequences

- Persisted schema-v1 workspaces require the deterministic v1-to-v2 migration that initializes the
  remote receipt ledger.
- Command status documentation and conformance metadata must match `WORKSPACE_COMMAND_TYPES`.
- A semantic transfer command does not by itself certify browser popouts, PiP, or collaboration;
  those capabilities still require operational protocol evidence.
- The ledger is FIFO-bounded to 4,096 receipts, so durable systems must also provide an external
  idempotency strategy for longer horizons.
