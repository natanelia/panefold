import { describe, expect, it } from "vitest";
import type { ResolvedLayout } from "@panefold/geometry";

import { createGroupDropCandidates, hitTestGroupDropCandidates } from "../src/group-drop";
import type {
  WorkspaceGroupDropPlanContext,
  WorkspaceGroupDropRequest,
  WorkspaceProjection,
} from "../src/types";

const projection: WorkspaceProjection = {
  revision: "11",
  rootNodeId: "root",
  nodes: {
    root: {
      kind: "split",
      id: "root",
      axis: "inline",
      childIds: ["left-node", "right-node"],
      weights: [1, 1],
    },
    "left-node": { kind: "group", id: "left-node", groupId: "left" },
    "right-node": { kind: "group", id: "right-node", groupId: "right" },
  },
  groups: {
    left: {
      id: "left",
      panelIds: ["alpha", "beta"],
      selectedPanelId: "alpha",
      label: "Left",
    },
    right: {
      id: "right",
      panelIds: ["gamma"],
      selectedPanelId: "gamma",
      label: "Right",
    },
  },
  panels: {
    alpha: { id: "alpha", type: "fixture", title: "Alpha" },
    beta: { id: "beta", type: "fixture", title: "Beta" },
    gamma: { id: "gamma", type: "fixture", title: "Gamma" },
  },
};

const rightRect = Object.freeze({
  inlineStart: 406,
  blockStart: 0,
  inlineSize: 394,
  blockSize: 300,
});

const layout: ResolvedLayout = {
  rootNodeId: "root",
  nodeRects: {
    root: { inlineStart: 0, blockStart: 0, inlineSize: 800, blockSize: 300 },
    "left-node": { inlineStart: 0, blockStart: 0, inlineSize: 400, blockSize: 300 },
    "right-node": rightRect,
  },
  groupRects: {
    left: { inlineStart: 0, blockStart: 0, inlineSize: 400, blockSize: 300 },
    right: rightRect,
  },
  splitters: [],
  collapsedNodeIds: [],
  diagnostics: [],
};

describe("group drop geometry", () => {
  it("builds only other-container swap and edge targets with exact retained plans", () => {
    const commands = new Map<string, object>();
    const candidates = createGroupDropCandidates(
      projection,
      layout,
      "left",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      (request, context) => {
        const command = Object.freeze({ request });
        commands.set(request.target.kind === "swap" ? "swap" : request.target.edge, command);
        return {
          command,
          previewRect:
            request.target.kind === "swap" ? context.targetRect : edgePreview(request, context),
        };
      },
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "swap:right-node",
      "edge:right-node:inline-start",
      "edge:right-node:inline-end",
      "edge:right-node:block-start",
      "edge:right-node:block-end",
    ]);
    const swap = candidates.find((candidate) => candidate.id === "swap:right-node");
    expect(swap?.label).toBe("Swap Left and Right panel containers");
    expect(swap?.previewRect).toEqual(rightRect);
    expect(swap?.plan.command).toBe(commands.get("swap"));
    expect(swap?.request.sourceGroup.panelIds).toEqual(["alpha", "beta"]);
    expect(swap?.request.sourceNodeId).toBe("left-node");
    expect(Object.isFrozen(swap?.request)).toBe(true);
    expect(Object.isFrozen(swap?.request.sourceGroup.panelIds)).toBe(true);
    expect(candidates.some((candidate) => candidate.id.includes("left-node"))).toBe(false);
  });

  it("prefers center swap acquisition and resolves edge acquisition deterministically", () => {
    const candidates = createGroupDropCandidates(
      projection,
      layout,
      "left",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      (_request, context) => ({ command: "group-drop", previewRect: context.targetRect }),
    );

    expect(hitTestGroupDropCandidates(candidates, { inline: 600, block: 150 })?.id).toBe(
      "swap:right-node",
    );
    expect(hitTestGroupDropCandidates(candidates, { inline: 410, block: 150 })?.id).toBe(
      "edge:right-node:inline-start",
    );
  });

  it("prefers the frontmost floating surface over an obscured main-surface target", () => {
    const floatingRect = {
      inlineStart: 500,
      blockStart: 100,
      inlineSize: 200,
      blockSize: 150,
    };
    const withFloating: WorkspaceProjection = {
      ...projection,
      nodes: {
        ...projection.nodes,
        "floating-node": { kind: "group", id: "floating-node", groupId: "floating" },
      },
      groups: {
        ...projection.groups,
        floating: {
          id: "floating",
          panelIds: ["delta"],
          selectedPanelId: "delta",
          label: "Floating",
        },
      },
      panels: {
        ...projection.panels,
        delta: { id: "delta", type: "fixture", title: "Delta" },
      },
      floatingSurfaces: [
        {
          id: "surface:floating",
          rootNodeId: "floating-node",
          bounds: { x: 500, y: 66, width: 200, height: 184 },
          maximized: false,
        },
      ],
    };
    const floatingLayout: ResolvedLayout = {
      ...layout,
      nodeRects: { ...layout.nodeRects, "floating-node": floatingRect },
      groupRects: { ...layout.groupRects, floating: floatingRect },
    };
    const candidates = createGroupDropCandidates(
      withFloating,
      floatingLayout,
      "left",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      (_request, context) => ({ command: "group-drop", previewRect: context.targetRect }),
    );

    expect(hitTestGroupDropCandidates(candidates, { inline: 506, block: 175 })?.id).toBe(
      "edge:floating-node:inline-start",
    );
  });

  it("fails closed when application planning throws or returns invalid geometry", () => {
    for (const planner of [
      () => {
        throw new Error("planner failed");
      },
      () => ({ command: "bad", previewRect: { ...rightRect, inlineSize: Number.NaN } }),
      () => ({ command: "bad", previewRect: { ...rightRect, inlineStart: 799, inlineSize: 2 } }),
    ]) {
      expect(
        createGroupDropCandidates(
          projection,
          layout,
          "left",
          "ltr",
          0.25,
          0.5,
          6,
          undefined,
          planner,
        ),
      ).toEqual([]);
    }
  });
});

function edgePreview(request: WorkspaceGroupDropRequest, context: WorkspaceGroupDropPlanContext) {
  if (request.target.kind !== "edge") return context.targetRect;
  const rect = context.targetRect;
  const inlineSize = Math.round((rect.inlineSize - context.splitterSize) * request.target.ratio);
  const blockSize = Math.round((rect.blockSize - context.splitterSize) * request.target.ratio);
  if (request.target.edge === "inline-start") return { ...rect, inlineSize };
  if (request.target.edge === "inline-end") {
    return { ...rect, inlineStart: rect.inlineStart + rect.inlineSize - inlineSize, inlineSize };
  }
  if (request.target.edge === "block-start") return { ...rect, blockSize };
  return { ...rect, blockStart: rect.blockStart + rect.blockSize - blockSize, blockSize };
}
