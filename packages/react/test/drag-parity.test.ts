import { describe, expect, it } from "vitest";
import { createEditorDropArea, hitTestEditorDropArea } from "../src/drop-target";
import { splitEnabledForEvent } from "../src/drop-modifiers";

const bounds = { inlineStart: 0, blockStart: 0, inlineSize: 900, blockSize: 600 };

describe("VS Code split policy", () => {
  it.each(["Win32", "Linux x86_64", "MacIntel"])("uses the correct toggle on %s", (platform) => {
    const mac = platform === "MacIntel";
    const toggle = { altKey: !mac, shiftKey: mac };
    expect(splitEnabledForEvent(toggle, platform, undefined)).toBe(false);
    expect(splitEnabledForEvent(toggle, platform, { splitOnDragAndDrop: false })).toBe(true);
    expect(splitEnabledForEvent({ altKey: false, shiftKey: false }, platform, undefined)).toBe(
      true,
    );
    // The copy modifier must not accidentally become a split toggle.
    expect(splitEnabledForEvent({ altKey: mac, shiftKey: !mac }, platform, undefined)).toBe(true);
  });

  it("disabled splitting has no phantom one-pixel border targets", () => {
    const area = createEditorDropArea(bounds, undefined);
    for (const inline of [0, 1, 450, 899])
      for (const block of [0, 1, 300, 599]) {
        expect(hitTestEditorDropArea(area, { inline, block }, false)).toBe("center");
      }
    expect(hitTestEditorDropArea(area, { inline: -1, block: 0 }, false)).toBeUndefined();
  });

  it("matches the horizontal-split decision table for editors and groups", () => {
    for (const group of [false, true]) {
      const area = createEditorDropArea(bounds, undefined, group ? 0.3 : 0.1, group, {
        preferredSplitDirection: "down",
      });
      for (let ix = 0; ix < 40; ix++)
        for (let iy = 0; iy < 40; iy++) {
          const x = (ix + 0.5) / 40,
            y = (iy + 0.5) / 40;
          const edgeY = group ? 0.3 : 0.1;
          const expected =
            x > 0.1 && x < 0.9 && y > edgeY && y < 1 - edgeY
              ? "center"
              : y < 1 / 3
                ? "block-start"
                : y > 2 / 3
                  ? "block-end"
                  : x < 0.5
                    ? "inline-start"
                    : "inline-end";
          expect(hitTestEditorDropArea(area, { inline: x * 900, block: y * 600 })).toBe(expected);
        }
    }
  });
});
