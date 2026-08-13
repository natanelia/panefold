import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import { planLayoutInvalidation } from "../src/index.js";

const ids = {
  panelA: panelId("panel:a"),
  panelB: panelId("panel:b"),
  panelC: panelId("panel:c"),
  groupA: groupId("group:a"),
  groupB: groupId("group:b"),
  nodeA: nodeId("node:a"),
  nodeB: nodeId("node:b"),
  root: nodeId("node:root"),
  surface: surfaceId("surface:main"),
} as const;

function panel(id: PanelRecord["id"], preferredInline: number): PanelRecord {
  return {
    id,
    type: "test.panel",
    typeVersion: 1,
    parameters: null,
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: { preferredInline },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

function fixture(selectedPanelId = ids.panelA, weights: readonly number[] = [1, 1]) {
  const groupA: GroupRecord = {
    id: ids.groupA,
    panelIds: [ids.panelA, ids.panelB],
    selectedPanelId,
    persistent: false,
  };
  const groupB: GroupRecord = {
    id: ids.groupB,
    panelIds: [ids.panelC],
    selectedPanelId: ids.panelC,
    persistent: false,
  };
  const nodes: readonly LayoutNode[] = [
    { kind: "group", id: ids.nodeA, groupId: ids.groupA },
    { kind: "group", id: ids.nodeB, groupId: ids.groupB },
    {
      kind: "split",
      id: ids.root,
      axis: "inline",
      children: [ids.nodeA, ids.nodeB],
      weights,
      collapsedChildIds: [],
    },
  ];
  return createWorkspaceSnapshot({
    panels: [panel(ids.panelA, 100), panel(ids.panelB, 200), panel(ids.panelC, 100)],
    groups: [groupA, groupB],
    nodes,
    surfaces: [
      {
        id: ids.surface,
        kind: "main",
        rootNodeId: ids.root,
        capabilities: MAIN_SURFACE_CAPABILITIES,
        maximized: false,
      },
    ],
  });
}

function entity<Entity extends { readonly id: string }>(
  snapshot: WorkspaceSnapshot,
  table: "groups" | "nodes" | "panels",
  id: Entity["id"],
): Entity {
  const value = snapshot[table].byId[String(id)] as Entity | undefined;
  if (value === undefined) throw new Error(`fixture ${table} entity is missing`);
  return value;
}

describe("planLayoutInvalidation", () => {
  it("invalidates the containing surface when selected constraints may change", () => {
    const before = fixture();
    const after = fixture(ids.panelB);
    const patch = {
      kind: "group",
      id: ids.groupA,
      before: entity<GroupRecord>(before, "groups", ids.groupA),
      after: entity<GroupRecord>(after, "groups", ids.groupA),
    } as const;

    const plan = planLayoutInvalidation(before, after, [patch]);

    expect(plan.constraintNodeIds).toEqual(["node:a", "node:root"]);
    expect(plan.geometryNodeIds).toEqual(["node:a", "node:b", "node:root"]);
    expect(plan.surfaceIds).toEqual(["surface:main"]);
    expect(plan.surfaceIndexIds).toEqual([]);
  });

  it("keeps a weight-only allocation invalidation inside its changed subtree", () => {
    const before = fixture();
    const after = fixture(ids.panelA, [3, 2]);
    const patch = {
      kind: "node",
      id: ids.root,
      before: entity<LayoutNode>(before, "nodes", ids.root),
      after: entity<LayoutNode>(after, "nodes", ids.root),
    } as const;

    const plan = planLayoutInvalidation(before, after, [patch]);

    expect(plan.constraintNodeIds).toEqual([]);
    expect(plan.geometryNodeIds).toEqual(["node:a", "node:b", "node:root"]);
    expect(plan.surfaceIndexIds).toEqual([]);
  });

  it("ignores panel metadata changes that cannot affect geometry", () => {
    const before = fixture();
    const existing = entity<PanelRecord>(before, "panels", ids.panelA);
    const patch = {
      kind: "panel",
      id: existing.id,
      before: existing,
      after: { ...existing, title: "Renamed" },
    } as const;

    expect(planLayoutInvalidation(before, before, [patch])).toEqual({
      constraintNodeIds: [],
      geometryNodeIds: [],
      surfaceIds: [],
      surfaceIndexIds: [],
    });
  });

  it("keeps solved geometry and target indexes for a pure tab reorder", () => {
    const before = fixture();
    const group = entity<GroupRecord>(before, "groups", ids.groupA);
    const reordered: GroupRecord = {
      ...group,
      panelIds: [ids.panelB, ids.panelA],
    };
    const patch = {
      kind: "group",
      id: group.id,
      before: group,
      after: reordered,
    } as const;

    expect(planLayoutInvalidation(before, before, [patch])).toEqual({
      constraintNodeIds: [],
      geometryNodeIds: [],
      surfaceIds: [],
      surfaceIndexIds: [],
    });
  });
});
