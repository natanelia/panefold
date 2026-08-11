# Conformance status

The repository is an **experimental executable specification**. It does not claim stable conformance
to the full workspace runtime system design that informed this implementation.

## Evidence present in 0.1

- Strict TypeScript compilation and package-boundary linting.
- Pure-kernel unit and property tests.
- Canonicalization idempotence, invariant, determinism, rejection-atomicity, and undo/redo tests.
- Solver constraint, overflow, rounding, and exact-conservation tests.
- Runtime reentrant-queue, overflow, subscriber-isolation, and selector tests.
- React semantics, keyboard, focus, and build fixtures.
- A machine-readable capability manifest at [`conformance/manifest.json`](../conformance/manifest.json).

## Stable gates not yet satisfied

- Ten million generated semantic operations and bounded exhaustive exploration.
- An independent optimized kernel with differential results after every generated command.
- Manual WCAG 2.2 AA evidence across NVDA, JAWS, VoiceOver, and TalkBack profiles.
- Published 60 Hz and 120 Hz performance traces across every mandatory workload.
- Lifecycle torture with certified editor, map, iframe, media, grid, and microfrontend fixtures.
- Crash-safe IndexedDB snapshot/journal migrations and recovery reports.
- Formal multi-window ownership proof and failure injection at every transfer step.
- Certified non-React framework adapters, plugin isolation, and distributed collaboration.
- Signed security, migration, recovery, accessibility, performance, and compatibility reports.

Any future stable claim must pass every applicable `MUST` requirement and hard release gate for the
published support profile. Missing evidence narrows the claim; it is never treated as a pass.
