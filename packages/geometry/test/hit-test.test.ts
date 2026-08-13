import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { containsPoint, createDropTargets, hitTestNodes } from "../src/index.js";
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

  it("uses stable IDs to resolve equal-area overlaps without mutating the layout", () => {
    const first = { inlineStart: 0, blockStart: 0, inlineSize: 40, blockSize: 20 };
    const second = { inlineStart: 10, blockStart: 0, inlineSize: 20, blockSize: 40 };
    const equalAreaLayout: ResolvedLayout = {
      rootNodeId: "z-node",
      nodeRects: { "z-node": first, "a-node": second },
      groupRects: {},
      splitters: [],
      collapsedNodeIds: [],
      diagnostics: [],
    };

    expect(hitTestNodes(equalAreaLayout, { inline: 15, block: 10 })).toBe("a-node");
    expect(equalAreaLayout.nodeRects).toEqual({ "z-node": first, "a-node": second });
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
    expect(targets[1]?.rect).toEqual({
      inlineStart: 10,
      blockStart: 20,
      inlineSize: 10,
      blockSize: 20,
    });
    expect(targets[3]?.rect).toEqual({
      inlineStart: 10,
      blockStart: 10,
      inlineSize: 40,
      blockSize: 10,
    });
  });

  it("partitions every integer point into one deterministic target, including tiny rectangles", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.double({ min: 0, max: 0.45, noNaN: true }),
        (inlineSize, blockSize, ratio) => {
          const rect = { inlineStart: 7, blockStart: 11, inlineSize, blockSize };
          const targets = createDropTargets("leaf", rect, ratio);

          for (let inline = rect.inlineStart; inline < rect.inlineStart + inlineSize; inline += 1) {
            for (let block = rect.blockStart; block < rect.blockStart + blockSize; block += 1) {
              expect(
                targets.filter((target) => containsPoint(target.rect, { inline, block })),
              ).toHaveLength(1);
            }
          }
          expect(
            targets.every((target) => target.rect.inlineSize >= 0 && target.rect.blockSize >= 0),
          ).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  }, 15_000);
});
