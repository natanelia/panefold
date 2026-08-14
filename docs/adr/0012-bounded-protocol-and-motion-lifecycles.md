# ADR-0012: Bound protocol actors and motion with explicit lifecycles

Status: Accepted

## Context

Drag, resize, close, transfer, recovery, and animation are temporal workflows, but they must never
become a second workspace database. Pointer cancellation, stale revisions, scope disposal, driver
failure, or optional View Transition failure must leave semantic state and owned resources in a
predictable condition.

## Decision

`@panefold/protocol` publishes a twelve-entry experimental descriptor catalog. Each descriptor
names the bounded actor and its principal states; `@panefold/protocol-xstate` supplies the matching
XState implementation. A separate reviewed coverage contract pins the complete state set, a digest
of every ordered transition branch, the guarded-transition count, and stable witnesses for every
adversarial, interruption, timeout, recovery, finalizer, and impossible-event obligation. This
prevents a new or reordered branch from inheriting coverage merely because a test visited the same
state.

A scoped wrapper binds an actor to one identity and abort signal, rejects stale identity/revision
events, retains a bounded trace, and stops exactly once when the owner closes. Its scheduler owns
both trace time and a replaceable typed phase deadline. The system scheduler is the ordinary
default; tests inject a deterministic FIFO scheduler so advancing virtual time exercises the same
addressed-event path used in production. Firing, cancellation, replacement, explicit stop, and
parent-scope abort each release the appropriate deadline handle exactly once, and a late callback
cannot reach a stopped actor or consume a replacement deadline.

The coverage runner breadth-first explores bounded persisted snapshots from reviewed event
fixtures, records the actual XState microsteps, observes both selection and rejection for every
guard, and checks ignored events from every reached snapshot. A result is valid only when the
reviewed graph digest matches the implementation, every declared state and transition is reachable,
every obligation has its named witness, deterministic replay is byte-equivalent, and no deadline
handle remains. The 2026-08-14 compact-profile result covers 12 protocols, 84 states, 258 transition
branches, both selection and rejection for 64 guarded branches, 146 obligations, 533 bounded
snapshots, and 7,837 impossible-event checks. Its 36 phase-specific timeout scenarios perform 84
literal schedules: 72 firings across primary and replay runs plus 12 cancelled twins, with zero
pending handles.

Motion execution returns a managed lease with explicit `finish`, `cancel`, `skip`, and `dispose`
operations. Completion and cleanup are idempotent, queued work belongs to the same scope, and a
driver rejection applies the intended final state. View Transitions are progressive enhancement:
unsupported, skipped, failed, or disposed transitions commit semantic work once and fall back to
FLIP or immediate projection. The load planner degrades decoration before spatial continuity and
never degrades direct-input tracking.

Neither an actor nor a motion lease stores canonical workspace ownership. A semantic command is the
only durable commit; actor context, pointer previews, traces, and visual tombstones are disposable
operational state.

## Consequences

- Scope closure, cancellation, capture loss, and driver failure have explicit testable cleanup.
- The graph contract prevents undocumented actor or transition proliferation and makes coverage
  drift fail closed.
- Deterministic phase deadlines exercise the production addressed-event path without wall-clock
  sleeps, including replacement, firing, and cancellation.
- Optional animation cannot suppress or duplicate a semantic commit.
- This closes the headless state-machine scope of `TST-003`; it does not establish the final panel
  location required by `TST-009`.
- Browser timers, popup/CSP/permission behavior, storage media, distributed hosting, process or
  monitor loss, physical latency, one-pixel re-grab continuity, browser View Transition behavior,
  DOM tombstones, focus, and style ownership still require their own environment or manual
  evidence.
