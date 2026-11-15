# Layouts and commands

**Arrange with data. Change with intent.** A workspace should have one answer to what happened, whether the action came from a mouse, keyboard, menu or application button.

## Describe the initial layout

Use `createWorkspaceLayout` for a new arrangement. Define each panel once, then refer to its ID in
a tab group. Nest groups inside splits:

```ts
import { createWorkspaceLayout } from "@panefold/model";

const initialSnapshot = createWorkspaceLayout({
  panels: [
    { id: "notes", type: "note", title: "Notes" },
    { id: "preview", type: "preview", title: "Preview" },
    { id: "inspector", type: "inspector", title: "Inspector" },
  ],
  layout: {
    id: "main-split",
    axis: "inline",
    weights: [2, 1],
    children: [
      { id: "primary", panels: ["notes", "preview"] },
      { id: "details", panels: ["inspector"] },
    ],
  },
});
```

The builder fills panel defaults, creates group nodes and a main surface, and selects each group's
first panel unless `selectedPanelId` is supplied. Groups can have a `region`, `persistent` setting
and explicit `nodeId`; splits accept an explicit node `id`. Omitted identities are deterministic
for the same tree. Use explicit IDs for groups and splits your application addresses later.
Authored groups persist when emptied by default. The active panel defaults to the first selected
panel in layout order; `activePanelId` can choose another. Selecting a nondefault active panel also
selects it in its group unless that conflicts with an explicit `selectedPanelId`.

`inline` splits follow the writing direction; `block` splits follow its perpendicular axis. Input
weights are positive relative proportions, so `[2, 1]` and `[200, 100]` describe the same preference.
Omitting weights distributes the preference equally. The builder converts them to positive integer
weights totaling `1_000_000`. Constraints determine the final pixel sizes; use the geometry solver
for rectangles rather than calculating percentages independently.

Every declared panel must appear in exactly one group. The builder rejects invalid membership,
duplicate identities, invalid selections, cycles and invalid weights with an input error. It
returns the existing immutable `WorkspaceSnapshot`, so saving, commands and history use the same
schema. Runtime creation still validates the full snapshot. For restored layouts, multiple
surfaces or direct normalized records, continue using `createWorkspaceSnapshot` and the persistence
APIs. The builder is a trusted setup helper, not an untrusted import decoder.
It preserves authored split topology initially; ordinary kernel canonicalization can flatten
adjacent same-axis splits after a command. Use the current snapshot to discover live split IDs.

See the complete two-group layout in the [starter](../../apps/demo/src/docs-starter.tsx), and the larger reference in [workspace-config.ts](../../apps/demo/src/workspace-config.ts).

## Dispatch an application action

`createWorkspace(options)` from `@panefold/runtime` accepts the same layout definition and exposes
the helpers as `workspace.actions`. In React, `useWorkspaceActions()` reads them beneath `Workspace`
or `WorkspaceProvider`. To add helpers to an existing runtime, use `createWorkspaceActions`:

```ts
import { createWorkspaceActions } from "@panefold/runtime";

const actions = createWorkspaceActions(runtime);
const receipt = actions.selectPanel("notes", { label: "Show notes" });

if (receipt.status === "rejected") {
  console.error(receipt.result.error.code, receipt.result.error.remediation);
}
```

A rejection must not advance the workspace revision or leave half a layout applied. A receipt can
also be `queued` when an observer dispatches during another commit. Observe transactions to confirm
that queued commands later commit; do not treat them as completed actions.

| Job                                      | Example                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Open and select a panel                  | `actions.openPanel({ id: "draft", type: "note" }, "primary")`                       |
| Select and activate a tab                | `actions.selectPanel("notes")`                                                      |
| Activate with an explicit focus policy   | `actions.activatePanel("notes", { focus: "focus-panel-root" })`                     |
| Move to a group or relative tab position | `actions.movePanel("notes", { groupId: "details", beforePanelId: "inspector" })`    |
| Split a tab from its current group       | `actions.splitPanel("notes", "block-end", { ratio: 0.3 })`                          |
| Float a panel in the same document       | `actions.floatPanel("notes", { x: 24, y: 24, width: 480, height: 320 })`            |
| Redock a floating surface                | `actions.redockSurface(floatingSurfaceId, "primary")`                               |
| Close one or several panels              | `actions.closePanel("notes")` / `actions.closePanels(["notes", "preview"])`         |
| Close other tabs or following tabs       | `actions.closeOtherPanels("notes")` / `actions.closePanelsToRight("notes")`         |
| Reopen the latest recoverable close      | `actions.reopenLastPanel()`                                                         |
| Resize or equalize a split               | `actions.resizeSplit("main-split", [3, 2])` / `actions.equalizeSplit("main-split")` |
| Undo or redo a workspace change          | `actions.undo()` / `actions.redo()`                                                 |

Each example is independent and assumes the named entities are live. String IDs are accepted
directly. New internal group, node, surface and recoverable-close IDs are allocated by the helpers.
Use `splitPanel`'s `newGroupId` option when later application actions need to name the new group.
`reopenPanel(closedId)` targets a particular recoverable record.

Helpers dispatch the existing commands or one atomic batch. They preserve capability checks,
runtime policies and normal typed failures; malformed setup values can still throw an input error.
State-dependent actions capture the revision used to decide their targets and reject stale queued
work rather than applying that decision to a changed layout. A split needs another tab in its
source group, and floating remains subject to the existing main-surface and capability rules.
Browser-window ownership still requires the prepared transfer integration.

Most helpers accept `DispatchOptions` such as `origin`, `label` and `baseRevision`. Open, move and
reopen also accept `select` and `activate`; selection accepts `activate`. Direct
`runtime.dispatch(command, options)` remains available for the complete command catalog, custom
atomic batches and advanced integrations.

## Compose actions into one transaction

Use `workspace.plan` when a feature needs to prepare a panel or layout operation without dispatching
it. Planning counterparts use the same names as those action helpers. Combine them with
`actions.batch`; dispatch undo and redo separately as history operations:

```ts
const operations = [
  workspace.plan.openPanel({ id: "console", type: "console", title: "Console" }, "primary"),
  workspace.plan.splitPanel("console", "block-end", { newGroupId: "tools", ratio: 0.25 }),
];

const receipt = workspace.actions.batch(operations, { label: "Open console below the editor" });
```

This example opens Console and then splits that newly opened panel into its own group. It uses the
`primary` group in the initial layout above; register a `console` renderer before displaying the
new panel. Preparing plans does not dispatch, change history, notify
subscribers or run runtime policies. Each plan owns its immutable inputs and records the workspace
and revision it was prepared against. The batch dispatches once, producing one committed revision
and one undo step. A rejected operation leaves the entire workspace unchanged.

Plans can be returned by separate application functions and combined at the call site. In React,
`useWorkspacePlans()` and `useWorkspaceActions()` expose planning and dispatch separately. For an
existing runtime, use `createWorkspacePlans(runtime)` alongside `createWorkspaceActions(runtime)`.

Create related plans against the same current snapshot. Stale or mixed-revision plans reject;
passing a different `baseRevision` cannot remove their revision guard. A plan belongs to the
runtime that created it. Selection, placement, ratios and other semantic options belong on each
plan; the outer `batch` owns dispatch metadata such as `label` and `origin`.
A `baseRevision` ahead of the live revision is a configuration error. The kernel limit is 1,000
semantic commands per batch; a compound helper can contribute more than one command.

At batch time, operations are prepared in order against the staged result of earlier operations.
This lets a later operation address a panel or group created by an earlier one. Staging uses the
pure kernel reducer without publishing snapshots, running runtime policies, delivering effects or
advancing the live revision. The completed batch still enters the normal runtime dispatch path.

`plan.command` is an immutable standalone preview against the original snapshot. The final batch
may derive a different command after applying preceding operations; use `actions.batch` to execute
the composition. Runtime policies evaluate the final batch once and can still reject or transform
it. The actual committed transaction is the record of what happened.

## Connect gestures through factories

`WorkspaceCommandAdapter` requires selection, activation, close and split-resize factories. Optional factories enable reorder, moving, floating and other operations. Direct docking additionally uses `planPanelDrop`, `planPanelTabDrop` and `planGroupDrop`.

The planner owns topology, IDs, constraints and the revision-bound command. The renderer owns the temporary preview. Use the official model bridge initially, then adapt product-specific decisions explicitly. Adding a drag handle without the matching factory is not enough.

## Tune drag behavior

`dropBehavior` is a renderer preference, not an authorization boundary. `splitOnDragAndDrop` controls edge splitting, `preferredSplitDirection` resolves corner preferences, and `centerGroupDrop` chooses `"swap"` or `"merge"` for whole-container center drops. The default center operation is swap; set merge deliberately for a VS Code-like treatment.

A panel reorder is relational: place it before or after another panel, rather than trusting a stale numeric index. A container move carries all its tabs. A split creates layout structure, not another copy of the panel's business data.

## Undo layout—not everything

Use `runtime.undo()`, `runtime.redo()`, `runtime.canUndo()` and `runtime.canRedo()` for workspace history. Subscribe to updates so toolbar enabled states stay current. History limits are configured when creating the runtime.

Batch related semantic changes when they should be one atomic, undoable action. External platform transitions may require a history barrier rather than a promise that browser windows can be recreated by redo.

The [command catalog](../COMMANDS.md) documents all 36 commands and their current boundaries. Treat it as the detailed reference, not the starting point for your first component.
