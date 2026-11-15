# React integration

**Your components. One workspace contract.** The renderer does not need to understand your application data model, and your kernel does not need to know React.

## Start with a workspace

`@panefold/react` provides the canonical-model integration by default. `Workspace` owns the runtime
and context. `WorkspaceSurface` renders the layout wherever you place it beneath that root:

```tsx
import { Workspace, WorkspaceSurface } from "@panefold/react";
import "@panefold/react/styles.css";
import "./workspace.css";

const initial = {
  panels: [
    { id: "notes", type: "note", title: "Notes" },
    { id: "preview", type: "preview", title: "Preview" },
  ],
  layout: { id: "main", panels: ["notes", "preview"] },
  historyLimit: 50,
};
const panels = {
  note: { render: () => <textarea aria-label="Your note" /> },
  preview: { render: () => <p>Your preview goes here.</p> },
};

export function App() {
  return (
    <Workspace initial={initial} fallback={<p role="status">Starting workspace…</p>}>
      <WorkspaceSurface panels={panels} workspaceLabel="My workspace" className="my-workspace" />
    </Workspace>
  );
}
```

```css
.my-workspace {
  height: 480px;
}
```

The packages remain experimental and source-only; these imports resolve inside the Panefold
workspace or after you vendor its built workspace packages. The
[compiled starter](../../apps/demo/src/docs-starter.tsx) adds nested layout, a toolbar, typed
selectors and tab presentation.

`Workspace` creates the runtime in an effect and disposes that exact instance on cleanup,
including React Strict Mode's development setup/cleanup cycle. Before setup, including server
rendering, it renders `fallback`. Abandoned renders do not own live runtimes.

`initial` and `options` are **setup values**. Inline objects do not recreate the workspace, and later
changes do not reset a user's arrangement. To open a different workspace, change the React `key`
on `Workspace`. A lazy `initial={() => options}` initializer is also supported; keep it safe to run
again after effect cleanup, including development Strict Mode and Activity reveal. Presentation props
on `WorkspaceSurface`, such as `tabPresentation`, `motion` and `splitResizeDisabled`, can update normally.

The default model solver enforces panel constraints for both committed layouts and temporary
resize geometry. Docking, splitting, tab/container moves, closing, floating and redocking go
through the existing kernel commands.

## Keep layout and history across Activity

React [`Activity`](https://react.dev/reference/react/Activity) cleans up its children's effects when
hidden and runs them again when revealed. If `Workspace` is inside that boundary, hiding it disposes
its runtime. Revealing it creates a new runtime from the captured `initial` values, resetting
workspace layout and undo/redo history. The
same ownership rule applies to `useWorkspaceSession` inside an Activity boundary.

Keep `Workspace` outside `Activity` when layout and history must survive. Place the surface and
controls inside the boundary so their effects can pause while the runtime remains alive:

```tsx
import { Activity } from "react";
import { Workspace, WorkspaceSurface } from "@panefold/react";

// Using initial, panels and styles from the first example:
function ToggleableWorkspace({ visible }: { readonly visible: boolean }) {
  return (
    <Workspace initial={initial}>
      <Activity mode={visible ? "visible" : "hidden"}>
        <WorkspaceSurface panels={panels} className="my-workspace" />
      </Activity>
    </Workspace>
  );
}
```

For an application-owned lifetime, use `WorkspaceProvider` with a runtime whose owner is outside
the Activity subtree. The provider never disposes that runtime; its owner decides when to end the
session. See [supplying an existing runtime](#supply-an-existing-runtime).

## Use typed actions and state

Compose your controls, wrappers, surface and status content as ordinary React children. The root
adds no DOM wrapper or implicit surface and imposes no ordering. Descendants share its typed
workspace context:

```tsx
import {
  Workspace,
  WorkspaceSurface,
  useWorkspaceActions,
  useWorkspaceSelector,
} from "@panefold/react";

function NotesButton() {
  const actions = useWorkspaceActions();
  const exists = useWorkspaceSelector((snapshot) => snapshot.panels.byId.notes !== undefined);
  return (
    <button disabled={!exists} onClick={() => actions.selectPanel("notes")}>
      Show notes
    </button>
  );
}

function PanelCount() {
  const count = useWorkspaceSelector((snapshot) => snapshot.panels.ids.length);
  return <output>{count} panels</output>;
}

// Using initial and panels from the first example:
<Workspace initial={initial}>
  <header>
    <NotesButton />
  </header>
  <div className="workspace-area">
    <WorkspaceSurface panels={panels} className="my-workspace" />
  </div>
  <footer>
    <PanelCount />
  </footer>
</Workspace>;
```

No generic type arguments are needed. `useWorkspaceSnapshot()` reads the whole model snapshot;
`useWorkspaceSelector(selector, isEqual?)` reads a selected value; `useWorkspaceRuntime()` exposes
dispatch, subscriptions and history. `useWorkspaceTransactions()` reads typed committed
transactions and updates when the provider changes.

`useWorkspacePlans()` prepares immutable operations without dispatching them. Combine plans from
different application controls or helper functions with `actions.batch(plans)` to commit one atomic,
undoable change. See [composing actions](layouts.md#compose-actions-into-one-transaction).

Actions return the original `committed`, `rejected` or `queued` receipt. Handle failures in your
application controls as you would in the surface's `onCommandResult`; that surface callback does
not observe commands dispatched by an unrelated button. A queued receipt is not a completed
commit. See [layouts and commands](layouts.md) for open, close, split, move, float and reopen
helpers.

## Supply an existing runtime

For an externally owned runtime, use `WorkspaceProvider` and `WorkspaceSurface` from the same root
entry point. The provider prepares the model bindings; the surface reads them from context:

```tsx
import { WorkspaceProvider, WorkspaceSurface } from "@panefold/react";

// workspace was created by your application or durable session.
<WorkspaceProvider workspace={workspace}>
  <NotesButton />
  <WorkspaceSurface panels={panels} className="my-workspace" />
</WorkspaceProvider>;
```

`WorkspaceProvider` never disposes the supplied runtime. Create it outside render and follow its
owner's cleanup contract. For a plain in-memory runtime, use `createWorkspace(options)` from
`@panefold/runtime`; it accepts a compact layout definition or an existing `initialSnapshot` and
exposes `workspace.actions`, `workspace.plan` and the complete runtime API. A durable session retains its own
restoration and disposal requirements.

## Customize application policy

`Workspace` and `WorkspaceProvider` accept `options` with group labels, floating bounds, redock
targets, a shared model `solveLayout`, and individual UI `commands` overrides. The default redock
destination is the first docked group in main-surface document order. Actions returned by
`useWorkspaceActions()` are the standard semantic helpers; UI factory overrides do not rewrite
those actions. Put shared authorization or command transformation rules in runtime policies.

Default drop previews apply pure kernel semantics. They match committed geometry when the planned
command is applied unchanged. If a runtime policy rewrites placement, provide matching
`planPanelDrop`, `planPanelTabDrop` and/or `planGroupDrop` overrides. The bridge does not execute
policies speculatively or consume runtime command IDs while previewing.

The surface cancels stale UI plans. When directly calling a UI drop planner from the advanced model
bridge, capture the snapshot revision used for the request and pass it as
`runtime.dispatch(plan.command, { baseRevision })`;
the command itself does not carry a revision guard.

Use the same model solver for preview and committed geometry. The workbench's
[thin adapters](../../apps/demo/src/workspace-config.ts) demonstrate custom labels, small-screen
constraints, window bounds and redock preference. Browser popouts still need a prepared
external-window controller; the React helpers do not open windows or add persistence.

## Advanced adapters and migration

This release changes the React root API. The old generic renderer and hooks live at
`@panefold/react/adapter`; the explicit model bridge remains at `@panefold/react/model`.

| Previous integration                                                                 | Current API                                                                                                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Effect-created `createModelWorkspaceSession` plus `ModelWorkspaceSurface`            | `<Workspace initial={options}><WorkspaceSurface panels={renderers} /></Workspace>`                                               |
| `createModelWorkspaceBindings(runtime)` and a surface with `bindings`                | `<WorkspaceProvider workspace={runtime}><WorkspaceSurface panels={renderers} /></WorkspaceProvider>`                             |
| Model-specific prefixed hooks                                                        | Root `useWorkspaceActions`, `useWorkspaceRuntime`, `useWorkspaceSnapshot`, `useWorkspaceSelector` and `useWorkspaceTransactions` |
| Generic root `WorkspaceSurface` accepting `projector`, `commands` and `layoutSolver` | The same generic `WorkspaceSurface` from `@panefold/react/adapter`                                                               |
| Generic root `WorkspaceRuntimeProvider` and generic hooks                            | Import from `@panefold/react/adapter`                                                                                            |
| `useWorkspaceProjection` for a canonical snapshot                                    | Root `useWorkspaceSelector`                                                                                                      |
| `useWorkspaceProjection` for a custom snapshot                                       | `useWorkspaceProjection` from `@panefold/react/adapter`                                                                          |

Custom snapshots and commands still use the generic adapter. Model applications rarely need to
provide projection, commands or geometry manually. The advanced `/model` exports remain useful
for explicit model bindings, projection and revision-aware command planning. The generic root-to-
adapter import change does not migrate saved layout data; the snapshot schema and command catalog
are unchanged.

For generic transaction logs, `getTransactions()` may reconstruct both the array and its entries.
Entries are immutable: replace or reconstruct an entry when its data changes. The hook caches the
log between notifications. Notify every log change through `subscribeTransactions`, or through
`subscribe` when a separate transaction subscription is absent.
The hook refreshes after subscribing, including when Activity resumes a hidden view.

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

Create one runtime per workspace session. Keep the panel registry and command factories stable.
`Workspace` handles effect setup and cleanup for in-memory sessions; applications
that own a durable session keep its explicit cleanup contract.

A registry entry is `{ render: Component, icon?: ReactNode }`, keyed by a panel's **type**, not its ID. The renderer passes `panel`, `selected`, `active`, `lifecycle` and lifecycle cancellation information to the component.

## Subscribe to the values a component needs

`useWorkspaceSnapshot()` updates a component whenever the runtime publishes a new snapshot.
For a component that only needs part of that snapshot, use
`useWorkspaceSelector(selector, isEqual?)`. The generic adapter exposes the same selection behavior
through `useWorkspaceProjection(selector, isEqual?)`. Both compare the selected value with
`Object.is` by default, so an unrelated workspace change does not trigger that subscription's component render.
Parent renders and the component's own state can still cause it to render.

```tsx
import { useWorkspaceProjection } from "@panefold/react/adapter";

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

The root `WorkspaceSurface` always provides this bridge. For the generic
`WorkspaceSurface` from `@panefold/react/adapter`,
its optional `layoutSolver` lets the renderer use constraints from your canonical model. The model
bridge calls `solveLayout(snapshot, nodeId(request.rootNodeId), request.bounds, options)`, forwarding
splitter size and temporary split overrides. Omitting it from a generic surface uses a
constraint-free compatibility solver.

## Keep selected tabs visible

An overflowing tab strip reveals its selected tab when it first renders, when selection changes,
or when the selected tab's order in the strip or presentation changes. This includes selection restored from
a saved workspace and selection made by application controls outside the strip. Horizontal,
vertical and right-to-left strips scroll only as far as needed. For a tab larger than the available
space, its nearest edge is brought into view when needed.

The reveal scrolls only the tab strip and preserves keyboard focus and surrounding scroll
positions. A strip first rendered without a measurable size reveals its selection when it becomes
visible. After that, ordinary scrolling and resizing leave the user's scroll position alone.
Revealing a tab is a presentation change and does not dispatch a command or create an undo entry.

## Resize expensive content on release

`WorkspaceSurface` accepts `resizePreviewMode="separator"` to move a divider marker while panel contents keep their committed dimensions. Pointer release dispatches one resize command. Escape, lost capture, cancellation, a changed layout, or a rejected command removes the preview. Keyboard resizing still applies each step immediately.

The default `"auto"` mode checks the selected panels in visible groups beneath the resized split. The model integration projects `panel.constraints.resizeDelivery` automatically; custom projectors can set `WorkspacePanelView.resizeDelivery`. A visible `"deferred"` panel selects the divider-only preview. Hidden tabs and unrelated groups do not defer a gesture. `"live"` forces the existing frame-coalesced content preview, and `"separator"` forces the marker regardless of panel preferences. The mode is captured at pointer-down.

`"throttled"` and `"adaptive"` preferences currently use the same frame-coalesced preview as `"live"`; they do not implement a separate callback rate or automatic cost detection. Divider-only preview uses the same constraint solver and commit path as live resizing. It does not change the model's weight or constraint semantics. In the demo, choose **Workspace appearance → Resize preview → Divider only**.

Active splitter resizes and floating-window moves or resizes also cancel when their owning window
loses focus, receives `pagehide`, or its document becomes hidden. The renderer restores the committed
geometry and accessible values, removes any divider preview, and discards queued pointer frames.
The interruption does not dispatch a layout command or create an undo entry; a later pointer release
cannot commit the abandoned gesture. Events in a different document and ordinary element focus
changes do not cancel it. The next pointer gesture starts normally.

## Lock pane sizes

Set `splitResizeDisabled` on `WorkspaceSurface` to disable pointer and
keyboard resizing of every pane divider in that surface, including dividers inside floating windows.
The prop defaults to `false` and can change at runtime:

```tsx
<WorkspaceSurface panels={panels} splitResizeDisabled={lockPaneSizes} />
```

Switching it on during a drag restores the committed sizes, removes any divider preview and cancels
pending movement. Releasing the pointer afterward cannot commit the cancelled resize or add an undo
entry. Switching it off enables resizing again.

Disabled dividers keep their separator labels, pane relationships and size values, expose
`aria-disabled="true"`, and leave the Tab and F6 navigation sequence. A divider that already has focus
keeps it, so disabling does not unexpectedly move focus. Disabled dividers have no enlarged grab area
or resize cursor, and leave touch scrolling available.

This is a view setting for pane dividers. Panel content, tab actions, floating-window movement and edge
resizing, and application-dispatched `resize-split` commands remain available. Keep application
permissions in the runtime's command policy. The setting is not part of the saved layout. Try it in
the demo under **Workspace appearance → Lock pane sizes**.

## Resize with the keyboard

Focus a divider with Tab. Arrow keys resize along its axis; Shift increases the step from 2% to 10% of the adjacent pair. Inline arrows follow `direction`, including RTL. With the built-in solvers, Home gives the primary pane its smallest verified size, and End gives it its largest, while keeping the other panes in the split fixed. Alt, Ctrl and Meta combinations remain available to the browser and application.

The separator's `aria-controls` identifies the primary pane: the pane immediately before the divider in logical layout order. Its current value reports that pane's percentage of the adjacent pair, rounded to two decimal places. `aria-valuemin` and `aria-valuemax` report the verified bounds under the current constraints, including preferred floors when those fit. Home and End use those same bounds. Sizes use integer CSS pixels, and finite canonical weight precision can leave gaps between attainable sizes at extreme ratios. The search has a fixed work limit; extreme ratios or very large layouts may use coarser verified steps instead of exhaustively finding every possible allocation. These shortcuts resize panes; they do not change semantic collapse state.

Both built-in solvers provide the resize metadata needed for these bounds. A custom `layoutSolver` can return `ResolvedSplitter.resize` using `createAxisResizePlan` from `@panefold/geometry` with the exact allocation inputs it used. The plan must match the requested child IDs and weights, the divider's adjacent indices, and the returned pane sizes. If the solver transforms its input weights or output geometry, incompatible metadata is ignored. Solvers without compatible metadata retain weight-based arrow and pointer resizing and solver-probed Home/End endpoints; their accessible bounds are probed when the divider receives focus. Pointer and keyboard resizing commit the exact weights used for the preview.

F6 moves focus to the next visible, enabled divider in the same workspace; Shift+F6 moves backward. Both wrap at the ends. Starting a pointer resize focuses its divider, so Escape cancels the active resize and restores its previous geometry. Keyboard sizing uses the same semantic resize command and result handling as pointer resizing.

Divider shortcuts leave events already handled with `preventDefault()`, events used during text
composition, and Alt/Ctrl/Meta combinations alone. This applies to resizing, F6 navigation and Escape
cancellation. To reserve a shortcut, handle it in a capture handler before it reaches the divider.
An ignored Escape leaves the pointer drag active; an ordinary Escape still cancels it. Shift remains
available for larger resize steps, reverse F6 navigation and Escape cancellation.

### Floating windows

Focus a floating window's titlebar to move it with the arrow keys, or one of its four edge handles
to resize it along that edge. Each step is 8 CSS pixels; Shift increases it to 32. Alt, Ctrl and Meta
combinations remain available to the browser and application. Events already handled by an embedded
editor and keys used during text composition do not dispatch layout commands.

During a pointer move or resize, Escape restores the committed bounds without adding an undo entry,
even when focus remains in an editor. The listener belongs to the active gesture's document and is
removed when the gesture ends. An editor can claim Escape with `preventDefault()` or stop its
propagation; composing and Alt/Ctrl/Meta-modified Escape events are also left alone. Other floating
keyboard commands are ignored while the pointer gesture is active. Cancellation keeps keyboard
focus where it was, discards queued movement, and makes a later pointer release harmless.

## Handle results and cleanup

Use `onCommandResult` to present rejected operations without treating them as successful UI changes. Dispatch receipts can be `committed`, `rejected` or `queued`; a queued receipt is not proof of a completed commit.

Stop subscriptions, dispose the runtime, and release panel-owned resources on teardown. Durable sessions and external-window controllers have additional cleanup order; follow the [persistence](persistence.md) and [window](windows.md) guides rather than disposing them in arbitrary order.
