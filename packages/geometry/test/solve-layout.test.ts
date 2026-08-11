import fc from "fast-check";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
} from "@panefold/model";
import type { GroupRecord, LayoutNode, PanelConstraints, PanelRecord } from "@panefold/model";
import { describe, expect, it } from "vitest";

import { solveLayout } from "../src/index.js";

function panel(name: string, constraints: PanelConstraints = {}): PanelRecord {
  return {
    id: panelId(name),
    type: "test",
    typeVersion: 1,
    parameters: null,
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints,
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

function group(name: string, panelNames: readonly string[], selected?: string): GroupRecord {
  const selectedPanelName = selected ?? panelNames[0];
  if (selectedPanelName === undefined) throw new RangeError("A test group requires one panel.");
  return {
    id: groupId(name),
    panelIds: panelNames.map(panelId),
    selectedPanelId: panelId(selectedPanelName),
    persistent: false,
  };
}

function groupNode(name: string, groupName = name): LayoutNode {
  return { kind: "group", id: nodeId(name), groupId: groupId(groupName) };
}

describe("solveLayout", () => {
  it("recursively solves logical n-ary splits with exact splitter conservation", () => {
    const panels = [panel("p1"), panel("p2"), panel("p3")];
    const groups = [group("g1", ["p1"]), group("g2", ["p2"]), group("g3", ["p3"])];
    const nodes: LayoutNode[] = [
      groupNode("n1", "g1"),
      groupNode("n2", "g2"),
      groupNode("n3", "g3"),
      {
        kind: "split",
        id: nodeId("nested"),
        axis: "block",
        children: [nodeId("n2"), nodeId("n3")],
        weights: [1, 1],
        collapsedChildIds: [],
      },
      {
        kind: "split",
        id: nodeId("root"),
        axis: "inline",
        children: [nodeId("n1"), nodeId("nested")],
        weights: [1, 2],
        collapsedChildIds: [],
      },
    ];
    const snapshot = createWorkspaceSnapshot({ panels, groups, nodes });

    const result = solveLayout(
      snapshot,
      nodeId("root"),
      { inlineStart: 10, blockStart: 20, inlineSize: 306, blockSize: 104 },
      { splitterSize: 6 },
    );

    expect(result.nodeRects.n1).toEqual({
      inlineStart: 10,
      blockStart: 20,
      inlineSize: 100,
      blockSize: 104,
    });
    expect(result.nodeRects.nested).toEqual({
      inlineStart: 116,
      blockStart: 20,
      inlineSize: 200,
      blockSize: 104,
    });
    expect(result.nodeRects.n2?.blockSize).toBe(49);
    expect(result.nodeRects.n3).toMatchObject({ blockStart: 75, blockSize: 49 });
    expect(result.splitters.map((splitter) => splitter.rect)).toEqual([
      { inlineStart: 110, blockStart: 20, inlineSize: 6, blockSize: 104 },
      { inlineStart: 116, blockStart: 69, inlineSize: 200, blockSize: 6 },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("derives group hard minima from every panel and preference/max from the selection", () => {
    const panels = [
      panel("selected", { hardMinInline: 100, preferredInline: 120, maxInline: 220 }),
      panel("hidden", { hardMinInline: 200 }),
      panel("other"),
    ];
    const groups = [group("g1", ["selected", "hidden"], "selected"), group("g2", ["other"])];
    const nodes: LayoutNode[] = [
      groupNode("n1", "g1"),
      groupNode("n2", "g2"),
      {
        kind: "split",
        id: nodeId("root"),
        axis: "inline",
        children: [nodeId("n1"), nodeId("n2")],
        weights: [1, 1],
        collapsedChildIds: [],
      },
    ];
    const snapshot = createWorkspaceSnapshot({ panels, groups, nodes });

    const result = solveLayout(snapshot, nodeId("root"), {
      inlineStart: 0,
      blockStart: 0,
      inlineSize: 306,
      blockSize: 100,
    });

    expect(result.nodeRects.n1?.inlineSize).toBeGreaterThanOrEqual(200);
    expect(result.nodeRects.n1?.inlineSize).toBeLessThanOrEqual(220);
    const firstRect = result.nodeRects.n1;
    const secondRect = result.nodeRects.n2;
    if (firstRect === undefined || secondRect === undefined) {
      throw new RangeError("Expected both split children to be resolved.");
    }
    expect(firstRect.inlineSize + secondRect.inlineSize + 6).toBe(306);
  });

  it("honors semantic collapsedChildIds before emergency collapse", () => {
    const panels = [panel("p1"), panel("p2"), panel("p3")];
    const groups = [group("g1", ["p1"]), group("g2", ["p2"]), group("g3", ["p3"])];
    const nodes: LayoutNode[] = [
      groupNode("n1", "g1"),
      groupNode("n2", "g2"),
      groupNode("n3", "g3"),
      {
        kind: "split",
        id: nodeId("root"),
        axis: "inline",
        children: [nodeId("n1"), nodeId("n2"), nodeId("n3")],
        weights: [1, 1, 1],
        collapsedChildIds: [nodeId("n2")],
      },
    ];
    const snapshot = createWorkspaceSnapshot({ panels, groups, nodes });

    const result = solveLayout(snapshot, nodeId("root"), {
      inlineStart: 0,
      blockStart: 0,
      inlineSize: 206,
      blockSize: 100,
    });

    expect(result.nodeRects.n1?.inlineSize).toBe(100);
    expect(result.nodeRects.n2?.inlineSize).toBe(0);
    expect(result.nodeRects.n3).toMatchObject({ inlineStart: 106, inlineSize: 100 });
    expect(result.collapsedNodeIds).toEqual(["n2"]);
    expect(result.splitters).toHaveLength(1);
  });

  it("propagates the tightest finite cross-axis maximum through nested splits", () => {
    const panels = [panel("p1"), panel("p2", { maxInline: 80 }), panel("p3")];
    const groups = [group("g1", ["p1"]), group("g2", ["p2"]), group("g3", ["p3"])];
    const leaves = [groupNode("n1", "g1"), groupNode("n2", "g2"), groupNode("n3", "g3")];
    const nested: LayoutNode = {
      kind: "split",
      id: nodeId("nested"),
      axis: "block",
      children: [nodeId("n2"), nodeId("n3")],
      weights: [1, 1],
      collapsedChildIds: [],
    };
    const root: LayoutNode = {
      kind: "split",
      id: nodeId("root"),
      axis: "inline",
      children: [nodeId("n1"), nodeId("nested")],
      weights: [1, 1],
      collapsedChildIds: [],
    };
    const snapshot = createWorkspaceSnapshot({
      panels,
      groups,
      nodes: [...leaves, nested, root],
    });

    const result = solveLayout(snapshot, root.id, {
      inlineStart: 0,
      blockStart: 0,
      inlineSize: 206,
      blockSize: 106,
    });

    expect(result.nodeRects.nested?.inlineSize).toBe(80);
    expect(result.nodeRects.n1?.inlineSize).toBe(120);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports malformed cycles instead of recursing forever", () => {
    const root: LayoutNode = {
      kind: "split",
      id: nodeId("root"),
      axis: "inline",
      children: [nodeId("root")],
      weights: [1],
      collapsedChildIds: [],
    };
    const snapshot = createWorkspaceSnapshot({ nodes: [root] });

    const result = solveLayout(snapshot, nodeId("root"), {
      inlineStart: 0,
      blockStart: 0,
      inlineSize: 100,
      blockSize: 100,
    });

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "LAYOUT_CYCLE")).toBe(true);
  });

  it("is deterministic and conserves flat split geometry across generated workloads", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 12 }),
        fc.integer({ min: 12, max: 2_000 }),
        fc.integer({ min: 0, max: 12 }),
        (weights, requestedWidth, splitterSize) => {
          const count = weights.length;
          const width = Math.max(requestedWidth, splitterSize * (count - 1));
          const panels = weights.map((_, index) => panel(`p${index}`));
          const groups = weights.map((_, index) => group(`g${index}`, [`p${index}`]));
          const leaves = weights.map((_, index) => groupNode(`n${index}`, `g${index}`));
          const root: LayoutNode = {
            kind: "split",
            id: nodeId("root"),
            axis: "inline",
            children: leaves.map((leaf) => leaf.id),
            weights,
            collapsedChildIds: [],
          };
          const snapshot = createWorkspaceSnapshot({ panels, groups, nodes: [...leaves, root] });
          const bounds = { inlineStart: 0, blockStart: 0, inlineSize: width, blockSize: 100 };
          const first = solveLayout(snapshot, nodeId("root"), bounds, { splitterSize });
          const second = solveLayout(snapshot, nodeId("root"), bounds, { splitterSize });
          const childTotal = leaves.reduce(
            (total, leaf) => total + (first.nodeRects[String(leaf.id)]?.inlineSize ?? 0),
            0,
          );
          const splitterTotal = first.splitters.reduce(
            (total, splitter) => total + splitter.rect.inlineSize,
            0,
          );

          expect(second).toEqual(first);
          expect(childTotal + splitterTotal).toBe(width);
          expect(first.nodeRects.root?.inlineSize).toBe(width);
        },
      ),
      { numRuns: 500 },
    );
  });
});
