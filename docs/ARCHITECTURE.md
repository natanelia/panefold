# Architecture

This document describes the current experimental implementation. The complete normative target is
the [Panefold system design](spec/SYSTEM_DESIGN.md).

## Governing rule

**Commit truth immediately; animate the explanation.**

A semantic operation must remain correct with optional animation disabled. DOM, framework,
protocol, persistence, and surface code can prepare, project, or react to canonical state, but only
the reference kernel commits workspace state.

## Five planes

1. **Semantic plane** — normalized immutable records and the pure transaction kernel.
2. **Spatial plane** — constraint aggregation, allocation, geometry, hit tests, and drop targets.
3. **Protocol plane** — bounded temporary interactions such as drag, resize, persistence, election,
   and surface transfer.
4. **Motion plane** — interruptible visual interpolation around an already-defined semantic result.
5. **Operational plane** — fallible storage, checkpoints, resources, retries, transport adapters,
   and tracing.

The ordinary semantic API does not expose Effect or XState. Those libraries remain in optional
operational/driver packages and do not appear in serialized state.

## Package topology

- `@panefold/model` is foundational and has no runtime dependencies.
- `@panefold/kernel` depends only on the model and is the authoritative reference implementation.
- `@panefold/kernel-optimized` consumes reference patches and builds experimental indexes and
  projections. It currently provides a differential smoke oracle, not an independent reducing
  kernel, so Phase 1's differential exit evidence remains incomplete.
- `@panefold/geometry` depends only on the model. Geometry never becomes canonical ownership.
- `@panefold/runtime` composes model/kernel transactions, bounded queues, selectors, policy, and
  persistence contracts; `@panefold/runtime-effect` adds optional Effect/IndexedDB operations.
- `@panefold/protocol` defines driver-neutral contracts; `@panefold/protocol-xstate` supplies sparse
  XState implementations.
- `@panefold/surfaces` owns capability intersection and prepared ownership transfer primitives.
- `@panefold/motion` owns motion plans, channels, scheduling, FLIP, and the optional DOM driver.
- `@panefold/adapter-contract` is the common immutable framework boundary. React, Vue, Svelte,
  Angular, and Web Components packages depend on it or implement the same projection contract.
- `@panefold/ecosystem` contains explicitly bounded trusted-plugin, devtools, remote-intake, and
  mobile-projection primitives.
- `@panefold/conformance` validates manifests, command parity, capability claims, evidence,
  requirement traces, hard gates, and deterministic reports.

Dependency-cruiser enforces the headless boundaries. The complete package inventory is in the
[README](../README.md#workspace-packages).

## Canonical state and invariants

Schema version 2 normalizes panels, groups, layout nodes, and surfaces into entity tables. Group
membership and tab order live only in group records. Parent indexes and geometry are derived. Panel
identity is independent of React elements, DOM hosts, groups, or surfaces.

The snapshot also records activation, focus memory, floating order, recoverable closes, bounded
applied-remote-transaction receipts, and version metadata. Caller-owned nested input is cloned and
frozen at factory and command boundaries.

Every accepted transaction must leave a state where:

- each live panel belongs to exactly one group;
- each group has one reachable group node;
- each layout node is reachable from exactly one surface root and no cycles exist;
- each ordinary group is non-empty and selects one of its panels;
- a temporary placeholder group exists only to preserve a deterministic reopen destination;
- canonical splits have at least two children, positive normalized weights, and valid collapse
  references;
- surface ownership, owner epochs, remote receipts, and recoverable descriptors are consistent;
- there are no dangling, duplicate, non-finite, unsafe, or ineligible references;
- rejected commands do not advance revision or expose patches.

Canonicalization is deterministic and idempotent. It flattens adjacent same-axis splits, removes
unary splits and transient empty groups, normalizes weights, repairs eligible activation, and uses
stable UTF-16 ordering for serialization and hashing.

## Commands and transactions

`WORKSPACE_COMMAND_TYPES` is the single runtime inventory for all 36 command discriminants. The
TypeScript union has a compile-time exhaustiveness assertion, while the conformance package checks
the published command registry. See [Command support](COMMANDS.md).

The synchronous semantic path is:

1. accept an envelope with command identity, origin, label, and optional base revision;
2. validate the current snapshot and revision;
3. reduce one command or atomic batch against a mutable draft;
4. canonicalize and validate the candidate;
5. derive patches, inverse state, transaction metadata, and the next revision;
6. publish one immutable snapshot and notify current observers;
7. queue reentrant work in a bounded FIFO for iterative draining;
8. publish transaction observers and allow operational follow-up.

Undo/redo runs through `dispatchKernelState`; it is bounded and separate from panel-content undo.
Remote intake records a bounded deduplication receipt but provides no transport, authentication,
coordinator, or conflict resolution.

Fallible workflows use an explicit prepare/revalidate/commit/finalize sequence. A failure after an
in-memory semantic commit produces a typed degraded operational state; it does not rewrite history.

## Geometry and rendering

Docked layouts are surface-rooted n-ary trees using logical `inline` and `block` axes. For each
split, the solver:

1. subtracts splitter thickness;
2. aggregates hard minimum, preferred, maximum, grow, and shrink constraints;
3. allocates preferred or weight-proportional lengths;
4. freezes children at bounds and redistributes remaining space;
5. emits an explicit overflow diagnostic when hard minima cannot fit;
6. rounds by largest remainder with stable ID ties;
7. verifies that rounded children plus splitters conserve the available integer pixels.

The React renderer now consumes resolved geometry rather than relying on CSS weights. A model-aware
application can supply `solveLayout`; the projection solver uses the same exact-conservation
allocator as a constraint-free compatibility fallback. Pointer resize uses a sparse XState actor and
frame-coalesced preview before one semantic commit.

React reads the runtime through `useSyncExternalStore`. Workspace state is not copied into a changing
context value, and pointer frames do not cause a framework-wide semantic render loop.

## Panel lifecycle

Panel lifecycle policy is semantic data: hidden behavior, same-document movement, and cross-document
movement are explicit. The React adapter keeps a host keyed by panel identity, portals content into
that host, preserves the host across selection and same-document movement when policy requests it,
and can cooperatively suspend hidden content.

Each `active`, `visible`, or `suspended` lifecycle delivery carries a fresh `AbortSignal`. The old
lease is aborted before its replacement is delivered and the final lease is aborted on unmount.
Synthetic heavy-content tests cover state preservation and cleanup ordering, but they are not real
editor, WebGL, media, iframe, grid, or microfrontend certification. Cross-document lifecycle modes
are policy vocabulary only in the current DOM adapter. See
[ADR-0004](adr/0004-panel-lifecycle-contract.md).

## Persistence and recovery

The runtime codec separates kernel, application-layout, protocol, and panel-type versions. It
applies bounded JSON validation, checksums, canonical hashing, and deterministic migration before a
snapshot reaches the kernel. The atomic journal contract orders required panel checkpoints before a
snapshot and retains a last-known-good fallback. Strict, balanced, and session durability policies
make acknowledgement behavior explicit.

The Effect package wraps persistence failures and supplies an IndexedDB implementation tested
against an injected database factory. Automated fault injection does not establish real browser
crash, quota, corruption, or upgrade certification.

## External surfaces

External transfer is modeled as capability check, destination prepare/bootstrap, checkpoint,
revision revalidation, ownership commit, destination mount/readiness, and source release. Tokens are
bound to destination identity, protocol version, session context, and owner epoch. Failure rolls back
or compensates to one authoritative safe owner; unexpected surface loss has an explicit recovery
operation.

No browser-window or Document Picture-in-Picture adapter is certified. Origin authentication,
actual popup APIs, style/context transfer, CSP deployment, user activation, and platform recovery
remain adapter and evidence work. Semantic commands or headless protocol tests do not create a
supported product profile.

## Framework and ecosystem boundaries

Vue, Svelte, Angular, and Web Components have native experimental bindings and shared contract
tests. The declared adapter profile is JSDOM/programmatic; it is not real-browser rendering,
accessibility, hydration, performance, or third-party certification.

The ecosystem plugin registry is for trusted in-process contributions. Remote intake is a validated
dispatch bridge, not distributed collaboration. The mobile module is a reversible data projection,
not a touch UI. These distinctions are enforced in the [Support matrix](SUPPORT.md).

## Conformance boundary

The conformance harness accounts for 190 requirements, 36 commands, every published capability,
and ten hard gates. Repository-local source artifacts can be verified and content-addressed while
the overall report remains blocked or unresolved. Automated tests cannot be relabeled as manual
assistive-technology work, physical performance traces, independent security review, real failure
testing, or third-party pilots.

## Architectural decisions

- [ADR-0001: One authoritative pure kernel](adr/0001-authoritative-kernel.md)
- [ADR-0002: Experimental vertical slice](adr/0002-experimental-scope.md)
- [ADR-0003: Schema v2 and complete command catalog](adr/0003-schema-v2-and-command-catalog.md)
- [ADR-0004: Panel lifecycle leases and stable hosts](adr/0004-panel-lifecycle-contract.md)
- [ADR-0005: Durable journal and trust boundaries](adr/0005-durable-journal-and-trust-boundaries.md)
- [ADR-0006: Prepared external-surface ownership](adr/0006-prepared-external-surface-ownership.md)
