# Architecture

## Governing rule

**Commit truth immediately; animate the explanation.**

A workspace operation is correct with every optional animation disabled. The DOM, framework,
protocol actors, persistence, and browser surfaces are projections or operational collaborators;
none may mutate canonical state directly.

## Five planes

1. **Semantic plane** — normalized immutable state and the pure transaction kernel.
2. **Spatial plane** — constraint aggregation, allocation, geometry, and drop-target calculation.
3. **Protocol plane** — bounded temporary interactions such as drag and resize.
4. **Motion plane** — interruptible visual interpolation after semantic commit.
5. **Operational plane** — fallible persistence, transport, resource scopes, retries, and tracing.

The ordinary public API hides Effect and XState. Their adapters are optional packages and cannot
appear in serialized data or headless contracts.

## Canonical state

The model is normalized. Group membership and tab order exist only in the group record; parent
indexes and geometry are derived. A panel ID is independent of its React component, DOM host, group,
or surface.

Every accepted transaction must leave a state where:

- each live panel belongs to exactly one group;
- each group has one reachable group node;
- every layout node is reachable from exactly one surface root and no cycles exist;
- each non-placeholder group is non-empty and selects one of its panels;
- canonical splits have at least two children and positive normalized weights;
- there are no dangling, duplicate, non-finite, or ineligible references;
- rejected commands do not advance revision or expose patches.

Canonicalization is deterministic and idempotent. It flattens adjacent same-axis splits, removes
unary splits and transient empty groups, normalizes weights, repairs eligible activation, and uses
stable ordering for serialization and hashing.

## Transaction ordering

1. Attach command identity, origin, label, and base revision.
2. Validate untrusted boundary data.
3. Read one immutable snapshot and evaluate deterministic policies.
4. Plan the pure reduction and any prepare-before-commit work.
5. Prepare fallible resources outside the kernel when required.
6. Revalidate revision, policy, target, and prepared capability.
7. Reduce, canonicalize, validate invariants, derive inverse, and calculate patches.
8. Atomically publish the new snapshot and revision.
9. Notify the renderer/focus channel synchronously.
10. Start optional motion against committed state.
11. Publish the transaction stream.
12. Run post-commit operational work and finalize scopes.

Commands dispatched by transaction subscribers enter a bounded FIFO queue and run after the
current notification completes. Capacity and per-drain budgets are explicit runtime options;
overflow returns a typed rejection, and draining is iterative so subscriber chains cannot grow the
JavaScript stack.

## Geometry

Docked layouts are surface-rooted n-ary trees using logical `inline` and `block` axes. Each split:

1. subtracts splitter thickness;
2. aggregates hard minimum, preferred, maximum, grow, and shrink constraints;
3. allocates preferred or weight-proportional lengths;
4. freezes children at bounds and redistributes remaining space;
5. applies an explicit overflow outcome if hard minima cannot fit;
6. rounds by largest remainder with stable ID tie-breaking;
7. verifies that rounded children plus splitters equal the available pixels exactly.

The pure solver accepts both committed and speculative inputs, so an adapter can use one geometry
path for both. In `0.1.0` (experimental) it is a tested headless package and is not yet wired into the
compact React demo; that demo projects weights with CSS flex and therefore does not enforce panel
constraints.

## Rendering

React uses an external store (`useSyncExternalStore`). Workspace state is not placed in a changing
context value. The intended production adapter keeps pointer and geometry frames outside React and
uses direct projection for transient geometry. The compact 0.1 reference renderer deliberately has
a narrower claim: it keeps semantic state in the runtime but uses component-local preview weights
during splitter gestures. It is a correctness/accessibility fixture, not a performance profile.

The reference renderer separates semantic chrome, content hosts, and overlays. Stable-host mode for
heavy content is intentionally limited in this release and remains experimental.

## Architectural decisions

- [ADR-0001: One authoritative pure kernel](adr/0001-authoritative-kernel.md)
- [ADR-0002: Experimental vertical slice](adr/0002-experimental-scope.md)
