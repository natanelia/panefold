# ADR-0014: Correlate and deduplicate post-commit effects

- **Status:** Accepted
- **Date:** 2026-08-13
- **Scope:** Model effect identity, kernel transaction results, runtime delivery, and optional Effect adapter

## Context

The pure kernel already separated semantic commits from fallible operational work, but accepted
transactions returned an empty effect list and the runtime had no delivery contract. Applications
could react through transaction subscribers, yet those callbacks had no effect-level idempotency key,
retry record, cancellation scope, or duplicate-suppression rule. Retrying an operational callback
could therefore duplicate work, while making it part of the semantic reducer would compromise
determinism and atomicity.

The system design requires retryable post-commit effects to carry the committed transaction identity
and revision. It does not permit a repository-local runtime to claim global exactly-once execution
across process crashes, lost storage, or distributed consumers.

## Decision

1. Every accepted command returns one immutable `transaction-committed` intent. This is the
   baseline retryable trigger for the current kernel, not a claim that the future effect algebra is
   complete. Its stable identity
   is derived from a versioned tuple of transaction ID, previous revision, committed revision, and
   ordinal. The payload records only the command type and origin; commands, patches, and application
   data remain on the correlated transaction rather than being duplicated into the effect payload.
2. The exact frozen intent array is published on the accepted kernel result, kernel-state result, and
   committed transaction. Rejections publish no effects. Undo and redo are new transactions, so they
   receive new effect identities and revisions.
3. The kernel only describes effects. It never schedules a promise, imports an operational runtime,
   or performs external work. Replay validates the intent identity against the transaction before
   applying its patches.
4. An optional runtime port receives `{ intent, transaction, attempt, signal }` after the semantic
   commit, synchronous snapshot and transaction observers, and the current bounded reentrant-command
   drain. Delivery is microtask-deferred so operational code cannot interleave the outer commit.
5. A bounded in-memory controller coalesces concurrent duplicate IDs, retains terminal receipts, and
   suppresses successful duplicates while their receipt remains retained. A failed delivery may be
   retried explicitly only when its class is `post-commit-idempotent`; the retry preserves the same
   intent ID and increments its physical attempt number.
6. Delivery failure is operational evidence, never a semantic rollback. Errors and reporting-hook
   errors are contained, retained causes are opt-in, and disposal aborts pending leases. The optional
   `@panefold/runtime-effect` bridge runs Effect programs behind the same abortable port without
   exposing Effect in the model, kernel, or ordinary runtime API.
7. The in-memory receipt window is not a crash-durable exactly-once ledger. A durable or distributed
   port must key by a caller-supplied workspace or session namespace plus the stable effect ID, then
   persist and deduplicate that composite key in the same trust domain as its external work. Journal
   recovery, collaboration delivery, and external-resource compensation keep their separate
   protocols and evidence requirements.

## Consequences

- A committed transaction and every retryable follow-up share exact, deterministic correlation data.
- Duplicate submission and concurrent retry behavior are testable without putting promises or
  resources in canonical state.
- Transaction observers retain their existing ordering and isolation; effect callbacks cannot turn a
  committed receipt into a rejection or splice a command into the middle of the outer transaction.
- Receipt retention and memory use are bounded. Eviction deliberately ends local duplicate memory,
  so applications requiring crash-durable deduplication must supply it at the operational boundary.
- Adding a future effect kind requires an explicit model-union change, identity rule, delivery-class
  policy, and focused replay/idempotency evidence.

## Rejected alternatives

- **Run effects inside the reducer:** rejected because external failure, time, and retry would make the
  semantic kernel non-deterministic.
- **Use transaction subscribers as effect handlers:** rejected because they lack per-intent identity,
  bounded retry state, and cancellation.
- **Hash only kind and payload:** rejected because two legitimate equal-payload intents in one
  transaction would collapse.
- **Automatically retry every failure:** rejected because compensatable and non-idempotent work needs
  a protocol-specific recovery decision.
- **Claim global exactly once:** rejected because a process-local receipt map cannot prove durable or
  distributed application of external work.
