# React integration

**Your components. One workspace contract.** The renderer does not need to understand your application data model, and your kernel does not need to know React.

## Start with the model integration

For an application using `WorkspaceSnapshot`, import the opt-in `@panefold/react/model` entry point.
It provides a complete bridge without requiring you to copy the demo's projector or command
factories. The packages remain experimental and source-only; these imports resolve inside the
Panefold workspace or after you vendor its built workspace packages.

The [compiled starter](../../apps/demo/src/docs-starter.tsx) supplies `initialSnapshot` and
`starterPanels`. Its lifecycle and surface wiring are:

```tsx
import { useEffect, useState } from "react";
import {
  createModelWorkspaceSession,
  ModelWorkspaceSurface,
  type ModelWorkspaceSession,
} from "@panefold/react/model";
import "@panefold/react/styles.css";

function StarterWorkspace() {
  const [session, setSession] = useState<ModelWorkspaceSession>();
  useEffect(() => {
    const next = createModelWorkspaceSession({ initialSnapshot, historyLimit: 50 });
    setSession(next);
    return () => next.dispose();
  }, []);

  return session ? (
    <ModelWorkspaceSurface
      bindings={session}
      panels={starterPanels}
      workspaceLabel="Starter workspace"
      className="starter-surface"
      motion="off"
    />
  ) : (
    <p role="status">Starting workspace…</p>
  );
}
```

The session owns one in-memory runtime and bounded workspace history. Its `runtime` exposes the
normal dispatch, undo/redo and subscription APIs. Creating it in an effect keeps abandoned React
renders from owning live resources; cleanup disposes that exact instance, including Strict Mode's
development setup/cleanup cycle.

`ModelWorkspaceSurface` always installs the model-aware solver. It enforces panel constraints for
both committed layouts and temporary resize geometry. Docking, splitting, tab/container moves,
reordering, closing, floating and redocking go through existing kernel commands; a planned drop
retains one command and the preview computed from that command.

To use a runtime opened through your persistence layer, call
`createModelWorkspaceBindings(runtime, options?)` once for that runtime and pass the returned
bindings to the surface. This helper does not own or dispose the existing runtime. Continue to
follow your durable session's cleanup contract.

## Customize application policy

The optional second argument to `createModelWorkspaceSession` or `createModelWorkspaceBindings`
supports `groupLabel`, `floatingBounds`, `redockTarget`, a shared model `solveLayout`, and individual
`commands` overrides. The default redock destination is the first docked group in main-surface
document order. Applications can choose a named region or relational tab placement instead.

Default drop previews apply pure kernel semantics, not runtime dispatch policies. They match the
committed geometry when the retained command is applied unchanged. A runtime policy can still
reject or transform that command. If a policy rewrites placement, provide corresponding
`planPanelDrop`, `planPanelTabDrop` and/or `planGroupDrop` overrides so the preview describes the
transformed arrangement. The bridge does not execute policies speculatively or consume runtime
command IDs while previewing.

The surface cancels stale UI plans. When calling a planner directly, capture the snapshot revision
used for the request and pass it as `runtime.dispatch(plan.command, { baseRevision })`; the command
itself does not carry a revision guard.

Use the same model solver for preview and committed geometry. If your application changes
constraint policy for smaller screens, supply it here so the visible preview matches the outcome.
The workbench's [thin adapters](../../apps/demo/src/workspace-config.ts) demonstrate its own labels,
small-screen constraints, window bounds and redock preference. Browser popouts still need a
prepared external-window controller; these helpers do not open windows or add persistence.

## Use the generic renderer when needed

`WorkspaceSurface` and `WorkspaceRuntimeProvider` remain available from `@panefold/react` for
custom snapshots, commands or integration ownership. Its explicit pieces are:

| Piece                      | Responsibility                                  | Model integration              |
| -------------------------- | ----------------------------------------------- | ------------------------------ |
| `createWorkspaceSnapshot`  | Build normalized model records                  | `initialSnapshot`              |
| `createWorkspaceRuntime`   | Own committed changes and history               | `createModelWorkspaceSession`  |
| `WorkspaceRuntimeProvider` | Expose the runtime to descendants               | `ModelWorkspaceSurface`        |
| `projector`                | Translate a snapshot into `WorkspaceProjection` | `projectModelWorkspace`        |
| `commands`                 | Translate UI intent into semantic commands      | `createModelWorkspaceCommands` |
| `panels`                   | Map panel types to React components             | `starterPanels`                |
| `WorkspaceSurface`         | Render tabs, content hosts, splits and floats   | `ModelWorkspaceSurface`        |

For a model runtime, obtain these bindings from `createModelWorkspaceBindings` instead of
reimplementing them. The lower-level wiring below is an excerpt; `bindings`, `runtime` and
`starterPanels` are application-owned values.

```tsx
<WorkspaceRuntimeProvider runtime={runtime}>
  <WorkspaceSurface
    projector={bindings.projector}
    commands={bindings.commands}
    panels={starterPanels}
    layoutSolver={bindings.layoutSolver}
    tabPresentation={{ placement: "block-start", content: "icon-and-label" }}
    motion="off"
    workspaceLabel="Starter workspace"
    className="starter-surface"
  />
</WorkspaceRuntimeProvider>
```

## Give the surface space

Import `@panefold/react/styles.css`. Set a real height on the workspace container and allow grid/flex children to shrink with `min-width: 0` and `min-height: 0`. A correct snapshot inside a zero-height element still renders a blank-looking workspace.

```css
.starter-surface {
  width: 100%;
  height: min(70vh, 720px);
  min-height: 360px;
}
```

## Keep identities stable

Create one runtime per workspace session, not one per render. Keep the panel registry and command factories stable. The starter creates its runtime in an effect and disposes the exact instance in cleanup, including React development Strict Mode's setup/cleanup cycle.

A registry entry is `{ render: Component, icon?: ReactNode }`, keyed by a panel's **type**, not its ID. The renderer passes `panel`, `selected`, `active`, `lifecycle` and lifecycle cancellation information to the component.

## Subscribe to the values a component needs

`useWorkspaceSnapshot()` updates a component whenever the runtime publishes a new snapshot.
For a component that only needs part of that snapshot, use
`useWorkspaceProjection(selector, isEqual?)`. It compares the selected value with `Object.is` by
default, so an unrelated workspace change does not trigger that subscription's component render.
Parent renders and the component's own state can still cause it to render.

```tsx
import { useWorkspaceProjection } from "@panefold/react";

type AppSnapshot = {
  readonly revision: number;
  readonly status: { readonly pending: number; readonly failed: number };
};

function SaveStatus() {
  const status = useWorkspaceProjection(
    (snapshot: AppSnapshot) => ({
      pending: snapshot.status.pending,
      failed: snapshot.status.failed,
    }),
    (previous, next) => previous.pending === next.pending && previous.failed === next.failed,
  );
  return <output>{`${status.pending} pending, ${status.failed} failed`}</output>;
}
```

This example uses an application-defined snapshot; select the fields your runtime actually exposes.
Selectors and equality checks must be pure. If a selector creates a new object or array, provide an
equality check that compares all values the component uses, or return an existing immutable value.
When two selections compare equal, the hook keeps the previous selected value. Inline selectors
can capture current props, and changing a selector or runtime takes effect immediately.

The hook uses React's `use-sync-external-store/with-selector` implementation so selection caching
also works with interrupted rendering. Server rendering reads the provided runtime's snapshot
without subscribing; initialize that runtime from the same snapshot when hydrating it.
This changes React subscriptions only: workspace commands, history, persistence and temporary
pointer previews keep their existing behavior.

The [hook regression tests](../../packages/react/test/runtime-context.test.tsx) exercise 100 separate
unrelated snapshot commits. A selected-value consumer does not rerender; a full-snapshot consumer
receives all 100 updates. This is a render-count check, not an application frame-rate benchmark.

## Make geometry model-aware

`ModelWorkspaceSurface` always provides this bridge. When using the generic `WorkspaceSurface`,
its optional `layoutSolver` lets the renderer use constraints from your canonical model. The model
bridge calls `solveLayout(snapshot, nodeId(request.rootNodeId), request.bounds, options)`, forwarding
splitter size and temporary split overrides. Omitting it from a generic surface uses a
constraint-free compatibility solver.

## Resize expensive content on release

`WorkspaceSurface` accepts `resizePreviewMode="separator"` to move a divider marker while panel contents keep their committed dimensions. Pointer release dispatches one resize command. Escape, lost capture, cancellation, a changed layout, or a rejected command removes the preview. Keyboard resizing still applies each step immediately.

The default `"auto"` mode checks the selected panels in visible groups beneath the resized split. The model integration projects `panel.constraints.resizeDelivery` automatically; custom projectors can set `WorkspacePanelView.resizeDelivery`. A visible `"deferred"` panel selects the divider-only preview. Hidden tabs and unrelated groups do not defer a gesture. `"live"` forces the existing frame-coalesced content preview, and `"separator"` forces the marker regardless of panel preferences. The mode is captured at pointer-down.

`"throttled"` and `"adaptive"` preferences currently use the same frame-coalesced preview as `"live"`; they do not implement a separate callback rate or automatic cost detection. Divider-only preview uses the same constraint solver and commit path as live resizing. It does not change the model's weight or constraint semantics. In the demo, choose **Workspace appearance → Resize preview → Divider only**.

## Resize with the keyboard

Focus a divider with Tab. Arrow keys resize along its axis; Shift increases the step from 2% to 10% of the adjacent pair. Inline arrows follow `direction`, including RTL. Home gives the primary pane its smallest attainable size, and End gives it its largest, while keeping the other panes in the split fixed. Alt, Ctrl and Meta combinations remain available to the browser and application.

The separator's `aria-controls` identifies the primary pane: the pane immediately before the divider in logical layout order. Its current value reports that pane's percentage of the adjacent pair, rounded to two decimal places. `aria-valuemin` and `aria-valuemax` report the attainable bounds under the current constraints, including preferred floors when those fit. Home and End use those same bounds. These shortcuts resize panes; they do not change semantic collapse state.

Both built-in solvers provide the resize metadata needed for these bounds. A custom `layoutSolver` can return `ResolvedSplitter.resize` using `createAxisResizePlan` from `@panefold/geometry` with the exact allocation inputs it used. If it transforms geometry or constraints, it must also update that metadata. A custom solver without metadata retains arrow and pointer resizing with the existing 0–100 percentage scale; Home and End are unavailable because the renderer cannot infer its limits. Pointer release commits the exact weights used for the preview.

F6 moves focus to the next visible, enabled divider in the same workspace; Shift+F6 moves backward. Both wrap at the ends. Starting a pointer resize focuses its divider, so Escape cancels the active resize and restores its previous geometry. Keyboard sizing uses the same semantic resize command and result handling as pointer resizing.

## Handle results and cleanup

Use `onCommandResult` to present rejected operations without treating them as successful UI changes. Dispatch receipts can be `committed`, `rejected` or `queued`; a queued receipt is not proof of a completed commit.

Stop subscriptions, dispose the runtime, and release panel-owned resources on teardown. Durable sessions and external-window controllers have additional cleanup order; follow the [persistence](persistence.md) and [window](windows.md) guides rather than disposing them in arbitrary order.
