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

| Prop                              | Use                                                    |
| --------------------------------- | ------------------------------------------------------ |
| `projector`                       | Snapshot → `WorkspaceProjection`                       |
| `commands`                        | UI intent → your semantic command                      |
| `panels`                          | Type → `{ render, icon?, onLifecycleChange? }`         |
| `layoutSolver`                    | Bridge canonical constraints into geometry             |
| `className`, `workspaceLabel`     | Scoped theme and accessible workspace name             |
| `tabPresentation`                 | Static or per-group placement/content policy           |
| `direction`, `messageCatalog`     | Logical direction and interaction messages             |
| `motion`                          | `off`, `reduced` or `productive`                       |
| `dropBehavior`                    | Edge splitting and center-group swap/merge preferences |
| `responsive`, `compactBreakpoint` | Reversible single-region projection policy             |
| `onCommandResult`                 | Observe dispatch outcomes                              |
| `onExternalPanelRequest`          | Inject controlled external-window integration          |

Read the exact [WorkspaceSurfaceProps](../../packages/react/src/WorkspaceSurface.tsx) and [renderer types](../../packages/react/src/types.ts), including optional hooks and their constraints.

## Public APIs versus reference helpers

`createWorkspaceRuntime`, `WorkspaceRuntimeProvider`, `WorkspaceSurface`, `useWorkspaceSnapshot` and `solveLayout` are package exports.

`projectWorkspace`, `createDemoCommands`, `openDemoWorkspaceSession` and `DemoExternalPanelController` live in `apps/demo/src`. They demonstrate application-owned policy and glue. They are **not** imports from a published Panefold package. Start with them to understand the wiring; rename and adapt them as your application takes ownership.

## Go deeper only when you need to

The [36-command catalog](../COMMANDS.md) is the semantic reference. The [ADRs](../adr/) explain design decisions. The [system design](../spec/SYSTEM_DESIGN.md) is the normative specification. The [support matrix](../SUPPORT.md) tells you which evidence supports which claims.
