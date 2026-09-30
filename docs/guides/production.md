# Ship with confidence

**Adopt the behavior. Verify the promises.** Panefold's source and tests make the implementation inspectable; they do not replace validation of your application's content and deployment.

## Keyboard and accessible names

Test selection, activation, closing, reordering, splitting, resizing and returning from floating states without a pointer. Confirm that focus lands somewhere useful after a panel disappears. Give icon-only tabs meaningful titles and translated interaction messages through `messageCatalog`.

The React reference includes accessible tabs, splitters and announcements. Automated axe checks are not a claim of complete WCAG conformance. Test the actual screen readers and browsers you support.

## Measure the real content

Use your heaviest editor, map, grid and charts. Check pointer responsiveness while resizing, memory after repeated moves, hidden-panel work, and cleanup after closing a workspace. Pause expensive work on suspension and use the appropriate resize-delivery policy.

The [performance report](../PERFORMANCE.md) is the source for recorded benchmark numbers. It distinguishes end-to-end effects from isolated microbenchmarks and preserves controls and raw samples. Do not copy a single ratio into a universal speed claim.

## Treat restoration as an upgrade path

Test saved layouts from older versions, missing panel providers, corrupted records, unavailable storage and interrupted operations. Separate saved layout from saved domain data. Verify that the save indicator reflects durable status and that failures do not silently reset user work.

## Bound extensions and integrations

Keep authorization in the application and validate incoming commands and serialized state. Trusted plugin primitives and iframe isolation are not a blanket security certification for arbitrary code. Do not include secrets in panel parameters, logs or shareable reproductions.

## Dispose everything you create

A panel may own timers, event handlers, observers, media, subscriptions and GPU resources. A workspace may own runtime subscriptions, journals, protocols, motion and child-window controllers. Test repeated mount/unmount and popout/return cycles, not only a fresh page load.

## Decide with the current support profile

All packages remain experimental. React has the browser reference fixture; other framework bindings have different evidence. Physical mobile, assistive-technology, browser-crash and independent security certification gaps are documented, not implicitly solved by a green build.

Read the [support matrix](../SUPPORT.md), [conformance report](../CONFORMANCE.md), [system-design audit](../DESIGN_AUDIT.md) and [roadmap](../ROADMAP.md) before committing to a product support promise. Pin a reviewed source revision and maintain your own rollback plan.
