# ADR-0004: Panel lifecycle leases and stable same-document hosts

Status: Accepted

## Context

Panel content can own expensive or identity-sensitive state: editor models, uncontrolled form
values, canvas/WebGL contexts, media playback, iframe documents, observers, workers, and network
subscriptions. If a framework remounts that content whenever a tab is hidden or moved, the workspace
silently changes application behavior. Conversely, keeping every hidden panel fully active leaks
work and resources.

Selection, activation, semantic ownership, DOM placement, visibility, and resource activity are
different concerns. A panel also needs a deterministic way to stop work from an old lifecycle state
before beginning work for the next one.

## Decision

Panel descriptors carry an explicit lifecycle policy with three independent decisions:

- hidden behavior: `keep-alive`, `detach`, `suspend`, or `application-managed`;
- same-document movement: `preserve-host` or `remount`;
- cross-document movement: `unsupported`, `checkpoint-remount`, `portal-coupled`, or `mirror`.

The React adapter maintains one host keyed by panel identity and portals panel content into it.
Under `preserve-host`, selection changes and same-document group moves relocate/project the host
without remounting its content. Hidden `suspend` panels remain mounted but hidden and inert; the panel
is responsible for pausing its own expensive work.

The adapter delivers `active`, `visible`, or `suspended` lifecycle leases to panel renderers and
optional lifecycle observers. Every lease has a fresh `AbortSignal` and a reason (`mount`,
`activation`, `selection`, `same-document-move`, or `policy-change`). Cleanup ordering is strict:
the previous signal is aborted before the replacement lease callback runs, and the final signal is
aborted on unmount. Cancellation is idempotent.

Lifecycle policy remains serializable semantic metadata. Framework hooks, DOM nodes, abort
controllers, and live resources never enter the canonical snapshot.

Cross-document policy values define application intent only. The current React adapter does not
implement cross-document host transfer; any such operation must use the prepared surface protocol,
checkpointing, ownership tokens, and an adapter with corresponding evidence.

## Consequences

- Same-document movement can preserve uncontrolled state and expensive content identity.
- Panels receive a bounded, race-resistant cancellation boundary for timers, rendering, media, and
  remote work.
- `detach` and `remount` remain explicit opt-ins when preservation is inappropriate.
- Stable hosts add DOM and lifecycle complexity, so focus, accessibility, clipping, stacking, and
  cleanup require dedicated tests.
- Synthetic lifecycle fixtures establish contract behavior but do not certify real editors, maps,
  grids, media, iframes, or microfrontends.
- Browser-window, Picture-in-Picture, and cross-origin lifecycle behavior remains experimental
  protocol work rather than a supported product capability.
