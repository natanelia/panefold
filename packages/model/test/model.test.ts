import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  WORKSPACE_COMMAND_TYPES,
  closedPanelId,
  commandId,
  createEntityTable,
  createKernelState,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  revision,
  isJsonValue,
  isWorkspaceCommandType,
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

describe("command inventory", () => {
  it("exports a unique runtime inventory aligned with the command discriminant", () => {
    expect(WORKSPACE_COMMAND_TYPES).toHaveLength(36);
    expect(new Set(WORKSPACE_COMMAND_TYPES).size).toBe(WORKSPACE_COMMAND_TYPES.length);
    expect(isWorkspaceCommandType("recover-orphaned-surface")).toBe(true);
    expect(isWorkspaceCommandType("unknown-command")).toBe(false);
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
    expect(getEntity(table, first.id)).toEqual(first);
    expect(getEntity(table, first.id)).not.toBe(first);
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
    expect(getEntity(snapshot.panels, panel.id)).toEqual(panel);
    expect(getEntity(snapshot.panels, panel.id)).not.toBe(panel);
    expect(state.historyLimit).toBe(10);
    expect(state.undoStack).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(state.snapshot).not.toBe(snapshot);
    expect(Object.getPrototypeOf(state.snapshot.panels.byId)).toBeNull();
    expect(() => createKernelState(snapshot, -1)).toThrow(/historyLimit/);
  });

  it("severs and freezes every caller-owned nested reference", () => {
    const parameters = { nested: { values: [1, 2] } };
    const constraints = { hardMinInline: 100 };
    const mutablePanel = {
      id: panelId("panel:mutable"),
      type: "mutable",
      typeVersion: 1,
      parameters,
      capabilities: { ...DEFAULT_PANEL_CAPABILITIES },
      constraints,
      lifecycle: { ...DEFAULT_PANEL_LIFECYCLE },
    };
    const panelIds = [mutablePanel.id];
    const mutableGroup = {
      id: groupId("group:mutable"),
      panelIds,
      selectedPanelId: mutablePanel.id,
      persistent: false,
    };
    const children = [nodeId("node:mutable"), nodeId("node:other")];
    const weights = [500_000, 500_000];
    const groupNode = {
      kind: "group" as const,
      id: children[0] as (typeof children)[number],
      groupId: mutableGroup.id,
    };
    const otherPanel = { ...mutablePanel, id: panelId("panel:other") };
    const otherGroup = {
      ...mutableGroup,
      id: groupId("group:other"),
      panelIds: [otherPanel.id],
      selectedPanelId: otherPanel.id,
    };
    const otherNode = {
      kind: "group" as const,
      id: children[1] as (typeof children)[number],
      groupId: otherGroup.id,
    };
    const split = {
      kind: "split" as const,
      id: nodeId("node:root"),
      axis: "inline" as const,
      children,
      weights,
      collapsedChildIds: [] as ReturnType<typeof nodeId>[],
    };
    const bounds = { x: 1, y: 2, width: 300, height: 200 };
    const mutableSurface = {
      id: surfaceId("surface:mutable"),
      kind: "floating" as const,
      rootNodeId: split.id,
      capabilities: { ...MAIN_SURFACE_CAPABILITIES, freePositioning: true },
      bounds,
      maximized: false,
    };
    const metadata = { nested: { enabled: true } };
    const closedPanel = { ...mutablePanel, id: panelId("panel:closed") };
    const closedRecord = {
      id: closedPanelId("closed:mutable"),
      panel: closedPanel,
      formerPlacement: { groupId: mutableGroup.id },
      closedAtRevision: revision(0),
    };
    const remoteReceipt = {
      id: "remote:mutable",
      actorId: "actor:before",
      surfaceId: mutableSurface.id,
      ownerEpoch: 1,
    };
    const snapshot = createWorkspaceSnapshot({
      panels: [mutablePanel, otherPanel],
      groups: [mutableGroup, otherGroup],
      nodes: [groupNode, otherNode, split],
      surfaces: [mutableSurface],
      floatingOrder: [mutableSurface.id],
      recoverableClosedPanels: [closedRecord],
      appliedRemoteTransactions: [remoteReceipt],
      metadata,
    });

    mutablePanel.type = "mutated";
    parameters.nested.values.push(3);
    constraints.hardMinInline = 999;
    panelIds.push(otherPanel.id);
    children.reverse();
    weights[0] = 1;
    bounds.x = 999;
    metadata.nested.enabled = false;
    closedPanel.type = "mutated-closed";
    remoteReceipt.actorId = "actor:after";

    const storedPanel = getEntity(snapshot.panels, mutablePanel.id);
    expect(storedPanel?.type).toBe("mutable");
    expect(storedPanel?.parameters).toEqual({ nested: { values: [1, 2] } });
    expect(storedPanel?.constraints.hardMinInline).toBe(100);
    expect(getEntity(snapshot.groups, mutableGroup.id)?.panelIds).toEqual([mutablePanel.id]);
    expect(getEntity(snapshot.nodes, split.id)).toMatchObject({
      children: [groupNode.id, otherNode.id],
      weights: [500_000, 500_000],
    });
    expect(getEntity(snapshot.surfaces, mutableSurface.id)?.bounds?.x).toBe(1);
    expect(snapshot.metadata).toEqual({ nested: { enabled: true } });
    expect(snapshot.recoverableClosedPanels[0]?.panel.type).toBe("mutable");
    expect(snapshot.appliedRemoteTransactions[0]?.actorId).toBe("actor:before");
    expect(Object.isFrozen(storedPanel)).toBe(true);
    expect(
      Object.isFrozen(
        (storedPanel?.parameters as { readonly nested: { readonly values: readonly number[] } })
          .nested.values,
      ),
    ).toBe(true);
    expect(Object.isFrozen(snapshot.recoverableClosedPanels[0]?.panel)).toBe(true);
  });
});

describe("JSON boundary values", () => {
  it("accepts deep acyclic data without recursion and rejects cycles, holes, and accessors", () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 10_000; index += 1) deep = [deep];
    expect(isJsonValue(deep)).toBe(true);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isJsonValue(cyclic)).toBe(false);

    const sparse = Array.from({ length: 2 });
    delete sparse[0];
    expect(isJsonValue(sparse)).toBe(false);

    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "unsafe",
    });
    expect(isJsonValue(accessor)).toBe(false);
  });

  it("allows shared acyclic objects while rejecting non-finite and non-JSON scalars", () => {
    const shared = { value: 1 };
    expect(isJsonValue({ left: shared, right: shared })).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(1n)).toBe(false);
    expect(isJsonValue(undefined)).toBe(false);
  });
});
