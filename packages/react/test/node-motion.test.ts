import { describe, expect, it } from "vitest";
import type { LogicalRect, ResolvedLayout } from "@panefold/geometry";

import {
  createWorkspaceNodeMotionSnapshot,
  resolveWorkspaceNodeMotionTransition,
} from "../src/node-motion";
import type { WorkspaceProjection } from "../src/types";

const workspaceBounds: LogicalRect = {
  inlineStart: 0,
  blockStart: 0,
  inlineSize: 1000,
  blockSize: 700,
};

const projection: WorkspaceProjection = {
  revision: "0",
  rootNodeId: "main-node",
  nodes: {
    "main-node": { kind: "group", id: "main-node", groupId: "main-group" },
    "floating-root": {
      kind: "split",
      id: "floating-root",
      axis: "inline",
      childIds: ["floating-left", "floating-right"],
      weights: [1, 1],
    },
    "floating-left": { kind: "group", id: "floating-left", groupId: "floating-left-group" },
    "floating-right": { kind: "group", id: "floating-right", groupId: "floating-right-group" },
  },
  groups: {
    "main-group": { id: "main-group", panelIds: [], selectedPanelId: "" },
    "floating-left-group": { id: "floating-left-group", panelIds: [], selectedPanelId: "" },
    "floating-right-group": { id: "floating-right-group", panelIds: [], selectedPanelId: "" },
  },
  panels: {},
  floatingSurfaces: [
    {
      id: "floating-surface",
      rootNodeId: "floating-root",
      bounds: { x: 100, y: 80, width: 320, height: 240 },
      maximized: false,
    },
  ],
};

describe("floating node motion coordinates", () => {
  it("ignores translation inherited from the same floating frame", () => {
    const previous = createWorkspaceNodeMotionSnapshot(
      projection,
      layout({
        "floating-root": rect(100, 114, 320, 206),
        "floating-left": rect(100, 114, 157, 206),
      }),
    );
    const current = createWorkspaceNodeMotionSnapshot(
      { ...projection, revision: "1" },
      layout({
        "floating-root": rect(160, 159, 320, 206),
        "floating-left": rect(160, 159, 157, 206),
      }),
    );

    expect(
      resolveWorkspaceNodeMotionTransition(
        "floating-left",
        previous,
        current,
        workspaceBounds,
        "ltr",
      ),
    ).toBeUndefined();
  });

  it("keeps floating motion local in RTL", () => {
    const previous = createWorkspaceNodeMotionSnapshot(
      projection,
      layout({
        "floating-root": rect(100, 114, 320, 206),
        "floating-left": rect(140, 114, 100, 206),
      }),
    );
    const current = createWorkspaceNodeMotionSnapshot(
      { ...projection, revision: "1" },
      layout({
        "floating-root": rect(160, 159, 320, 206),
        "floating-left": rect(220, 159, 100, 206),
      }),
    );

    expect(
      resolveWorkspaceNodeMotionTransition(
        "floating-left",
        previous,
        current,
        workspaceBounds,
        "rtl",
      ),
    ).toEqual({
      before: { x: 180, y: 0, width: 100, height: 206 },
      after: { x: 160, y: 0, width: 100, height: 206 },
    });
  });

  it("preserves structural motion inside a moving floating frame", () => {
    const previous = createWorkspaceNodeMotionSnapshot(
      projection,
      layout({
        "floating-root": rect(100, 114, 320, 206),
        "floating-right": rect(263, 114, 157, 206),
      }),
    );
    const current = createWorkspaceNodeMotionSnapshot(
      { ...projection, revision: "1" },
      layout({
        "floating-root": rect(160, 159, 320, 206),
        "floating-right": rect(283, 159, 197, 206),
      }),
    );

    expect(
      resolveWorkspaceNodeMotionTransition(
        "floating-right",
        previous,
        current,
        workspaceBounds,
        "ltr",
      ),
    ).toEqual({
      before: { x: 163, y: 0, width: 157, height: 206 },
      after: { x: 123, y: 0, width: 197, height: 206 },
    });
  });

  it("preserves absolute workspace origins outside a floating context", () => {
    const offsetBounds = { ...workspaceBounds, inlineStart: 100, blockStart: 50 };
    const previous = createWorkspaceNodeMotionSnapshot(
      projection,
      layout({ "main-node": rect(120, 60, 100, 80) }),
    );
    const current = createWorkspaceNodeMotionSnapshot(
      { ...projection, revision: "1" },
      layout({ "main-node": rect(140, 70, 100, 80) }),
    );

    expect(
      resolveWorkspaceNodeMotionTransition("main-node", previous, current, offsetBounds, "rtl"),
    ).toEqual({
      before: { x: 980, y: 60, width: 100, height: 80 },
      after: { x: 960, y: 70, width: 100, height: 80 },
    });
  });
});

function layout(nodeRects: ResolvedLayout["nodeRects"]): ResolvedLayout {
  return {
    rootNodeId: "main-node",
    nodeRects,
    groupRects: {},
    splitters: [],
    collapsedNodeIds: [],
    diagnostics: [],
  };
}

function rect(
  inlineStart: number,
  blockStart: number,
  inlineSize: number,
  blockSize: number,
): LogicalRect {
  return { inlineStart, blockStart, inlineSize, blockSize };
}
