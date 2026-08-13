# Changelog

Notable source changes are recorded here. Panefold follows semantic version labels for repository
milestones, but no stable package-compatibility promise exists yet.

## Unreleased

### Added

- Transaction-correlated immutable post-commit effect envelopes, an abortable bounded delivery
  controller with in-process duplicate suppression and explicit idempotent retry, plus an optional
  Effect bridge. Durable and shared sinks must namespace and persist effect IDs themselves.
- Same-strip pointer tab reordering with relational insertion anchors, exact visual markers,
  horizontal LTR/RTL and vertical-rail support, bounded overflow autoscroll, plus equivalent
  keyboard and menu routes.

### Changed

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
