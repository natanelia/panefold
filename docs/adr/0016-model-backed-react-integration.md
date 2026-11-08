# ADR-0016: Opt-in model-backed React integration

- **Status:** Accepted
- **Date:** 2026-11-08
- **Scope:** React package entry points, model projection, command planning and session ownership

## Context

The generic React surface correctly accepts application-owned projections, commands and geometry.
However, canonical-model users had to copy hundreds of lines from the demo to enable real docking.
The small starter also copied this application glue. Omitting its optional geometry bridge silently
selected the generic constraint-free solver, even when panel records declared minimum sizes.

ADR-0013 keeps command identities and semantic planning outside the generic renderer. That boundary
is valuable, but it does not require every application using the canonical model to maintain its own
copy of the same bridge.

## Decision

1. Add an opt-in `@panefold/react/model` entry point within the existing experimental React package.
   The ordinary entry point remains generic. The model entry point depends on the existing model,
   kernel, geometry and runtime packages; no new package or publishing status is introduced.
2. `createModelWorkspaceBindings` returns one runtime, projector, command adapter and model solver.
   It does not subscribe to or dispose an externally owned runtime. `createModelWorkspaceSession`
   creates an in-memory runtime and adds an explicit, idempotent disposer. React applications create
   owned sessions in effects and dispose the exact instance created by each effect.
3. `ModelWorkspaceSurface` installs the provider and all three bindings together. Its surface props
   do not separately accept a projector, commands or layout solver. Canonical-model applications
   therefore get model constraints by default, including temporary split overrides.
4. The generic renderer still consumes only its existing command/projection interfaces. The model
   bridge delegates placement to the pure kernel planners, previews their exact commands against the
   captured snapshot, and uses the same configured model solver for preview and committed geometry.
   Live snapshots are never changed while planning. The renderer cancels retained UI plans when
   their revision changes; direct planner callers must pass the captured `baseRevision` at dispatch.
   Dispatch policies and kernel validation remain authoritative at commit time. Preview parity
   assumes the retained command is applied unchanged. Applications whose runtime policies transform
   placement commands must also supply matching drop planners. The bridge does not call the live
   runtime's preview method, consume its command IDs, or guess interaction-origin policy inputs.
5. Placement identities are derived deterministically from the current snapshot, with a bounded
   collision search. Close identities use a per-adapter sequence plus collision checks against
   restored recovery records. No module-global counters, randomness, DOM ownership or new command
   types are introduced. Normal commands and atomic batches retain existing history semantics.
6. Applications can override group labels, floating bounds, redock placement, geometry policy and
   individual command factories. The workbench retains its labels, small-screen constraint policy,
   floating bounds and preferred redock group through thin wrappers. Browser-window ownership,
   durable persistence and application panel checkpoints remain separate explicit integrations.
7. The root and model entries are built together with shared chunks so their providers and hooks
   share one React context. A test imports both compiled entry points and renders a consumer to
   verify that packaging boundary, in addition to source-level command and geometry tests.

## Consequences

- Canonical-model users can start with their initial snapshot and panel registry without copying
  the reference workbench's glue, while custom integrations keep the lower-level renderer.
- Kernel invariants, command inventory, schema, persistence and cross-document ownership are
  unchanged. The helper is an application integration policy layer, not a second authority.
- Real docking, reordering, closing, floating and undo/redo remain visible in the compiled starter.
  Model constraints and preview parity are tested against real kernel/runtime operations.
- Direct `@panefold/react` imports do not import the model entry point's runtime/kernel code. The
  package manifest records the extra workspace dependencies required when that entry point is used.
- Tests establish repository behavior only; this change makes no stability, publication,
  assistive-technology or cross-browser certification claim.

## Rejected alternatives

- **Keep copying the demo:** leaves default model integration fragile and duplicates semantic glue.
- **Teach the generic renderer the model command union:** removes the separation preserved by
  ADR-0013 and makes custom snapshot integrations depend on one schema.
- **Create another package:** adds setup and inventory overhead without adding a new responsibility.
- **Create a live runtime during React render:** can abandon resources during interrupted renders.
- **Silently dispose a supplied runtime on surface unmount:** conflicts with application-owned
  durable sessions and other consumers of the same runtime.
