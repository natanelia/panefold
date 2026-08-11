import { describe, expect, it } from "vitest";
import {
  closedPanelId,
  commandId,
  createKernelState,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type CommandEnvelope,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  canonicalHash,
  canonicalSerialize,
  canonicalizeWorkspace,
  dispatchKernelState,
  executeCommand,
  semanticHash,
  validateWorkspace,
} from "../src/index";
import { fixtureSnapshot, ids, panel } from "./fixtures";

let sequence = 0;
function envelope(
  command: WorkspaceCommand,
  snapshot?: WorkspaceSnapshot,
  label = command.type,
): CommandEnvelope {
  sequence += 1;
  return {
    id: commandId(`command:${sequence}`),
    origin: "application",
    label,
    ...(snapshot === undefined ? {} : { baseRevision: snapshot.revision }),
    command,
  };
}

function execute(snapshot: WorkspaceSnapshot, command: WorkspaceCommand) {
  const result = executeCommand(snapshot, envelope(command, snapshot));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("reference kernel", () => {
  it("accepts a valid normalized fixture", () => {
    const snapshot = fixtureSnapshot();
    expect(validateWorkspace(snapshot)).toEqual([]);
    expect(canonicalHash(snapshot)).toBe(canonicalHash(fixtureSnapshot()));
    expect(canonicalSerialize(snapshot)).toContain('"schemaVersion":1');
  });

  it("commits atomically with typed patches, revision, and inverse", () => {
    const snapshot = fixtureSnapshot();
    const result = execute(snapshot, {
      type: "select-panel",
      panelId: ids.panels[1],
    });
    expect(result.next.revision).toBe(snapshot.revision + 1n);
    expect(getEntity(result.next.groups, ids.groups[0])?.selectedPanelId).toBe(ids.panels[1]);
    expect(result.patches.some((patch) => patch.kind === "group")).toBe(true);
    expect(result.inverse?.type).toBe("restore-workspace");
    expect(validateWorkspace(result.next)).toEqual([]);
  });

  it("rejects stale commands without mutation or revision advancement", () => {
    const snapshot = fixtureSnapshot();
    const stale = envelope({ type: "select-panel", panelId: ids.panels[1] }, snapshot);
    const advanced = execute(snapshot, {
      type: "activate-panel",
      panelId: ids.panels[2],
      focus: "keep-focus",
    }).next;
    const result = executeCommand(advanced, stale);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT" },
    });
    expect(advanced.revision).toBe(snapshot.revision + 1n);
  });

  it("opens, closes, and reopens a recoverable panel", () => {
    const initial = fixtureSnapshot();
    const fourthId = panelId("panel:four");
    const opened = execute(initial, {
      type: "open-panel",
      panel: panel(fourthId),
      placement: { groupId: ids.groups[0], afterPanelId: ids.panels[0] },
    }).next;
    expect(getEntity(opened.groups, ids.groups[0])?.panelIds).toEqual([
      ids.panels[0],
      fourthId,
      ids.panels[1],
    ]);

    const closedId = closedPanelId("closed:four");
    const closed = execute(opened, {
      type: "close-panels",
      targets: [{ panelId: fourthId, closedPanelId: closedId }],
    }).next;
    expect(getEntity(closed.panels, fourthId)).toBeUndefined();
    expect(closed.recoverableClosedPanels[0]?.panel.id).toBe(fourthId);

    const reopened = execute(closed, {
      type: "reopen-panel",
      closedPanelId: closedId,
    }).next;
    expect(getEntity(reopened.panels, fourthId)).toBeDefined();
    expect(reopened.recoverableClosedPanels).toEqual([]);
    expect(validateWorkspace(reopened)).toEqual([]);
  });

  it("moves and relationally reorders tabs", () => {
    const initial = fixtureSnapshot();
    const reordered = execute(initial, {
      type: "reorder-panels",
      groupId: ids.groups[0],
      panelIds: [ids.panels[1]],
      beforePanelId: ids.panels[0],
    }).next;
    expect(getEntity(reordered.groups, ids.groups[0])?.panelIds).toEqual([
      ids.panels[1],
      ids.panels[0],
    ]);

    const moved = execute(reordered, {
      type: "move-panel",
      panelId: ids.panels[1],
      target: { groupId: ids.groups[1], beforePanelId: ids.panels[2] },
    }).next;
    expect(getEntity(moved.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[0]]);
    expect(getEntity(moved.groups, ids.groups[1])?.panelIds).toEqual([
      ids.panels[1],
      ids.panels[2],
    ]);
    expect(validateWorkspace(moved)).toEqual([]);
  });

  it("splits, normalizes, resizes, equalizes, and merges groups", () => {
    const initial = fixtureSnapshot();
    const newGroupId = groupId("group:new");
    const newNodeId = nodeId("node:new");
    const newSplitId = nodeId("node:new-split");
    const split = execute(initial, {
      type: "split-group",
      targetGroupId: ids.groups[0],
      panelIds: [ids.panels[1]],
      newGroupId,
      newGroupNodeId: newNodeId,
      splitNodeId: newSplitId,
      edge: "block-end",
      ratio: 0.4,
    }).next;
    expect(getEntity(split.groups, newGroupId)?.panelIds).toEqual([ids.panels[1]]);
    expect(validateWorkspace(split)).toEqual([]);

    const resized = execute(split, {
      type: "resize-split",
      splitNodeId: newSplitId,
      weights: [1, 3],
    }).next;
    expect(getEntity(resized.nodes, newSplitId)).toMatchObject({
      weights: [250_000, 750_000],
    });
    const equalized = execute(resized, {
      type: "equalize-split",
      splitNodeId: newSplitId,
    }).next;
    expect(getEntity(equalized.nodes, newSplitId)).toMatchObject({
      weights: [500_000, 500_000],
    });

    const merged = execute(equalized, {
      type: "merge-groups",
      sourceGroupId: newGroupId,
      target: { groupId: ids.groups[0] },
    }).next;
    expect(getEntity(merged.groups, newGroupId)).toBeUndefined();
    expect(validateWorkspace(merged)).toEqual([]);
  });

  it("floats, moves, resizes, maximizes, restores, and redocks a group", () => {
    const initial = fixtureSnapshot();
    const floatingId = surfaceId("surface:floating");
    const floated = execute(initial, {
      type: "create-floating-surface",
      groupId: ids.groups[1],
      surfaceId: floatingId,
      bounds: { x: 40, y: 50, width: 500, height: 360 },
    }).next;
    expect(floated.floatingOrder).toEqual([floatingId]);
    expect(getEntity(floated.surfaces, floatingId)?.kind).toBe("floating");
    expect(validateWorkspace(floated)).toEqual([]);

    const moved = execute(floated, {
      type: "move-floating-surface",
      surfaceId: floatingId,
      x: 80,
      y: 90,
    }).next;
    const resized = execute(moved, {
      type: "resize-floating-surface",
      surfaceId: floatingId,
      bounds: { x: 80, y: 90, width: 640, height: 480 },
    }).next;
    const maximized = execute(resized, {
      type: "maximize-surface",
      surfaceId: floatingId,
    }).next;
    expect(getEntity(maximized.surfaces, floatingId)?.maximized).toBe(true);
    const restored = execute(maximized, {
      type: "restore-surface",
      surfaceId: floatingId,
    }).next;
    expect(getEntity(restored.surfaces, floatingId)?.bounds).toEqual({
      x: 80,
      y: 90,
      width: 640,
      height: 480,
    });
    const redocked = execute(restored, {
      type: "redock-surface",
      surfaceId: floatingId,
      target: { groupId: ids.groups[0] },
    }).next;
    expect(getEntity(redocked.surfaces, floatingId)).toBeUndefined();
    expect(getEntity(redocked.groups, ids.groups[0])?.panelIds).toContain(ids.panels[2]);
    expect(validateWorkspace(redocked)).toEqual([]);
  });

  it("provides atomic bounded workspace undo and redo", () => {
    const initial = fixtureSnapshot();
    const initialHash = semanticHash(initial);
    let state = createKernelState(initial, 3);
    const select = dispatchKernelState(
      state,
      envelope({ type: "select-panel", panelId: ids.panels[1] }, state.snapshot),
    );
    expect(select.ok).toBe(true);
    if (!select.ok) return;
    state = select.state;
    expect(state.undoStack).toHaveLength(1);

    const undo = dispatchKernelState(
      state,
      envelope({ type: "undo-workspace-operation" }, state.snapshot),
    );
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    state = undo.state;
    expect(semanticHash(state.snapshot)).toBe(initialHash);
    expect(state.redoStack).toHaveLength(1);

    const redo = dispatchKernelState(
      state,
      envelope({ type: "redo-workspace-operation" }, state.snapshot),
    );
    expect(redo.ok).toBe(true);
    if (!redo.ok) return;
    expect(getEntity(redo.state.snapshot.groups, ids.groups[0])?.selectedPanelId).toBe(
      ids.panels[1],
    );
    expect(redo.state.undoStack).toHaveLength(1);
  });

  it("activates the same-group successor when closing and restores the panel in one undo", () => {
    const initial = fixtureSnapshot();
    let state = createKernelState(initial, 3);
    const close = dispatchKernelState(
      state,
      envelope(
        {
          type: "close-panels",
          targets: [
            {
              panelId: ids.panels[0],
              closedPanelId: closedPanelId("closed:active"),
            },
          ],
        },
        state.snapshot,
      ),
    );
    expect(close.ok).toBe(true);
    if (!close.ok) return;
    state = close.state;
    expect(state.snapshot.activation.activePanelId).toBe(ids.panels[1]);

    const undo = dispatchKernelState(
      state,
      envelope({ type: "undo-workspace-operation" }, state.snapshot),
    );
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(getEntity(undo.state.snapshot.panels, ids.panels[0])).toBeDefined();
    expect(undo.state.snapshot.activation.activePanelId).toBe(ids.panels[0]);
  });

  it("flattens adjacent same-axis splits deterministically and idempotently", () => {
    const initial = fixtureSnapshot();
    const splitOnce = execute(initial, {
      type: "split-group",
      targetGroupId: ids.groups[0],
      panelIds: [ids.panels[1]],
      newGroupId: groupId("group:flattened"),
      newGroupNodeId: nodeId("node:flattened"),
      splitNodeId: nodeId("node:temporary-split"),
      edge: "inline-end",
      ratio: 0.25,
    }).next;
    expect(getEntity(splitOnce.nodes, nodeId("node:temporary-split"))).toBeUndefined();
    const root = getEntity(splitOnce.nodes, ids.nodes[2]);
    expect(root).toMatchObject({ kind: "split" });
    if (root?.kind !== "split") return;
    expect(root.children).toHaveLength(3);
    expect(root.weights.reduce((sum, weight) => sum + weight, 0)).toBe(1_000_000);
    const again = canonicalizeWorkspace(splitOnce).snapshot;
    expect(canonicalHash(again)).toBe(canonicalHash(splitOnce));
  });
});
