# Layouts and commands

**Arrange with data. Change with intent.** A workspace should have one answer to what happened, whether the action came from a mouse, keyboard, menu or application button.

## Describe the initial layout

Create panel records, put their IDs into group records, reference each group from a group node, and connect those nodes with split nodes. The main surface points at the root node. `createWorkspaceSnapshot` normalizes the tables; `validateWorkspace` checks the relationships.

Split weights are integer proportions, not CSS pixels. The reference layouts use a total of `1_000_000`: `[700_000, 300_000]` represents a 70/30 preference before constraints. Use the geometry solver for actual rectangles, not independent percentage calculations in your components.

See the complete two-group layout in the [starter](../../apps/demo/src/docs-starter.tsx), and the larger reference in [workspace-config.ts](../../apps/demo/src/workspace-config.ts).

## Dispatch an application action

This excerpt assumes an existing runtime and a `notes` panel, as in the starter.

```ts
import { panelId } from "@panefold/model";

const receipt = runtime.dispatch(
  { type: "select-panel", panelId: panelId("notes"), activate: true },
  { origin: "application", label: "Open notes" },
);

if (receipt.status === "rejected") {
  console.error(receipt.result.error.code, receipt.result.error.remediation);
}
```

A rejection must not advance the workspace revision or leave half a layout applied. Show an actionable failure rather than pretending the drag worked. Observe transactions to confirm queued commands later commit.

## Connect gestures through factories

`WorkspaceCommandAdapter` requires selection, activation, close and split-resize factories. Optional factories enable reorder, moving, floating and other operations. Direct docking additionally uses `planPanelDrop`, `planPanelTabDrop` and `planGroupDrop`.

The planner owns topology, IDs, constraints and the revision-bound command. The renderer owns the temporary preview. Reuse the reference planner bridge initially, then adapt product-specific decisions explicitly. Adding a drag handle without the matching factory is not enough.

## Tune drag behavior

`dropBehavior` is a renderer preference, not an authorization boundary. `splitOnDragAndDrop` controls edge splitting, `preferredSplitDirection` resolves corner preferences, and `centerGroupDrop` chooses `"swap"` or `"merge"` for whole-container center drops. The default center operation is swap; set merge deliberately for a VS Code-like treatment.

A panel reorder is relational: place it before or after another panel, rather than trusting a stale numeric index. A container move carries all its tabs. A split creates layout structure, not another copy of the panel's business data.

## Undo layout—not everything

Use `runtime.undo()`, `runtime.redo()`, `runtime.canUndo()` and `runtime.canRedo()` for workspace history. Subscribe to updates so toolbar enabled states stay current. History limits are configured when creating the runtime.

Batch related semantic changes when they should be one atomic, undoable action. External platform transitions may require a history barrier rather than a promise that browser windows can be recreated by redo.

The [command catalog](../COMMANDS.md) documents all 36 commands and their current boundaries. Treat it as the detailed reference, not the starting point for your first component.
