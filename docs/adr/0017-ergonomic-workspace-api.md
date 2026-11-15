# ADR-0017: Canonical workspace API by default

- **Status:** Accepted
- **Date:** 2026-11-15
- **Scope:** Layout authoring, application actions, React entry points and session ownership

## Context

The model bridge in ADR-0016 removed copied projection and command glue. A small application still
had to construct panels, groups, nodes and surfaces separately, create a session in an effect, pass
bindings to a surface, and supply model type arguments to generic hooks. Application actions also
required branded identities and recovery or placement IDs that most callers should not manage.

The project is an experimental source release. The API improvement is allowed to change root
exports rather than carrying the generic integration as the default indefinitely.

## Decision

1. `@panefold/react` becomes the canonical-model entry point. `Workspace` accepts initial layout or
   snapshot options and owns the in-memory runtime and model context. `WorkspaceSurface` accepts
   the panel registry and presentation props and renders wherever the application places it under
   that root. Controls, wrappers, surfaces and inspectors are ordinary children in any order. The
   root adds no DOM wrapper or implicit surface and can support controls alone. Typed action,
   planning, runtime, snapshot, selector and transaction hooks need no model generic arguments.
2. `Workspace` creates resources only in an effect and disposes the exact session created by that
   effect. It renders an optional fallback before setup and during server rendering. `initial` and
   model `options` are captured setup values; changing the React key explicitly starts a new
   workspace. Surface presentation props remain reactive. The same lifecycle is available through the
   optional `useWorkspaceSession` hook for custom compositions. An owning root inside React
   `Activity` is disposed when hidden and recreated from its setup values when revealed, resetting
   layout and history. Applications that retain a session across hiding place the owning root above
   `Activity`, or use a runtime whose owner lives outside that boundary with `WorkspaceProvider`.
3. `WorkspaceProvider` accepts an application-owned runtime and builds its model bindings.
   `WorkspaceSurface` consumes those bindings without manual projector or command props. The
   provider does not take ownership of disposal or persistent storage. Durable sessions continue
   to follow their existing restoration and cleanup contract.
4. The old generic React surface, provider and hooks move to `@panefold/react/adapter`. Explicit
   model bindings and planners remain at `@panefold/react/model`. The entries are built together
   with shared chunks so model surfaces, generic adapters and hooks use the same underlying
   contexts. This is an import/API migration; it changes no saved-layout schema.
5. `createPanel` fills existing model defaults from a compact input and returns an owned immutable
   record. `createWorkspaceLayout` compiles a nested group/split tree into existing normalized
   records with one main surface. It creates deterministic path-based identities when omitted,
   accepts explicit identities, normalizes positive relative weights, and rejects malformed
   topology, membership, selection and conflicting identities. Traversal is iterative with a
   nesting bound. The model still has no dependency on the kernel or a framework; runtime creation
   remains the authoritative full invariant check. Ordinary kernel canonicalization applies to
   subsequent commands.
6. `createWorkspace` in `@panefold/runtime` accepts a compact layout or a decoded `initialSnapshot`
   plus the existing runtime options. It returns the same runtime with `actions` and `plan` properties. The
   lower-level `createWorkspaceRuntime`, snapshot factory and dispatch interface remain available.
7. `createWorkspaceActions` binds application conveniences to an existing runtime. It dispatches
   existing semantic commands or one atomic batch and preserves exact committed, rejected and
   queued receipts. It does not introduce a second command inventory, mutate a snapshot, or bypass
   capabilities, runtime policies, history or the fail-closed boundary. Commands own cloned inputs
   before entering a reentrant queue.
8. `workspace.plan` and `createWorkspacePlans` prepare immutable operations without dispatching,
   running runtime policies or changing history. Plans belong to their runtime and captured
   revision. `actions.batch` combines them into one existing semantic batch, including compound
   helpers, so success creates one revision and undo step and rejection publishes nothing. Stale
   or mixed-revision plans reject; a dispatch option cannot bypass their revision guard. At batch
   time, each operation prepares again against the staged output of preceding operations using
   the pure kernel reducer. This supports dependent operations, such as opening a panel and then
   splitting it, without live revisions, notifications, operational effects or speculative runtime
   policy calls. A plan's exposed command is a standalone preview against its original snapshot;
   final batch commands may differ after earlier steps. Plan options describe semantics; the outer
   batch owns dispatch metadata and enters normal runtime policy/commit handling once.
9. Action-generated IDs use one checked sequence per runtime, shared across action bindings and
   stored in a weak map. Collision checks account for restored live/recoverable identities. No
   subscription or retained reservation ledger is required. State-derived helpers capture their
   source revision so queued work cannot silently reinterpret a topology-dependent decision after
   another command changes the layout. Recorded commands retain their concrete IDs for replay.
10. Semantic action defaults and UI command-factory overrides are separate explicit policies. Shared
    authorization and transformations remain runtime policies; placement-transforming policies
    still need matching UI planners for truthful previews. Browser windows and Picture-in-Picture
    remain prepared operational integrations, outside these convenience actions.
11. Transaction hooks call runtime methods with their receiver intact and cache log snapshots
    between notifications. Generic stores may reconstruct transaction arrays and entries; changed
    entries must be replaced rather than mutated. Either `subscribeTransactions` or the fallback
    `subscribe` must notify every log change. Refreshing after attaching the subscription covers
    changes between render and subscription and Activity resumption. Provider changes immediately
    switch the transaction view to the new runtime.

## Consequences

- A React application composes an owning root, an explicitly placed surface and its own controls.
  Headless applications need one factory; controls use ordinary string IDs and typed receipts.
- Existing generic consumers update their import path to `/adapter`. Model applications can
  migrate to the root provider/component API without changing saved data or panel components.
- Normalized records, the 36-command catalog, kernel authority, stable panel hosts, prepared
  cross-document ownership, persistence and accessibility behavior remain unchanged.
- Tests must exercise builder output against the real kernel, action rejection and history,
  unused plan isolation, atomic plan batches and revision conflicts,
  queued input ownership and revision conflicts, React Strict Mode cleanup, Activity ownership,
  typed selectors, provider switching and compiled entry-point context sharing. The compiled starter
  uses the default API so browser tests cover a real consumer.
- This change adds no stability, npm publication, device, assistive-technology or external
  certification claim.

## Rejected alternatives

- **Only add aliases around the old setup pipeline:** preserves the initial boilerplate and keeps
  common model usage behind an advanced subpath.
- **Move mutation logic into action helpers:** duplicates kernel semantics and weakens rejection,
  policy and replay guarantees.
- **Create a runtime during component render:** leaves resources owned by potentially abandoned
  renders and complicates Strict Mode cleanup.
- **Recreate on every options-object change:** inline props would reset the workspace and discard
  user arrangements during ordinary rendering.
- **Own external runtime disposal in the provider:** conflicts with durable sessions and other
  application consumers.
