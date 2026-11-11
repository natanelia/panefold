# API field guide

**Find the extension point, then read the exact type.** This page maps common jobs to the current source; it is not a promise that the experimental API will never change.

## Pick a package by responsibility

| Task                                                    | Package or source                                  |
| ------------------------------------------------------- | -------------------------------------------------- |
| IDs, records, snapshot factories, command types         | `@panefold/model`                                  |
| Validate/reduce commands, plan semantic drop operations | `@panefold/kernel`                                 |
| Solve constrained layout geometry                       | `@panefold/geometry`                               |
| Dispatch, history, subscriptions, durable opening       | `@panefold/runtime`                                |
| IndexedDB journal adapter and optional Effect bridges   | `@panefold/runtime-effect`                         |
| React provider, hooks, surface and styles               | `@panefold/react`                                  |
| Prepared external-window ownership and browser adapters | `@panefold/surfaces`                               |
| Driver-neutral protocols / XState actors                | `@panefold/protocol` / `@panefold/protocol-xstate` |
| Workloads and verification helpers                      | `@panefold/testkit`                                |

All packages are currently unpublished workspace packages. For the complete package inventory and boundaries, read [Architecture](../ARCHITECTURE.md).

## The renderer props you will use most

| Prop                              | Use                                                        |
| --------------------------------- | ---------------------------------------------------------- |
| `projector`                       | Snapshot → `WorkspaceProjection`                           |
| `commands`                        | UI intent → your semantic command                          |
| `panels`                          | Type → `{ render, icon?, onLifecycleChange? }`             |
| `layoutSolver`                    | Bridge canonical constraints into geometry                 |
| `className`, `workspaceLabel`     | Scoped theme and accessible workspace name                 |
| `tabPresentation`                 | Static or per-group placement/content policy               |
| `direction`, `messageCatalog`     | Logical direction and interaction messages                 |
| `motion`                          | `off`, `reduced` or `productive`                           |
| `resizePreviewMode`               | `auto`, `live` or a divider-only `separator` preview       |
| `splitResizeDisabled`             | Disable pane-divider input; cancel any active divider drag |
| `dropBehavior`                    | Edge splitting and center-group swap/merge preferences     |
| `responsive`, `compactBreakpoint` | Reversible single-region projection policy                 |
| `onCommandResult`                 | Observe dispatch outcomes                                  |
| `onExternalPanelRequest`          | Inject controlled external-window integration              |

Read the exact [WorkspaceSurfaceProps](../../packages/react/src/WorkspaceSurface.tsx) and [renderer types](../../packages/react/src/types.ts), including optional hooks and their constraints.

## Public APIs versus reference helpers

`createWorkspaceRuntime`, `WorkspaceRuntimeProvider`, `WorkspaceSurface`, `useWorkspaceSnapshot`, `useWorkspaceProjection` and `solveLayout` are package exports.

For custom layout solvers, `@panefold/geometry` exports `createAxisResizePlan`,
`getAxisResizeBounds` and `resizeAxis`. Attach a plan to `ResolvedSplitter.resize` to give the React
renderer pixel-based adjacent resizing and verified keyboard limits. Changed layouts from
`resizeAxis` use positive canonical weights; unchanged requests preserve the existing weights.
Preview and commit those same weights. Integer pixels and finite canonical weight precision can
leave gaps between attainable sizes. Extreme numeric layouts use a bounded search for the closest
verified state; it does not exhaustively enumerate every representable allocation. The shared
`normalizeSplitWeights` helper lives in `@panefold/model`; the kernel's existing `normalizeWeights`
export remains available.

`useWorkspaceProjection(selector, isEqual?)` subscribes to a selected snapshot value. The optional
equality check defaults to `Object.is`; equal selections keep their previous identity and do not
trigger a render from the subscription. Use `useWorkspaceSnapshot()` when a component needs the
whole snapshot. See [React integration](react.md#subscribe-to-the-values-a-component-needs) for an
object-selection example and the requirements for selectors, equality checks and server rendering.

The opt-in `@panefold/react/model` entry point adds:

| Export                                                  | Responsibility                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `createModelWorkspaceSession(runtimeOptions, options?)` | Own an in-memory runtime and complete model bindings; expose explicit `dispose()` |
| `createModelWorkspaceBindings(runtime, options?)`       | Bind an existing runtime while leaving its lifetime with the caller               |
| `ModelWorkspaceSurface`                                 | Install the bindings' provider, projector, commands and model solver together     |
| `projectModelWorkspace(snapshot, options?)`             | Project the main surface and same-document floating surfaces                      |
| `createModelWorkspaceCommands(getSnapshot, options?)`   | Create semantic commands and kernel-based drop plans for a captured revision      |

`ModelWorkspaceOptions` exposes application labels, floating bounds, redock targets, shared model
geometry and individual command overrides. See [React integration](react.md) for lifecycle and
constraint details.

`projectWorkspace`, `createDemoCommands`, `openDemoWorkspaceSession` and `DemoExternalPanelController`
still live in `apps/demo/src`. The first two are thin application-policy wrappers around the official
model bridge. Durable opening and browser-window controllers remain application-owned examples.
Every package and subpath is still workspace-local, experimental and unpublished.

## Go deeper only when you need to

The [36-command catalog](../COMMANDS.md) is the semantic reference. The [ADRs](../adr/) explain design decisions. The [system design](../spec/SYSTEM_DESIGN.md) is the normative specification. The [support matrix](../SUPPORT.md) tells you which evidence supports which claims.
