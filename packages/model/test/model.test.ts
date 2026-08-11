import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  commandId,
  createEntityTable,
  createKernelState,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  revision,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type SurfaceRecord,
} from "../src/index";

describe("branded identifiers", () => {
  it("constructs explicit stable identifiers and rejects empty values", () => {
    expect(panelId("panel:map")).toBe("panel:map");
    expect(groupId("group:main")).toBe("group:main");
    expect(nodeId("node:main")).toBe("node:main");
    expect(surfaceId("surface:main")).toBe("surface:main");
    expect(commandId("command:1")).toBe("command:1");
    expect(() => panelId("   ")).toThrow(/must not be empty/);
    expect(() => revision(-1)).toThrow(/non-negative/);
  });
});

describe("normalized model factories", () => {
  it("sorts entity tables without making order an ownership relation", () => {
    const first: PanelRecord = {
      id: panelId("panel:b"),
      type: "test",
      typeVersion: 1,
      parameters: {},
      capabilities: DEFAULT_PANEL_CAPABILITIES,
      constraints: {},
      lifecycle: DEFAULT_PANEL_LIFECYCLE,
    };
    const second: PanelRecord = { ...first, id: panelId("panel:a") };
    const table = createEntityTable([first, second]);
    expect(table.ids).toEqual([second.id, first.id]);
    expect(getEntity(table, first.id)).toBe(first);
    expect(() => createEntityTable([first, first])).toThrow(/Duplicate/);
  });

  it("creates an immutable normalized snapshot and bounded history state", () => {
    const panel: PanelRecord = {
      id: panelId("panel:one"),
      type: "test",
      typeVersion: 1,
      parameters: null,
      capabilities: DEFAULT_PANEL_CAPABILITIES,
      constraints: {},
      lifecycle: DEFAULT_PANEL_LIFECYCLE,
    };
    const group: GroupRecord = {
      id: groupId("group:one"),
      panelIds: [panel.id],
      selectedPanelId: panel.id,
      persistent: false,
    };
    const node: LayoutNode = {
      kind: "group",
      id: nodeId("node:one"),
      groupId: group.id,
    };
    const surface: SurfaceRecord = {
      id: surfaceId("surface:one"),
      kind: "main",
      rootNodeId: node.id,
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    };
    const snapshot = createWorkspaceSnapshot({
      panels: [panel],
      groups: [group],
      nodes: [node],
      surfaces: [surface],
      activation: { activePanelId: panel.id, activeSurfaceId: surface.id },
    });
    const state = createKernelState(snapshot, 10);
    expect(getEntity(snapshot.panels, panel.id)).toBe(panel);
    expect(state.historyLimit).toBe(10);
    expect(state.undoStack).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => createKernelState(snapshot, -1)).toThrow(/historyLimit/);
  });
});
