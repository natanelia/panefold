import { describe, expect, it } from "vitest";
import type { ResolvedLayout } from "@panefold/geometry";

import { createPanelDropCandidates } from "../src/panel-drop";
import type {
  WorkspacePanelDropPlanContext,
  WorkspacePanelDropRequest,
  WorkspaceProjection,
} from "../src/types";

const targetRect = Object.freeze({
  inlineStart: 400,
  blockStart: 20,
  inlineSize: 400,
  blockSize: 300,
});

const projection: WorkspaceProjection = {
  revision: "7",
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
    right: { id: "right", panelIds: ["gamma"], selectedPanelId: "gamma", label: "Right" },
  },
  panels: {
    alpha: { id: "alpha", type: "fixture", title: "Alpha" },
    beta: { id: "beta", type: "fixture", title: "Beta" },
    gamma: { id: "gamma", type: "fixture", title: "Gamma" },
  },
  activePanelId: "alpha",
};

const layout: ResolvedLayout = {
  rootNodeId: "root",
  nodeRects: {
    root: { inlineStart: 0, blockStart: 20, inlineSize: 800, blockSize: 300 },
    "left-node": { inlineStart: 0, blockStart: 20, inlineSize: 394, blockSize: 300 },
    "right-node": targetRect,
  },
  groupRects: {
    left: { inlineStart: 0, blockStart: 20, inlineSize: 394, blockSize: 300 },
    right: targetRect,
  },
  splitters: [],
  collapsedNodeIds: [],
  diagnostics: [],
};

describe("panel drop geometry", () => {
  it("uses a compact center hit zone but previews the complete destination group", () => {
    const candidates = createPanelDropCandidates(
      projection,
      layout,
      "alpha",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      exactFixturePlanner,
    );
    const center = candidates.find((candidate) => candidate.id === "center:right-node");

    expect(center?.hitRect).toEqual({
      inlineStart: 500,
      blockStart: 95,
      inlineSize: 200,
      blockSize: 150,
    });
    expect(center?.previewRect).toEqual(targetRect);
    expect(center?.previewRect).not.toEqual(center?.hitRect);
  });

  it("previews the committed half pane across the target's full cross-axis extent", () => {
    const candidates = createPanelDropCandidates(
      projection,
      layout,
      "alpha",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      exactFixturePlanner,
    );
    const edge = candidates.find((candidate) => candidate.id === "edge:right-node:inline-start");

    expect(edge?.hitRect).toEqual({
      inlineStart: 400,
      blockStart: 95,
      inlineSize: 100,
      blockSize: 150,
    });
    // 400px total - 6px committed splitter = 394px content, split evenly.
    expect(edge?.previewRect).toEqual({
      inlineStart: 400,
      blockStart: 20,
      inlineSize: 197,
      blockSize: 300,
    });
  });

  it("prefers an application-planned preview paired with the exact retained command", () => {
    const command = Object.freeze({ type: "planned-drop", nonce: "same-command" });
    const previewRect = Object.freeze({
      inlineStart: 400,
      blockStart: 20,
      inlineSize: 231,
      blockSize: 300,
    });
    const candidates = createPanelDropCandidates(
      projection,
      layout,
      "alpha",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      (request) =>
        request.target.kind === "edge" && request.target.edge === "inline-start"
          ? Object.freeze({ command, previewRect })
          : undefined,
    );
    const edge = candidates.find((candidate) => candidate.id === "edge:right-node:inline-start");

    expect(edge?.previewRect).toEqual(previewRect);
    expect(edge?.plan?.command).toBe(command);
    expect(Object.isFrozen(edge?.plan)).toBe(true);
    expect(Object.isFrozen(edge?.previewRect)).toBe(true);
  });

  it("fails closed for thrown, non-finite, negative, and out-of-bounds plans", () => {
    for (const planner of [
      () => {
        throw new Error("fixture planner failed");
      },
      () => ({ command: "bad", previewRect: { ...targetRect, inlineSize: Number.NaN } }),
      () => ({ command: "bad", previewRect: { ...targetRect, blockSize: -1 } }),
      () => ({
        command: "bad",
        previewRect: { ...targetRect, inlineStart: 799, inlineSize: 2 },
      }),
    ]) {
      expect(
        createPanelDropCandidates(
          projection,
          layout,
          "alpha",
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

  it("plans floating targets against their containing surface instead of the main root", () => {
    const floatingSurfaceRect = {
      inlineStart: 840,
      blockStart: 70,
      inlineSize: 280,
      blockSize: 190,
    };
    const floatingTarget = { ...floatingSurfaceRect, inlineSize: 137 };
    const floatingSibling = { ...floatingSurfaceRect, inlineStart: 983, inlineSize: 137 };
    const floatingProjection: WorkspaceProjection = {
      ...projection,
      nodes: {
        ...projection.nodes,
        "floating-root": {
          kind: "split",
          id: "floating-root",
          axis: "inline",
          childIds: ["floating-node", "floating-sibling-node"],
          weights: [1, 1],
        },
        "floating-node": { kind: "group", id: "floating-node", groupId: "floating" },
        "floating-sibling-node": {
          kind: "group",
          id: "floating-sibling-node",
          groupId: "floating-sibling",
        },
      },
      groups: {
        ...projection.groups,
        floating: {
          id: "floating",
          panelIds: ["delta"],
          selectedPanelId: "delta",
          label: "Floating",
        },
        "floating-sibling": {
          id: "floating-sibling",
          panelIds: ["epsilon"],
          selectedPanelId: "epsilon",
          label: "Floating sibling",
        },
      },
      panels: {
        ...projection.panels,
        delta: { id: "delta", type: "fixture", title: "Delta" },
        epsilon: { id: "epsilon", type: "fixture", title: "Epsilon" },
      },
      floatingSurfaces: [
        {
          id: "surface:floating",
          rootNodeId: "floating-root",
          bounds: { x: 840, y: 36, width: 280, height: 224 },
          maximized: false,
        },
      ],
    };
    const floatingLayout: ResolvedLayout = {
      ...layout,
      nodeRects: {
        ...layout.nodeRects,
        "floating-root": floatingSurfaceRect,
        "floating-node": floatingTarget,
        "floating-sibling-node": floatingSibling,
      },
      groupRects: {
        ...layout.groupRects,
        floating: floatingTarget,
        "floating-sibling": floatingSibling,
      },
    };
    let receivedBounds: WorkspacePanelDropPlanContext["bounds"] | undefined;
    const candidates = createPanelDropCandidates(
      floatingProjection,
      floatingLayout,
      "alpha",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      (request, context) => {
        if (request.targetGroup.id !== "floating" || request.target.kind !== "center") {
          return undefined;
        }
        receivedBounds = context.bounds;
        return { command: "float-drop", previewRect: context.targetRect };
      },
    );

    expect(candidates.find((candidate) => candidate.id === "center:floating-node")).toBeTruthy();
    expect(receivedBounds).toEqual(floatingSurfaceRect);
    expect(receivedBounds).not.toEqual(floatingTarget);
    expect(receivedBounds).not.toEqual(layout.nodeRects[layout.rootNodeId]);
  });

  it("delivers frozen revision-bound request and geometry context to application policy", () => {
    let receivedRequest: WorkspacePanelDropRequest | undefined;
    let receivedContext: WorkspacePanelDropPlanContext | undefined;
    createPanelDropCandidates(
      projection,
      layout,
      "alpha",
      "ltr",
      0.25,
      0.5,
      6,
      undefined,
      (request, context) => {
        receivedRequest ??= request;
        receivedContext ??= context;
        return { command: "planned", previewRect: context.targetRect };
      },
    );

    expect(receivedRequest?.revision).toBe("7");
    expect(Object.isFrozen(receivedRequest)).toBe(true);
    expect(Object.isFrozen(receivedRequest?.sourceGroup.panelIds)).toBe(true);
    expect(Object.isFrozen(receivedContext)).toBe(true);
    expect(Object.isFrozen(receivedContext?.bounds)).toBe(true);
    expect(Object.isFrozen(receivedContext?.targetRect)).toBe(true);
    expect(receivedContext?.splitterSize).toBe(6);
  });
});

function exactFixturePlanner(
  request: WorkspacePanelDropRequest,
  context: WorkspacePanelDropPlanContext,
) {
  const previewRect =
    request.target.kind === "center"
      ? context.targetRect
      : request.target.edge === "inline-start"
        ? { ...context.targetRect, inlineSize: 197 }
        : request.target.edge === "inline-end"
          ? { ...context.targetRect, inlineStart: 603, inlineSize: 197 }
          : request.target.edge === "block-start"
            ? { ...context.targetRect, blockSize: 147 }
            : { ...context.targetRect, blockStart: 173, blockSize: 147 };
  return { command: { type: "planned-drop", request }, previewRect };
}
