import { describe, expect, it } from "vitest";
import { canonicalizeWorkspace, reduceWorkspace, validateWorkspace } from "@panefold/kernel";
import {
  getEntity,
  groupId,
  panelId,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";

import { createDemoCommands, initialWorkspaceSnapshot, projectWorkspace } from "./workspace-config";

describe("Panefold Code floating-window projection", () => {
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
