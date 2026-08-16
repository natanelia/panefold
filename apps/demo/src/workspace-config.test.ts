import { describe, expect, it } from "vitest";
import { solveLayout } from "@panefold/geometry";
import { canonicalizeWorkspace, reduceWorkspace, validateWorkspace } from "@panefold/kernel";
import {
  getEntity,
  groupId,
  nodeId,
  panelId,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";

import { createDemoCommands, initialWorkspaceSnapshot, projectWorkspace } from "./workspace-config";

describe("Panefold Code command planning", () => {
  it("plans and previews moving a whole multi-tab container as one command", () => {
    const initial = initialWorkspaceSnapshot;
    const commands = createDemoCommands(() => initial);
    const projection = projectWorkspace(initial);
    const sourceGroup = projection.groups.primary;
    const targetGroup = projection.groups.inspector;
    if (sourceGroup === undefined || targetGroup === undefined) {
      throw new Error("Expected source and target groups");
    }
    const sourcePanels = sourceGroup.panelIds.flatMap((id) => {
      const panel = projection.panels[id];
      return panel === undefined ? [] : [panel];
    });
    const targetPanels = targetGroup.panelIds.flatMap((id) => {
      const panel = projection.panels[id];
      return panel === undefined ? [] : [panel];
    });
    const bounds = { inlineStart: 0, blockStart: 0, inlineSize: 1200, blockSize: 800 };
    const layout = solveLayout(initial, nodeId("root"), bounds, { splitterSize: 6 });
    const targetRect = layout.groupRects.inspector;
    if (targetRect === undefined) throw new Error("Expected target geometry");

    const plan = commands.planGroupDrop?.(
      {
        revision: projection.revision,
        sourceGroup,
        sourcePanels,
        sourceNodeId: "primary-node",
        targetGroup,
        targetPanels,
        targetNodeId: "inspector-node",
        target: { kind: "edge", edge: "inline-start", ratio: 0.5 },
      },
      { bounds, targetRect, splitterSize: 6 },
    );

    expect(plan?.command).toMatchObject({
      type: "move-group",
      groupId: groupId("primary"),
      targetGroupId: groupId("inspector"),
      edge: "inline-start",
    });
    const next = execute(initial, requiredCommand(plan?.command));
    expect(getEntity(next.groups, groupId("primary"))?.panelIds).toEqual([
      panelId("map-canvas"),
      panelId("notes"),
    ]);
    const nextLayout = solveLayout(next, nodeId("root"), bounds, { splitterSize: 6 });
    expect(plan?.previewRect).toEqual(nextLayout.groupRects.primary);
    expect(validateWorkspace(next)).toEqual([]);

    const swap = commands.planGroupDrop?.(
      {
        revision: projection.revision,
        sourceGroup,
        sourcePanels,
        sourceNodeId: "primary-node",
        targetGroup,
        targetPanels,
        targetNodeId: "inspector-node",
        target: { kind: "swap" },
      },
      { bounds, targetRect, splitterSize: 6 },
    );
    expect(swap?.command).toEqual({
      type: "swap-groups",
      firstGroupId: groupId("primary"),
      secondGroupId: groupId("inspector"),
    });
    const swapped = execute(initial, requiredCommand(swap?.command));
    const swappedLayout = solveLayout(swapped, nodeId("root"), bounds, { splitterSize: 6 });
    expect(swap?.previewRect).toEqual(swappedLayout.groupRects.primary);
    expect(getEntity(swapped.groups, groupId("primary"))?.panelIds).toEqual([
      panelId("map-canvas"),
      panelId("notes"),
    ]);
  });

  it("connects one atomic float command to the same-document surface projection and redock path", () => {
    let current = initialWorkspaceSnapshot;
    const commands = createDemoCommands(() => current);
    const float = commands.floatPanel?.("notes");
    expect(float).toMatchObject({ type: "batch" });

    current = execute(current, requiredCommand(float));
    expect(validateWorkspace(current)).toEqual([]);
    expect(getEntity(current.groups, groupId("primary"))?.panelIds).toEqual([
      panelId("map-canvas"),
    ]);
    const floatingSurfaceId = current.floatingOrder[0];
    expect(floatingSurfaceId).toBeDefined();

    const projection = projectWorkspace(current);
    expect(projection.floatingSurfaces).toHaveLength(1);
    expect(projection.floatingSurfaces?.[0]).toMatchObject({
      id: String(floatingSurfaceId),
      bounds: { width: 480, height: 340 },
      maximized: false,
    });
    const floatingRoot = projection.floatingSurfaces?.[0]?.rootNodeId;
    const floatingNode = floatingRoot === undefined ? undefined : projection.nodes[floatingRoot];
    expect(floatingNode?.kind).toBe("group");
    if (floatingNode?.kind === "group") {
      expect(projection.groups[floatingNode.groupId]?.panelIds).toEqual(["notes"]);
    }

    const move = commands.moveFloatingSurface?.(String(floatingSurfaceId), { x: 90, y: 75 });
    expect(move).toMatchObject({
      type: "batch",
      commands: [
        { type: "move-floating-surface" },
        { type: "raise-surface" },
        { type: "activate-panel", panelId: panelId("notes"), focus: "keep-focus" },
      ],
    });
    current = execute(current, requiredCommand(move));
    expect(current.activation).toMatchObject({
      activePanelId: panelId("notes"),
      activeSurfaceId: floatingSurfaceId,
    });

    const redock = commands.redockFloatingSurface?.(String(floatingSurfaceId));
    current = execute(current, requiredCommand(redock));
    expect(current.floatingOrder).toEqual([]);
    expect(getEntity(current.groups, groupId("primary"))?.panelIds).toContain(panelId("notes"));
    expect(validateWorkspace(current)).toEqual([]);
  });
});

function execute(snapshot: WorkspaceSnapshot, command: WorkspaceCommand): WorkspaceSnapshot {
  const reduced = reduceWorkspace(snapshot, command);
  if (!reduced.ok) throw new Error(reduced.error.message);
  return canonicalizeWorkspace(reduced.snapshot).snapshot;
}

function requiredCommand(command: WorkspaceCommand | undefined): WorkspaceCommand {
  if (command === undefined) throw new Error("Expected the floating command adapter");
  return command;
}
