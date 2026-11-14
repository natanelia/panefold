# API field guide

**Start with `Workspace` or `createWorkspace`.** The default API covers the canonical workspace
model. The lower-level adapters remain available when your application owns a different model.

## Choose a starting point

| Job                                                       | API                                      | Import                    |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------- |
| Render a React workspace with automatic setup and cleanup | `Workspace` + `WorkspaceSurface`         | `@panefold/react`         |
| Create an in-memory workspace outside React               | `createWorkspace(options)`               | `@panefold/runtime`       |
| Render an externally owned runtime                        | `WorkspaceProvider` + `WorkspaceSurface` | `@panefold/react`         |
| Describe nested groups and splits as a snapshot           | `createWorkspaceLayout(input)`           | `@panefold/model`         |
| Fill defaults for one immutable panel record              | `createPanel(input)`                     | `@panefold/model`         |
| Add action helpers to an existing runtime                 | `createWorkspaceActions(runtime)`        | `@panefold/runtime`       |
| Prepare composable operations without dispatching         | `createWorkspacePlans(runtime)`          | `@panefold/runtime`       |
| Render custom snapshots and commands                      | Generic provider, surface and hooks      | `@panefold/react/adapter` |
| Customize explicit model projection and command planning  | Model bindings and planners              | `@panefold/react/model`   |

All packages remain experimental, workspace-local and unpublished. The
[React guide](react.md) has a complete example and a migration table for the changed root exports.

## React hooks

These hooks read the nearest `Workspace` or `WorkspaceProvider`. Snapshot and command types are
inferred; explicit generic arguments are unnecessary.

| Hook                                       | Returns                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| `useWorkspaceActions()`                    | Stable application action helpers                     |
| `useWorkspacePlans()`                      | Immutable operation plans for atomic batches          |
| `useWorkspaceRuntime()`                    | The canonical runtime, including dispatch and history |
| `useWorkspaceSnapshot()`                   | The complete immutable snapshot                       |
| `useWorkspaceSelector(selector, isEqual?)` | A selected snapshot value with optional equality      |
| `useWorkspaceTransactions()`               | Typed committed transactions                          |

Selectors default to `Object.is`. Equal selections retain their previous identity and do not
trigger a render from that subscription. Parent renders and local component state still can.
Selectors and equality functions must be pure; compare every value your component uses when
selecting a fresh object. See the [subscription guide](react.md#subscribe-to-the-values-a-component-needs).

## Workspace roots

`Workspace` owns its runtime and exposes context. Compose ordinary React children beneath it in
any order; the root adds no DOM wrapper and does not render a surface implicitly. You can use it
for application controls without mounting a surface at all.

`WorkspaceProvider` establishes the same context for an existing `workspace` and leaves the
runtime's lifetime with the caller.

| Prop        | Use                                                                            |
| ----------- | ------------------------------------------------------------------------------ |
| `initial`   | Layout definition or `initialSnapshot`, plus runtime options; `Workspace` only |
| `workspace` | Application-owned runtime; `WorkspaceProvider` only                            |
| `options`   | Model labels, UI command policy and shared model geometry                      |
| `children`  | Your surface, toolbars, wrappers, inspectors or other application content      |
| `fallback`  | Content before effect setup, including server rendering; `Workspace` only      |

`Workspace` captures `initial` and `options` for its mounted session. Change its React `key` to
create a different workspace. No live runtime is created during render; cleanup disposes the one
created by each setup effect.

## Surface props

Place `WorkspaceSurface` anywhere beneath either root. It reads the model bindings from context,
so no explicit bindings, projector or command factory is required. Its presentation props update
normally without restarting the runtime.

| Prop                              | Use                                                           |
| --------------------------------- | ------------------------------------------------------------- |
| `panels`                          | Panel type → `{ render, icon?, onLifecycleChange? }`          |
| `className`, `workspaceLabel`     | Scoped styles and accessible workspace name                   |
| `tabPresentation`                 | Static or per-group placement/content policy                  |
| `direction`, `messageCatalog`     | Logical direction and interaction messages                    |
| `motion`                          | `off`, `reduced` or `productive`                              |
| `resizePreviewMode`               | `auto`, `live` or a divider-only `separator` preview          |
| `splitResizeDisabled`             | Disable pane-divider input and cancel any active divider drag |
| `dropBehavior`                    | Edge splitting and center-group swap/merge preferences        |
| `responsive`, `compactBreakpoint` | Reversible single-region projection policy                    |
| `onCommandResult`                 | Observe operations dispatched by the surface                  |
| `onExternalPanelRequest`          | Inject controlled external-window integration                 |

Read the exact [component and hook types](../../packages/react/src/model.tsx). For custom session
composition, `useWorkspaceSession(initial, options?)` exposes the same owned session lifecycle and
returns `undefined` until setup. Ordinary applications can compose `Workspace` and
`WorkspaceSurface` directly.

## Actions and layout data

`workspace.actions` and `useWorkspaceActions()` expose selection, activation, open/close/reopen,
move, split, float/redock, resize/equalize and undo/redo helpers. They accept string IDs and return
existing runtime receipts, including rejection and queued status. See the
[action examples](layouts.md#dispatch-an-application-action) and the exact
[actions types](../../packages/runtime/src/actions.ts).

`workspace.plan` and `useWorkspacePlans()` prepare immutable panel and layout operations using the
matching action-helper names. Undo and redo remain separate history operations.
`workspace.actions.batch(plans, options?)` combines plans into one atomic commit and undo
step. Plans retain their runtime and source revision; stale plans reject. See
[composing actions](layouts.md#compose-actions-into-one-transaction) for options and boundaries.
Batch operations prepare sequentially against staged results, so opening a panel and then splitting
that new panel can be one transaction. `plan.command` describes its original standalone preview;
the final batch may derive a different command after earlier operations.

`createWorkspace` accepts either a compact `panels` + `layout` definition or an `initialSnapshot`,
plus runtime options such as bounded history and command policies. It returns the normal runtime
with `actions` and `plan` properties, so `dispatch`, `subscribe`, `getSnapshot`, `undo`, `redo` and `dispose`
remain available on the same object.

`createWorkspaceLayout` returns the existing snapshot schema. `PanelInput` accepts partial
capabilities and lifecycle policies. `WorkspaceGroupLayout` names panels and optional selection;
`WorkspaceSplitLayout` nests children with a logical axis and optional relative weights. The
[layout guide](layouts.md#describe-the-initial-layout) explains IDs, defaults and validation.

## Advanced packages

| Responsibility                                                 | Package                                            |
| -------------------------------------------------------------- | -------------------------------------------------- |
| IDs, normalized records, snapshot factories and command types  | `@panefold/model`                                  |
| Validate/reduce commands and plan semantic drops               | `@panefold/kernel`                                 |
| Solve constrained geometry                                     | `@panefold/geometry`                               |
| Dispatch, policies, history, subscriptions and durable opening | `@panefold/runtime`                                |
| IndexedDB journal adapter and optional Effect bridges          | `@panefold/runtime-effect`                         |
| Prepared external-window ownership and browser adapters        | `@panefold/surfaces`                               |
| Driver-neutral protocols and XState actors                     | `@panefold/protocol` / `@panefold/protocol-xstate` |
| Workloads and verification helpers                             | `@panefold/testkit`                                |

The advanced `/model` React entry point retains `createModelWorkspaceSession`,
`createModelWorkspaceBindings`, `ModelWorkspaceSurface`, `projectModelWorkspace` and
`createModelWorkspaceCommands`. `ModelWorkspaceOptions` remains the shared UI policy type. These
are package exports; the demo's `projectWorkspace`, `createDemoCommands`,
`openDemoWorkspaceSession` and `DemoExternalPanelController` remain application examples.

For custom layout solvers, `@panefold/geometry` exports `createAxisResizePlan`,
`getAxisResizeBounds` and `resizeAxis`. Attach a plan to `ResolvedSplitter.resize` to supply
pixel-based adjacent resizing and verified keyboard limits. Preview and commit the same weights.
Finite pixel and weight precision can leave gaps between attainable sizes; extreme numeric
layouts use a bounded search for the closest verified state. `normalizeSplitWeights` lives in
`@panefold/model`; the kernel's `normalizeWeights` remains available.

## Go deeper when needed

The [36-command catalog](../COMMANDS.md) is the semantic reference. The
[architecture](../ARCHITECTURE.md) and [ADRs](../adr/) explain boundaries and design decisions.
The [system design](../spec/SYSTEM_DESIGN.md) is the normative specification; the
[support matrix](../SUPPORT.md) describes the evidence behind support claims.
