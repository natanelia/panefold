import { expect, type CDPSession, type Locator, type Page } from "@playwright/test";

export async function visibleBox(locator: Locator) {
  const rect = await locator.boundingBox();
  if (rect === null) throw new Error("Expected visible touch geometry");
  return rect;
}

/** Browser input, not DOM dispatchEvent: this exercises touch-action, pointer
 * capture, native scrolling, browser cancellation and touch-generated clicks. */
export async function beginTouch(page: Page, handle: Locator) {
  await handle.scrollIntoViewIfNeeded();
  const rect = await visibleBox(handle);
  const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  return { cdp, from };
}

export async function moveTouch(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / 12,
          y: from.y + ((to.y - from.y) * step) / 12,
          id: 1,
        },
      ],
    });
    await page.waitForTimeout(20);
  }
}

export async function endTouch(cdp: CDPSession, cancel = false) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

export async function touchPanelDrop(
  page: Page,
  source: Locator,
  target: Locator,
  overlay: Locator,
  edge: "center" | "inline-start" | "inline-end" | "block-start" | "block-end",
) {
  const slot = target.locator(".pf-panel-slot");
  const rect = await visibleBox(slot);
  const rtl = await target.evaluate((element) => getComputedStyle(element).direction === "rtl");
  const to = {
    x:
      edge === "inline-start"
        ? rect.x + (rtl ? rect.width - 4 : 4)
        : edge === "inline-end"
          ? rect.x + (rtl ? 4 : rect.width - 4)
          : rect.x + rect.width / 2,
    y:
      edge === "block-start"
        ? rect.y + 4
        : edge === "block-end"
          ? rect.y + rect.height - 4
          : rect.y + rect.height / 2,
  };
  const { cdp, from } = await beginTouch(page, source.locator(".pf-tab-drag-handle"));
  try {
    await moveTouch(page, cdp, from, to);
    await expect(overlay).toHaveAttribute(
      "data-workspace-drop-kind",
      edge === "center" ? "center" : "edge",
    );
    if (edge !== "center") await expect(overlay).toHaveAttribute("data-workspace-drop-edge", edge);
    // Let the existing preview transition settle before comparing rectangles.
    await page.waitForTimeout(250);
    const preview = await visibleBox(overlay.locator(".pf-panel-drop-preview"));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return preview;
  } finally {
    await cdp.detach();
  }
}
