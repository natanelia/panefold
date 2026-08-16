import { describe, expect, it } from "vitest";

import { resolveGroupHeaderPresentation, tabOrientation } from "../src/tab-presentation";

describe("group header presentation", () => {
  it("preserves docked logical tab placement", () => {
    const presentation = { placement: "inline-end", content: "icon-only" } as const;

    expect(
      resolveGroupHeaderPresentation(presentation, { floating: false, panelCount: 1 }),
    ).toEqual({
      ...presentation,
      location: "docked",
      variant: "tabs",
      orientation: "vertical",
    });
    expect(tabOrientation(presentation)).toBe("vertical");
  });

  it("integrates multiple floating tabs into a horizontal titlebar", () => {
    expect(
      resolveGroupHeaderPresentation(
        { placement: "inline-start", content: "label-only" },
        { floating: true, panelCount: 3 },
      ),
    ).toEqual({
      placement: "block-start",
      content: "label-only",
      location: "floating",
      variant: "tabs",
      orientation: "horizontal",
    });
  });

  it("presents one floating tab as a title while retaining the tab element", () => {
    expect(
      resolveGroupHeaderPresentation(
        { placement: "inline-start", content: "icon-only" },
        { floating: true, panelCount: 1 },
      ),
    ).toEqual({
      placement: "block-start",
      content: "icon-and-label",
      location: "floating",
      variant: "title",
      orientation: "horizontal",
    });
  });
});
