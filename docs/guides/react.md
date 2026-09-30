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

## Make geometry model-aware

The optional `layoutSolver` bridge lets the renderer use constraints from the canonical model. The reference bridge calls `solveLayout(snapshot, nodeId(request.rootNodeId), request.bounds, options)`, forwarding splitter size and temporary split overrides. Omitting the model-aware bridge is not equivalent to enforcing all model constraints.

## Handle results and cleanup

Use `onCommandResult` to present rejected operations without treating them as successful UI changes. Dispatch receipts can be `committed`, `rejected` or `queued`; a queued receipt is not proof of a completed commit.

Stop subscriptions, dispose the runtime, and release panel-owned resources on teardown. Durable sessions and external-window controllers have additional cleanup order; follow the [persistence](persistence.md) and [window](windows.md) guides rather than disposing them in arbitrary order.
