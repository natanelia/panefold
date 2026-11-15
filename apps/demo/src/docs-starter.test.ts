import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@panefold/kernel";
import { projectModelWorkspace } from "@panefold/react/model";
import { createWorkspace } from "@panefold/runtime";
import { initialSnapshot, starterPanels } from "./docs-starter";

describe("compiled documentation starter", () => {
  it("has a valid canonical workspace and a renderer for every panel type", () => {
    expect(validateWorkspace(initialSnapshot)).toEqual([]);
    const projection = projectModelWorkspace(initialSnapshot);
    expect(Object.keys(projection.groups)).toHaveLength(2);
    expect(projection.rootNodeId).toBe("root");
    expect(initialSnapshot.nodes.byId.root).toMatchObject({
      children: ["primary-node", "inspector-node"],
      weights: [650_000, 350_000],
    });
    expect(initialSnapshot.groups.byId.primary?.selectedPanelId).toBe("notes");
    expect(initialSnapshot.panels.byId.notes?.constraints.hardMinInline).toBe(140);
    for (const panel of Object.values(projection.panels))
      expect(starterPanels[panel.type]).toBeDefined();
  });
  it("uses application actions with reversible layout changes and recoverable closes", () => {
    const workspace = createWorkspace({ initialSnapshot });
    try {
      const receipt = workspace.actions.selectPanel("map-canvas");
      expect(receipt.status).toBe("committed");
      expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
      expect(workspace.getSnapshot().groups.byId.primary?.selectedPanelId).toBe("map-canvas");
      expect(workspace.canUndo()).toBe(true);
      expect(workspace.actions.undo().status).toBe("committed");
      expect(workspace.getSnapshot().groups.byId.primary?.selectedPanelId).toBe("notes");
      expect(workspace.actions.redo().status).toBe("committed");
      expect(workspace.getSnapshot().groups.byId.primary?.selectedPanelId).toBe("map-canvas");
      expect(workspace.actions.closePanel("map-canvas").status).toBe("committed");
      expect(workspace.getSnapshot().panels.byId["map-canvas"]).toBeUndefined();
      expect(workspace.actions.reopenLastPanel().status).toBe("committed");
      expect(workspace.getSnapshot().groups.byId.primary?.selectedPanelId).toBe("map-canvas");
      expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    } finally {
      workspace.dispose();
    }
  });
});
