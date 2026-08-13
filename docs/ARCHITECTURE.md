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
- `@panefold/kernel-optimized` contains two deliberately separate experiments. The retained
  projection consumes reference patches to maintain indexes and bounded history without becoming a
  second semantic authority. A correctness-first Map reducer independently implements command and
  canonicalization decisions, then compares its complete result with the reference. Because that
  candidate rebuilds state per command, it is an independent semantic oracle—not yet the retained,
  performance-optimized production kernel required to exit Phase 1.
- `@panefold/geometry` depends only on the model. Geometry never becomes canonical ownership.
- `@panefold/runtime` composes model/kernel transactions, bounded queues, selectors, policy, and
  persistence contracts; `@panefold/runtime-effect` adds optional Effect/IndexedDB operations.
- `@panefold/protocol` defines driver-neutral contracts and the twelve-protocol descriptor catalog;
  `@panefold/protocol-xstate` supplies bounded actors plus identity/revision guards, injected clocks,
  bounded traces, and abort-scoped disposal for those temporal workflows.
- `@panefold/surfaces` owns capability intersection, prepared ownership, and injected
  browser-window/Document-PiP adapters.
- `@panefold/motion` owns motion plans, property channels, managed leases, scheduling, FLIP,
  progressive View Transition fallback, load-adaptive degradation, and the optional DOM driver.
- `@panefold/adapter-contract` is the common immutable framework boundary. React, Vue, Svelte,
  Angular, and Web Components packages depend on it or implement the same projection contract.
- `@panefold/ecosystem` contains trusted and isolated plugin hosts, bounded devtools and
  reproductions, authenticated single-writer coordination, and mobile data projection.
- `@panefold/testkit` publishes workload, panel, lifecycle, action-parity, ownership-model, and
  statistical fixtures without becoming a production dependency.
- `@panefold/conformance` validates manifests, command parity, capability claims, evidence classes,
  requirement traces, hard gates, deterministic reports, and third-party certification records.

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
5. derive patches, inverse state, transaction metadata, deterministic effect intents, and the next
   revision;
6. publish one immutable snapshot and notify current observers;
7. queue reentrant work in a bounded FIFO for iterative draining;
8. publish transaction observers, drain their bounded reentrant command queue, then hand immutable
   post-commit intents to the optional operational port.

Every accepted command carries one frozen `transaction-committed` intent on both the kernel result
and committed transaction. Its versioned ID binds the transaction ID, previous and committed
revisions, and ordinal. The runtime invokes an optional abortable delivery port in a microtask after
the synchronous commit and observers. A bounded receipt ledger coalesces concurrent duplicates,
suppresses retained successes, and permits explicit retry only for `post-commit-idempotent` work.
Delivery failure cannot roll back the semantic commit. This is process-local duplicate suppression,
not a crash-durable or distributed exactly-once claim; those ports must durably deduplicate the same
stable effect ID under an application-supplied workspace or session namespace. See
[ADR-0014](adr/0014-post-commit-effect-delivery.md).

Undo/redo runs through `dispatchKernelState`; it is bounded and separate from panel-content undo.
The kernel's remote wrapper records a bounded deduplication receipt. The optional ecosystem layer
adds bounded schema checks, HMAC signing, session/epoch/revision validation, a single-writer durable
ordering port, and a separate lossy presence channel. Applications still supply transport, keys,
authorization, persistence, and domain conflict policy.

Fallible workflows use an explicit prepare/revalidate/commit/finalize sequence. A failure after an
in-memory semantic commit produces a typed degraded operational state; it does not rewrite history.
An unexpected kernel exception or invariant rejection instead freezes structural mutation at the
exact last-valid snapshot and records one bounded, redacted incident reproduction.

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

The React renderer consumes resolved geometry rather than relying on CSS weights. A model-aware
application can supply `solveLayout`; the projection solver uses the same exact-conservation
allocator as a constraint-free compatibility fallback. Pointer resize uses a sparse XState actor and
frame-coalesced preview before one semantic commit.

Direct panel placement uses the same geometry result. The renderer derives mutually exclusive
center and logical-edge candidates, keeps pointer identity/candidate state in a bounded drag actor,
and asks the application to pure-plan each candidate against one captured revision. The application
adapter allocates semantic IDs, uses `planPanelDropCommand` to select `move-panel`, `move-group`,
`split-group`, or one atomic batch, pure-reduces it, and solves the resulting group rectangle. React
retains the selected candidate's exact command and preview, revalidates the revision, and dispatches
that command on release. Preview state is neither persisted nor entered into history; one accepted
gesture publishes one transaction. Menu and keyboard routes use the same planner.

Same-strip tab reorder uses relational `beforePanelId`/`afterPanelId` placement rather than pointer
coordinates or array indexes. The adapter measures a horizontal LTR, horizontal RTL, or vertical
strip once, performs logarithmic slot lookup, creates only the selected command at commit, and
dispatches one transaction. Bounded overflow autoscroll translates cached geometry in constant time
while raw pointer samples stay in a latest-value cell consumed once per animation frame. The visual
marker and sibling shifts are disposable projection; pointer candidate changes are silent and only
the final outcome is announced. Alt+logical-arrow, menu, and programmatic routes use the same
relational command contract.

External ownership transitions use an explicit history barrier. A browser window depends on
transient activation and an imperative live-host lease, so semantic undo/redo cannot safely recreate
it. A successful prepared transfer or recovery clears prior workspace undo/redo history and is not
itself recorded; this prevents canonical ownership from diverging from the browser resource.

Tab placement and label treatment are projection preferences rather than topology. A static value or
per-group resolver can choose `block-start`, `block-end`, `inline-start`, or `inline-end`, plus
icon-and-label, icon-only, or label-only content. Logical orientation drives keyboard behavior and
accessible names remain present when labels are visually hidden.

React reads the runtime through `useSyncExternalStore`. Workspace state is not copied into a changing
context value, and pointer frames do not cause a framework-wide semantic render loop.

## Panel lifecycle

Panel lifecycle policy is semantic data: hidden behavior, same-document movement, and cross-document
movement are explicit. The React adapter keeps a host keyed by panel identity, portals content into
that host, preserves the host across selection and same-document movement when policy requests it,
and can cooperatively suspend hidden content.

Each `active`, `visible`, or `suspended` lifecycle delivery carries a fresh `AbortSignal`. The old
lease is aborted before its replacement is delivered and the final lease is aborted on unmount.
The public testkit and browser fixture exercise all 17 normative panel classes, including forms,
editor, WebGL/canvas, grid, video, same/opaque iframe, Web Component, microfrontend, suspension,
guards, corruption, failure, slow resize, and missing-provider recovery. The automated fixture
proves stable identity, pause/resume, containment, and cleanup behavior in one Chromium profile; it
does not certify production third-party editors/media or replace heap and physical-system traces.
Cross-document renderer strategy remains application policy. The prepared surface protocol supports
checkpoint/remount, while Atlas exercises one controlled same-origin portal-coupled profile; mirror
and general cross-origin policies remain outside the React reference claim. See
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

`openDurableWorkspace` reads, verifies, migrates, and replays the journal before constructing the
synchronous runtime. Consumers therefore never observe a default snapshot that is later swapped for
persisted state. Incomplete or corrupt recovery is a non-destructive failure; it requires an explicit
application reset/export/migration decision. Status observers report queued/in-flight writes and the
last verified persisted revision without being able to break persistence.

## External surfaces

External transfer is modeled as capability check, destination prepare/bootstrap, checkpoint, final
capability plus synchronous application-policy revalidation, revision revalidation, ownership
commit, destination mount/readiness, and source release. Tokens are
bound to destination identity, protocol version, session context, and owner epoch. Failure reports
one authoritative owner: the source only after rollback is confirmed, or the destination in a
pending state when compensation cannot be confirmed within its independent safety budget. The
destination resource and recovery lease are retained in that case. Unexpected surface loss has an
explicit recovery operation.

The operational adapter is SSR-safe and receives its browser environment explicitly. It supports
same-origin popup and capability-gated Document Picture-in-Picture preparation; transfers locale,
direction, writing mode, theme tokens, nonce annotations, and allowlisted stylesheets; validates
workspace/session/protocol context; mounts one lease; and observes intentional close or unexpected
loss. The React adapter passes an explicit stable host, source-document parking element, and
`AbortSignal` to the application handler while it is still inside pointer-up/user activation. The
request is bounded by a validated application-configurable deadline (15 seconds by default);
timeout or renderer unmount aborts the request, ignores late settlement, and releases the
interaction actor. Atlas forwards the signal into the prepared transfer coordinator and uses the
contract to move the same live panel host into a controlled same-origin popup, commit semantic
surface ownership, redock on requested return, and recover on unexpected close. This is a
portal-coupled reference profile, not a generic cross-origin renderer. The automated Chromium fixture covers popup
prepare/ready/live-state preservation/redock/loss recovery. Real
permissioned PiP, cross-origin deployment, multi-screen placement, process crashes, and CSP
deployment remain product evidence work.

## Framework and ecosystem boundaries

Vue, Svelte, Angular, and Web Components have native experimental bindings and shared contract
tests. The declared adapter profile is JSDOM/programmatic; it is not real-browser rendering,
accessibility, hydration, performance, or third-party certification.

The ecosystem keeps trusted same-realm plugins separate from untrusted iframe plugins. Trusted
plugins receive abortable cleanup scopes; conflicts are deterministic. The isolated host omits
same-origin authority and validates a dedicated, session-bound MessagePort. Remote intake is an
authenticated single-writer protocol primitive, not a hosted collaboration service. React's
responsive mode is a reversible, coarse-pointer single-region UI projection; a 390×844 touch
emulation fixture covers region switching, canonical preservation, 44 px targets, safe areas, and
axe, while physical devices and mobile assistive technology remain external evidence.

## Conformance boundary

The conformance harness accounts for 190 requirements, 36 commands, every published capability,
and ten hard gates. Each trace is classified as A/code, B/automated environment, C/manual-external,
or D/future profile scope. Evidence differentiates source, executed result, and attestation; hard
gates identify exact requirement/profile scope and required classes. Repository artifacts can be
content-addressed while the overall report remains blocked or unresolved. Automated tests cannot be
relabeled as manual assistive-technology work, physical performance traces, independent security
review, real OS failure testing, or third-party pilots.

## Architectural decisions

- [ADR-0001: One authoritative pure kernel](adr/0001-authoritative-kernel.md)
- [ADR-0002: Experimental vertical slice](adr/0002-experimental-scope.md)
- [ADR-0003: Schema v2 and complete command catalog](adr/0003-schema-v2-and-command-catalog.md)
- [ADR-0004: Panel lifecycle leases and stable hosts](adr/0004-panel-lifecycle-contract.md)
- [ADR-0005: Durable journal and trust boundaries](adr/0005-durable-journal-and-trust-boundaries.md)
- [ADR-0006: Prepared external-surface ownership](adr/0006-prepared-external-surface-ownership.md)
- [ADR-0007: Versioned panel and plugin boundaries](adr/0007-versioned-panel-and-plugin-boundaries.md)
- [ADR-0008: Authenticated single-writer coordination](adr/0008-single-writer-remote-coordination.md)
- [ADR-0009: Fail-closed structural runtime](adr/0009-fail-closed-runtime.md)
- [ADR-0010: Executable evidence taxonomy](adr/0010-executable-evidence-taxonomy.md)
- [ADR-0011: Independent semantic oracle](adr/0011-independent-semantic-oracle.md)
- [ADR-0012: Bounded protocol and motion lifecycles](adr/0012-bounded-protocol-and-motion-lifecycles.md)
- [ADR-0013: Direct placement, durable opening, and controlled popouts](adr/0013-direct-placement-durable-demo.md)
- [ADR-0014: Correlate and deduplicate post-commit effects](adr/0014-post-commit-effect-delivery.md)
