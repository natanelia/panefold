# React integration

**Your components. One workspace contract.** The renderer does not need to understand your application data model, and your kernel does not need to know React.

## The integration pieces

| Piece                      | Responsibility                                  | Starter source                        |
| -------------------------- | ----------------------------------------------- | ------------------------------------- |
| `createWorkspaceSnapshot`  | Build normalized model records                  | `initialSnapshot`                     |
| `createWorkspaceRuntime`   | Own committed changes and history               | Starter effect                        |
| `WorkspaceRuntimeProvider` | Expose the runtime to descendants               | `StarterWorkspace`                    |
| `projector`                | Translate a snapshot into `WorkspaceProjection` | `projectWorkspace` reference helper   |
| `commands`                 | Translate UI intent into semantic commands      | `createDemoCommands` reference helper |
| `panels`                   | Map panel types to React components             | `starterPanels`                       |
| `WorkspaceSurface`         | Render tabs, content hosts, splits and floats   | `StarterSurface`                      |

See the complete, compiled [starter source](../../apps/demo/src/docs-starter.tsx). The following is a wiring excerpt, not a standalone program; its named values are defined in that file and the reference helpers.

```tsx
<WorkspaceRuntimeProvider runtime={runtime}>
  <WorkspaceSurface
    projector={projectWorkspace}
    commands={commands}
    panels={starterPanels}
    layoutSolver={layoutSolver}
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

The optional `layoutSolver` bridge lets the renderer use constraints from the canonical model. The reference bridge calls `solveLayout(snapshot, nodeId(request.rootNodeId), request.bounds, options)`, forwarding splitter size and temporary split overrides. Omitting the model-aware bridge is not equivalent to enforcing all model constraints.

## Resize expensive content on release

`WorkspaceSurface` accepts `resizePreviewMode="separator"` to move a divider marker while panel contents keep their committed dimensions. Pointer release dispatches one resize command. Escape, lost capture, cancellation, a changed layout, or a rejected command removes the preview. Keyboard resizing still applies each step immediately.

The default `"auto"` mode checks the selected panels in visible groups beneath the resized split. Project `panel.constraints.resizeDelivery` into `WorkspacePanelView.resizeDelivery`; a visible `"deferred"` panel selects the divider-only preview. Hidden tabs and unrelated groups do not defer a gesture. `"live"` forces the existing frame-coalesced content preview, and `"separator"` forces the marker regardless of panel preferences. The mode is captured at pointer-down.

`"throttled"` and `"adaptive"` preferences currently use the same frame-coalesced preview as `"live"`; they do not implement a separate callback rate or automatic cost detection. Divider-only preview uses the same constraint solver and commit path as live resizing. It does not change the model's weight or constraint semantics. In the demo, choose **Workspace appearance → Resize preview → Divider only**.

## Resize with the keyboard

Focus a divider with Tab. Arrow keys resize along its axis; Shift increases the step from 2% to 10% of the adjacent pair. Inline arrows follow `direction`, including RTL.

The separator's `aria-controls` identifies the primary pane: the pane immediately before the divider in logical layout order. Its current value reports that pane's percentage of the adjacent pair, rounded to two decimal places. The 0–100 scale describes that percentage; it does not claim that every percentage is attainable under the active constraints.

F6 moves focus to the next visible, enabled divider in the same workspace; Shift+F6 moves backward. Both wrap at the ends. Starting a pointer resize focuses its divider, so Escape cancels the active resize and restores its previous geometry. Keyboard sizing uses the same semantic resize command and result handling as pointer resizing.

## Handle results and cleanup

Use `onCommandResult` to present rejected operations without treating them as successful UI changes. Dispatch receipts can be `committed`, `rejected` or `queued`; a queued receipt is not proof of a completed commit.

Stop subscriptions, dispose the runtime, and release panel-owned resources on teardown. Durable sessions and external-window controllers have additional cleanup order; follow the [persistence](persistence.md) and [window](windows.md) guides rather than disposing them in arbitrary order.
