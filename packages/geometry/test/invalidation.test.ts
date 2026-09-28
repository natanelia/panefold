import fc from "fast-check";
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
  type WorkspacePatch,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import { planLayoutInvalidation } from "../src/index.js";
import { planLayoutInvalidation as referencePlan } from "./reference/invalidation.js";

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

describe("lazy snapshot indexes", () => {
  it("does not traverse snapshot tables for empty or geometry-neutral patches", () => {
    const snapshot = fixture();
    let tableReads = 0;
    const observed = new Proxy(snapshot, {
      get(target, key, receiver) {
        if (key === "groups" || key === "nodes" || key === "surfaces") tableReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const panel = entity<PanelRecord>(snapshot, "panels", ids.panelA);
    const group = entity<GroupRecord>(snapshot, "groups", ids.groupA);
    const patches: readonly WorkspacePatch[] = [
      { kind: "activation", before: snapshot.activation, after: { activePanelId: ids.panelB } },
      { kind: "metadata", before: {}, after: { title: "Renamed" } },
      { kind: "focus-memory", before: snapshot.focusMemory, after: { fallback: "workspace-root" } },
      { kind: "panel", id: panel.id, before: panel, after: { ...panel, title: "New title" } },
      {
        kind: "group",
        id: group.id,
        before: group,
        after: { ...group, panelIds: [...group.panelIds].reverse() },
      },
    ];
    for (const entries of [[], patches]) {
      const plan = planLayoutInvalidation(observed, observed, entries);
      expect(plan).toEqual(referencePlan(snapshot, snapshot, entries));
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.values(plan).every(Object.isFrozen)).toBe(true);
    }
    expect(tableReads).toBe(0);
  });

  it("matches the original index plan across 5000 seeded topology and patch combinations", () => {
    function variation(data: readonly number[]): WorkspaceSnapshot {
      const pick = (index: number) => data[index % data.length] ?? 0;
      const base = fixture(pick(0) % 2 === 0 ? ids.panelA : ids.panelB, [pick(1) + 1, pick(2) + 1]);
      const panels = Object.values(base.panels.byId)
        .filter((_, i) => pick(i + 3) % 7 !== 0)
        .map((panel, i) => ({ ...panel, constraints: { preferredInline: pick(i + 4) * 10 } }));
      const groups = Object.values(base.groups.byId).filter((_, i) => pick(i + 5) % 7 !== 0);
      const nodes = Object.values(base.nodes.byId)
        .filter((_, i) => pick(i + 7) % 9 !== 0)
        .map((node) =>
          node.kind !== "split"
            ? node
            : {
                ...node,
                children: pick(10) % 3 === 0 ? [ids.root, ids.nodeA] : node.children,
                collapsedChildIds: pick(11) % 2 === 0 ? [ids.nodeA] : [],
              },
        );
      const surfaces = Object.values(base.surfaces.byId)
        .filter(() => pick(12) % 5 !== 0)
        .map((surface) => ({
          ...surface,
          rootNodeId: pick(13) % 2 === 0 ? ids.root : ids.nodeB,
          maximized: pick(14) % 2 === 0,
        }));
      return createWorkspaceSnapshot({ panels, groups, nodes, surfaces });
    }
    const data = fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 16, maxLength: 32 });
    fc.assert(
      fc.property(data, data, (left, right) => {
        const before = variation(left);
        const after = variation(right);
        const patches: WorkspacePatch[] = [];
        for (const [table, kind] of [
          ["panels", "panel"],
          ["groups", "group"],
          ["nodes", "node"],
          ["surfaces", "surface"],
        ] as const) {
          for (const id of new Set([...before[table].ids, ...after[table].ids])) {
            const oldRecord = before[table].byId[id];
            const newRecord = after[table].byId[id];
            // Table and discriminant are paired above; omit absent optional records.
            patches.push({
              kind,
              id,
              ...(oldRecord === undefined ? {} : { before: oldRecord }),
              ...(newRecord === undefined ? {} : { after: newRecord }),
            } as WorkspacePatch);
          }
        }
        for (const patch of patches) {
          expect(planLayoutInvalidation(before, after, [patch])).toEqual(
            referencePlan(before, after, [patch]),
          );
        }
        expect(planLayoutInvalidation(before, after, patches)).toEqual(
          referencePlan(before, after, patches),
        );
        expect(planLayoutInvalidation(after, before, patches)).toEqual(
          referencePlan(after, before, patches),
        );
      }),
      { seed: 20260927, numRuns: 5000 },
    );
  });
});
