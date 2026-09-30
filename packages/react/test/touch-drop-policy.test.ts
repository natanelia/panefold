import { describe, it, expect } from "vitest";
import { createEditorDropArea, hitTestEditorDropArea } from "../src/drop-target";
const rect = { inlineStart: 0, blockStart: 0, inlineSize: 300, blockSize: 300 };
describe("opt-in touch drop areas", () => {
  it("uses the outer third without changing the default narrow desktop edge", () => {
    const point = { inline: 70, block: 150 };
    expect(hitTestEditorDropArea(createEditorDropArea(rect, undefined), point)).toBe("center");
    expect(
      hitTestEditorDropArea(
        createEditorDropArea(rect, undefined, 0.1, false, { edgeBandRatio: 1 / 3 }),
        point,
      ),
    ).toBe("inline-start");
  });
  it("clamps malformed values and preserves a central tab target", () => {
    for (const value of [-1, 0, 0.2, 1 / 3, 4, NaN, Infinity]) {
      const area = createEditorDropArea(rect, undefined, 0.1, false, { edgeBandRatio: value });
      expect(area.inlineEdgeRatio).toBeGreaterThanOrEqual(0);
      expect(area.inlineEdgeRatio).toBeLessThanOrEqual(1 / 3);
      expect(hitTestEditorDropArea(area, { inline: 150, block: 150 })).toBe("center");
    }
  });
});
