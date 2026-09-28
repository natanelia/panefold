import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@panefold/kernel";
import { panelId } from "@panefold/model";
import { createWorkspaceRuntime } from "@panefold/runtime";
import { initialSnapshot, starterPanels } from "./docs-starter";
import { createDemoCommands, projectWorkspace } from "./workspace-config";

describe("compiled documentation starter", () => {
  it("has a valid canonical workspace and a renderer for every panel type", () => {
    expect(validateWorkspace(initialSnapshot)).toEqual([]);
    const projection = projectWorkspace(initialSnapshot);
    expect(Object.keys(projection.groups)).toHaveLength(2);
    for (const panel of Object.values(projection.panels))
      expect(starterPanels[panel.type]).toBeDefined();
  });
  it("uses the actual runtime and command adapter, with reversible layout changes", () => {
    const runtime = createWorkspaceRuntime({ initialSnapshot });
    try {
      const commands = createDemoCommands(runtime.getSnapshot);
      expect(commands).toBeDefined();
      const receipt = runtime.dispatch({ type: "select-panel", panelId: panelId("map-canvas") });
      expect(receipt.status).toBe("committed");
      expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
      expect(runtime.canUndo()).toBe(true);
      expect(runtime.undo().status).toBe("committed");
      expect(runtime.redo().status).toBe("committed");
    } finally {
      runtime.dispose();
    }
  });
});
