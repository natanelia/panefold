# ADR-0009: Freeze structural mutation after an invariant defect

Status: Accepted

## Context

Expected command rejection is normal control flow. An unexpected internal exception or a kernel
invariant rejection is different: continuing to process structural commands could compound a defect
or make the last trustworthy state ambiguous. Throwing a raw error can also expose panel data,
labels, identifiers, or stacks through diagnostics.

## Decision

The runtime distinguishes expected rejection from structural failure. On the first unexpected
exception or invariant rejection, it preserves the exact last valid immutable snapshot, clears
queued structural work, rejects later dispatch/preview/undo/redo with
`STRUCTURAL_MUTATION_FROZEN`, and emits at most one contained observer notification.

The frozen reproduction is bounded and immutable. It records only engine-independent structural
facts: failure category, safe cause class, command type/origin, revision, entity counts, patch kinds,
and a capped list of prior transaction summaries. It omits labels, titles, parameters, checkpoints,
panel/application payloads, identifiers, error messages, and stacks. Recovery requires constructing
a new runtime from an explicitly selected known-valid snapshot.

## Consequences

- The last valid snapshot remains readable and exportable after a defect.
- A diagnostic callback cannot weaken the frozen state even if it throws.
- Expected policy, stale-revision, and command validation failures do not freeze the runtime.
- Applications need an explicit recovery/restart experience; the runtime never guesses past an
  invariant defect.
