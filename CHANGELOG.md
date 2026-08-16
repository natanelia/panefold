# Changelog

Notable source changes are recorded here. Panefold follows semantic version labels for repository
milestones, but no stable package-compatibility promise exists yet.

## Unreleased

### Added

- A reviewed twelve-actor protocol graph contract and deterministic bounded coverage report for all
  84 states, 258 transition branches, 64 guarded branches with both outcomes observed, 146 path
  obligations, 533 explored snapshots, 7,837 impossible-event checks, and 36 phase-specific timeout
  scenarios with byte-equivalent replay.
- Transaction-correlated immutable post-commit effect envelopes, an abortable bounded delivery
  controller with in-process duplicate suppression and explicit idempotent retry, plus an optional
  Effect bridge. Durable and shared sinks must namespace and persist effect IDs themselves.
- Same-strip pointer tab reordering with relational insertion anchors, exact visual markers,
  horizontal LTR/RTL and vertical-rail support, bounded overflow autoscroll, plus equivalent
  keyboard and menu routes.
- Whole panel-container movement from accessible empty tab-strip space: center drops swap intact
  containers, edge drops reposition every tab together, the Actions menu exposes the same
  revision-bound keyboard placement plans, and one completed gesture creates one undo entry.
- Same-document floating-window projection with canonical z-order, bounded titlebar and edge/corner
  manipulation, keyboard movement/resize, movable minimized headers, single-row chrome for sole-panel
  windows, maximize/restore, redock controls, stable panel-host preservation, and surface-local
  structural motion.

### Changed

- Scoped protocol actors now support replaceable typed phase deadlines through the same
  addressed-event path used by ordinary actor input, with injectable FIFO virtual time and
  exactly-once deadline cleanup on fire, cancellation, stop, or parent abort. Coverage performs 84
  literal schedules: 72 firings across primary and replay runs plus 12 cancelled twins, with zero
  pending handles.
- Drag and splitter actors now exist only for active interactions; raw pointer samples, preview
  writes, tab-strip geometry, host updates, hit testing, and motion queues are bounded and
  frame-coalesced.
- Browser, protocol, React, and performance evidence now records the direct-interaction suite and
  keeps unverified system-design requirements explicitly unresolved or blocked.

## 0.1.0 - 2026-08-12 — Experimental source release

### Added

- Immutable schema-v2 workspace model and a pure 36-command reference kernel with typed rejection,
  canonicalization, batching, patches, and bounded undo/redo.
- Logical-axis n-ary geometry, exact integer allocation, deterministic panel drop targets, and
  pointer/keyboard splitters.
- React workspace projection with center docking, four-edge container creation, configurable tab
  rails and icon/label modes, stable hosts, focus recovery, and optional motion.
- Restore-before-render IndexedDB persistence with versioned bounded codecs, journaling,
  last-known-good recovery, and visible saved/restored revision evidence in Atlas.
- Prepared external-surface ownership with a controlled same-origin popup demo, rollback, redock,
  and loss recovery.
- Experimental Vue, Svelte, Angular, and Web Components bindings plus protocol, ecosystem,
  conformance, and testkit packages.
- Professional marketing and documentation site, interaction film, live Atlas demo, and automated
  Node/browser verification workflows.

### Availability and boundaries

- This is a source release. All 19 library manifests are private workspace packages and are **not
  published to npm**.
- Every package and support profile remains experimental. There is no stable conformance,
  certification, compatibility, security-review, unrestricted popout, or production-support claim.
- See [Support matrix](docs/SUPPORT.md), [Conformance status](docs/CONFORMANCE.md), and
  [Roadmap](docs/ROADMAP.md) for implemented scope and remaining evidence gates.
