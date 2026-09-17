import { describe, expect, it } from "vitest";
import { createEditorDropArea, hitTestEditorDropArea } from "../src/drop-target";
import type { WorkspaceLogicalEdge } from "../src/types";

const rect = { inlineStart: 100, blockStart: 50, inlineSize: 600, blockSize: 400 };

describe("VS Code editor drop acquisition", () => {
  it.each([
    [0.05, 0.5, "inline-start"],
    [0.95, 0.5, "inline-end"],
    [0.5, 0.05, "block-start"],
    [0.5, 0.95, "block-end"],
    [0.15, 0.5, "center"],
    [0.85, 0.5, "center"],
    [0.5, 0.15, "center"],
    [0.5, 0.85, "center"],
    [0.1, 0.5, "inline-start"],
    [0.9, 0.5, "inline-end"],
    [0.5, 0.1, "block-start"],
    [0.5, 0.9, "block-end"],
    // Even close to the top, left/right thirds take priority at corners.
    [0.2, 0.01, "inline-start"],
    [0.8, 0.01, "inline-end"],
    [0.2, 0.99, "inline-start"],
    [0.8, 0.99, "inline-end"],
    [1 / 3, 0.01, "block-start"],
    [2 / 3, 0.99, "block-end"],
  ] as const)("resolves (%s, %s) to %s", (x, y, region) => {
    expect(
      hitTestEditorDropArea(createEditorDropArea(rect, undefined), {
        inline: rect.inlineStart + rect.inlineSize * x,
        block: rect.blockStart + rect.blockSize * y,
      }),
    ).toBe(region);
  });

  it("matches the default upstream decision table across wide and tall views", () => {
    // Independent normalized oracle for editorDropTarget.ts positionOverlay.
    const upstream = (x: number, y: number, group: boolean): "center" | WorkspaceLogicalEdge => {
      const margin = group ? 0.3 : 0.1;
      if (x > margin && x < 1 - margin && y > 0.1 && y < 0.9) return "center";
      if (x < 1 / 3) return "inline-start";
      if (x > 2 / 3) return "inline-end";
      return y < 0.5 ? "block-start" : "block-end";
    };
    for (const [width, height] of [
      [900, 300],
      [300, 900],
      [600, 400],
    ]) {
      for (const group of [false, true]) {
        const bounds = { ...rect, inlineSize: width ?? 600, blockSize: height ?? 400 };
        const area = createEditorDropArea(bounds, undefined, group ? 0.3 : 0.1, group);
        for (let ix = 0; ix < 50; ix += 1) {
          for (let iy = 0; iy < 50; iy += 1) {
            const x = (ix + 0.5) / 50;
            const y = (iy + 0.5) / 50;
            expect(
              hitTestEditorDropArea(area, {
                inline: bounds.inlineStart + bounds.inlineSize * x,
                block: bounds.blockStart + bounds.blockSize * y,
              }),
            ).toBe(upstream(x, y, group));
          }
        }
      }
    }
  });

  it("uses the content below tabs for top-edge activation", () => {
    const area = createEditorDropArea(rect, {
      contentRect: { ...rect, blockStart: 90, blockSize: 360 },
      headerRects: [{ ...rect, blockSize: 40 }],
    });
    expect(hitTestEditorDropArea(area, { inline: 400, block: 55 })).toBe("center");
    expect(hitTestEditorDropArea(area, { inline: 400, block: 95 })).toBe("block-start");
    expect(hitTestEditorDropArea(area, { inline: 105, block: 60 })).toBe("center");
  });

  it("treats vertical and portaled tab strips as center targets", () => {
    const area = createEditorDropArea(rect, {
      contentRect: { ...rect, inlineStart: 150, inlineSize: 550 },
      headerRects: [
        { ...rect, inlineSize: 50 },
        { ...rect, blockStart: 10, blockSize: 40 },
      ],
    });
    expect(hitTestEditorDropArea(area, { inline: 110, block: 200 })).toBe("center");
    expect(hitTestEditorDropArea(area, { inline: 110, block: 20 })).toBe("center");
    expect(hitTestEditorDropArea(area, { inline: 155, block: 200 })).toBe("inline-start");
  });

  it("keeps group borders in the edge target instead of switching to a merge", () => {
    const area = createEditorDropArea(rect, {
      contentRect: { inlineStart: 101, blockStart: 91, inlineSize: 598, blockSize: 358 },
      headerRects: [{ ...rect, blockSize: 40 }],
    });
    expect(hitTestEditorDropArea(area, { inline: 100.5, block: 200 })).toBe("inline-start");
    expect(hitTestEditorDropArea(area, { inline: 699.999, block: 200 })).toBe("inline-end");
    expect(hitTestEditorDropArea(area, { inline: 400, block: 90.5 })).toBe("block-start");
    expect(hitTestEditorDropArea(area, { inline: 400, block: 449.999 })).toBe("block-end");
    expect(hitTestEditorDropArea(area, { inline: 100.5, block: 60 })).toBe("center");
  });

  it("does not acquire outside the view or with invalid pointer coordinates", () => {
    const area = createEditorDropArea(rect, undefined);
    for (const point of [
      { inline: 99, block: 100 },
      { inline: 700, block: 100 },
      { inline: 200, block: 450 },
      { inline: Number.NaN, block: 200 },
    ])
      expect(hitTestEditorDropArea(area, point)).toBeUndefined();
  });
});
