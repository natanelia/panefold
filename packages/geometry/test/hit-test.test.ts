import { describe, expect, it } from "vitest";

import { createDropTargets, hitTestNodes } from "../src/index.js";
import type { ResolvedLayout } from "../src/index.js";

describe("logical hit testing", () => {
  const layout: ResolvedLayout = {
    rootNodeId: "root",
    nodeRects: {
      root: { inlineStart: 0, blockStart: 0, inlineSize: 100, blockSize: 100 },
      child: { inlineStart: 10, blockStart: 10, inlineSize: 40, blockSize: 40 },
    },
    groupRects: {},
    splitters: [],
    collapsedNodeIds: [],
    diagnostics: [],
  };

  it("chooses the deepest/smallest rectangle", () => {
    expect(hitTestNodes(layout, { inline: 20, block: 20 })).toBe("child");
    expect(hitTestNodes(layout, { inline: 90, block: 90 })).toBe("root");
    expect(hitTestNodes(layout, { inline: 100, block: 100 })).toBeUndefined();
  });

  it("derives logical center and edge targets without physical directions", () => {
    const childRect = layout.nodeRects.child;
    if (childRect === undefined) throw new RangeError("Missing child test rectangle.");
    const targets = createDropTargets("child", childRect);

    expect(targets).toHaveLength(5);
    expect(targets[0]).toEqual({
      kind: "inside",
      nodeId: "child",
      rect: { inlineStart: 20, blockStart: 20, inlineSize: 20, blockSize: 20 },
    });
    expect(targets.map((target) => (target.kind === "split" ? target.edge : target.kind))).toEqual([
      "inside",
      "inline-start",
      "inline-end",
      "block-start",
      "block-end",
    ]);
  });
});
