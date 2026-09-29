import type { Page, TestInfo } from "@playwright/test";

type AuditWindow = Window & { __panefoldAuditEvents?: Record<string, unknown>[] };

/** Wait for the initial font/layout pass, then observe real browser input.
 * The test still uses CDP touch events, not replacement DOM pointer events.
 */
export async function prepareNativeTouchAudit(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => {
    const entries: Record<string, unknown>[] = [];
    (window as AuditWindow).__panefoldAuditEvents = entries;
    for (const type of [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "gotpointercapture",
      "lostpointercapture",
      "blur",
      "resize",
      "scroll",
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const target = event.target;
          const workspace = document.querySelector<HTMLElement>(".tp-workspace");
          entries.push({
            type: event.type,
            time: event.timeStamp,
            target: target instanceof Element ? `${target.tagName}.${target.className}` : "window",
            touchAction:
              target instanceof Element ? getComputedStyle(target).touchAction : undefined,
            pointer:
              event instanceof PointerEvent
                ? {
                    id: event.pointerId,
                    kind: event.pointerType,
                    x: event.clientX,
                    y: event.clientY,
                  }
                : undefined,
            groupState: workspace?.dataset.groupDragState,
            panelState: workspace?.dataset.panelDragState,
            workspace: workspace?.getBoundingClientRect().toJSON(),
            focused: document.hasFocus(),
          });
          if (entries.length > 120) entries.shift();
        },
        { capture: true },
      );
    }
  });
}

export async function attachNativeTouchFailure(page: Page, info: TestInfo) {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const entries = await page.evaluate(() => (window as AuditWindow).__panefoldAuditEvents ?? []);
  await info.attach("native-touch-events", {
    body: JSON.stringify(entries, null, 2),
    contentType: "application/json",
  });
}
