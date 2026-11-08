import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1600, height: 1000 } });

const interruptions = ["blur", "pagehide", "hidden"] as const;
type Interruption = (typeof interruptions)[number];

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected a visible element");
  return box;
}

async function revisionOf(page: Page) {
  return Number(
    await page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision"),
  );
}

async function prepare(page: Page, previewMode: "live" | "separator" = "live") {
  await page.addInitScript(() => {
    localStorage.setItem("panefold.atlas.view.v1", JSON.stringify({ motion: "off" }));
  });
  await page.goto("/?fixture=code");
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page.getByRole("combobox", { name: "Resize preview" }).selectOption(previewMode);
  await page.getByRole("button", { name: "Close appearance settings" }).click();
  await page.addStyleTag({
    content:
      ".pf-workspace { flex: 0 0 auto !important; inline-size: 1100px !important; block-size: 640px !important; min-block-size: 640px !important; }",
  });
  const workspace = page.getByLabel("Panefold Code workbench", { exact: true });
  await expect(workspace).toHaveCSS("width", "1100px");
  await expect(workspace).toHaveCSS("height", "640px");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  return workspace;
}

async function interrupt(page: Page, reason: Interruption) {
  // Dispatch lifecycle events explicitly: headless focus emulation does not
  // reliably change when another tab is brought to the front. Pointer input,
  // capture, layout, and the final release still use the real browser.
  await page.evaluate((reason) => {
    if (reason === "pagehide") {
      const event = new PageTransitionEvent("pagehide", { bubbles: true, cancelable: true });
      // HTML dispatches native pagehide at Window with Document as its target.
      Object.defineProperty(event, "target", { value: document });
      window.dispatchEvent(event);
      return;
    }
    if (reason !== "hidden") {
      window.dispatchEvent(new Event(reason));
      return;
    }
    const originals = ["visibilityState", "hidden"].map((key) => ({
      key,
      descriptor: Object.getOwnPropertyDescriptor(document, key),
    }));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      for (const { key, descriptor } of originals) {
        if (descriptor === undefined) Reflect.deleteProperty(document, key);
        else Object.defineProperty(document, key, descriptor);
      }
    }
  }, reason);
}

async function startDrag(page: Page, handle: Locator, dx: number, dy: number) {
  await handle.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) =>
        element.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId)),
      { once: true },
    );
  });
  const box = await boxOf(handle);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  const pointerId = await handle.getAttribute("data-test-pointer-id");
  expect(pointerId).toMatch(/^\d+$/u);
  return Number(pointerId);
}

for (const mode of ["live", "separator"] as const) {
  for (const reason of interruptions) {
    test(`${reason} cancels a ${mode} splitter preview without committing`, async ({ page }) => {
      const workspace = await prepare(page, mode);
      const splitter = workspace
        .locator('[data-workspace-splitter][aria-orientation="vertical"]')
        .first();
      const primary = splitter.locator("xpath=preceding-sibling::*[1]");
      const before = await boxOf(splitter);
      const primaryBefore = await boxOf(primary);
      const valueBefore = await splitter.getAttribute("aria-valuenow");
      const revision = await revisionOf(page);
      const marker = workspace.locator("[data-workspace-resize-preview]");

      const pointerId = await startDrag(page, splitter, 24, 0);
      await expect(splitter).toHaveAttribute("data-resize-state", "resizing");
      expect(
        await splitter.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
      ).toBe(true);
      if (mode === "separator") {
        await expect(marker).toBeVisible();
        expect(await boxOf(primary)).toEqual(primaryBefore);
      } else {
        await expect.poll(async () => (await boxOf(primary)).width).toBe(primaryBefore.width + 24);
        await expect.poll(() => splitter.getAttribute("aria-valuenow")).not.toBe(valueBefore);
      }
      expect(await revisionOf(page)).toBe(revision);

      await interrupt(page, reason);
      await expect(splitter).toHaveAttribute("data-resize-state", "idle");
      expect(
        await splitter.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
      ).toBe(false);
      await expect(marker).toBeHidden();
      expect(await boxOf(splitter)).toEqual(before);
      expect(await boxOf(primary)).toEqual(primaryBefore);
      expect(await splitter.getAttribute("aria-valuenow")).toBe(valueBefore);
      await page.mouse.up();
      expect(await revisionOf(page)).toBe(revision);

      await startDrag(page, splitter, 24, 0);
      await page.mouse.up();
      await expect.poll(() => revisionOf(page)).toBe(revision + 1);
      await expect.poll(async () => (await boxOf(primary)).width).toBe(primaryBefore.width + 24);
      await expect(splitter).toHaveAttribute("data-resize-state", "idle");
    });
  }
}

test("native pagehide restores a live splitter before leaving its document", async ({ page }) => {
  const workspace = await prepare(page);
  const splitter = workspace
    .locator('[data-workspace-splitter][aria-orientation="vertical"]')
    .first();
  const primary = splitter.locator("xpath=preceding-sibling::*[1]");
  const before = {
    splitter: await boxOf(splitter),
    primary: await boxOf(primary),
    value: await splitter.getAttribute("aria-valuenow"),
    revision: await revisionOf(page),
  };
  const pointerId = await startDrag(page, splitter, 24, 0);
  await expect(splitter).toHaveAttribute("data-resize-state", "resizing");
  await expect.poll(async () => (await boxOf(primary)).width).toBe(before.primary.width + 24);

  await splitter.evaluate((element, pointerId) => {
    const primary = element.previousElementSibling;
    const marker = element.ownerDocument.querySelector<HTMLElement>(
      "[data-workspace-resize-preview]",
    );
    if (primary === null || marker === null) throw new Error("Missing navigation fixture");
    const rectOf = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    let entryState: string | null = null;
    // Observe both phases: a browser may deliver blur or capture loss before
    // pagehide. The synthetic Document-target cases above isolate its handler.
    window.addEventListener(
      "pagehide",
      () => {
        entryState = element.getAttribute("data-resize-state");
      },
      { capture: true, once: true },
    );
    // Registered after the application's pointer-start listener, so the
    // receipt observes cancellation before the old document disappears.
    window.addEventListener(
      "pagehide",
      (event) => {
        sessionStorage.setItem(
          "panefold.test.interruption-pagehide",
          JSON.stringify({
            entryState,
            trusted: event.isTrusted,
            documentTarget: event.target === document,
            windowListener: event.currentTarget === window,
            state: element.getAttribute("data-resize-state"),
            captured: element.hasPointerCapture(pointerId),
            markerHidden: marker.hidden,
            restored: {
              splitter: rectOf(element),
              primary: rectOf(primary),
              value: element.getAttribute("aria-valuenow"),
              revision: Number(
                document
                  .querySelector("[data-workspace-revision]")
                  ?.getAttribute("data-workspace-revision"),
              ),
            },
          }),
        );
      },
      { once: true },
    );
  }, pointerId);
  await page.route("**/gesture-interruption-destination", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Navigation completed</title>",
    }),
  );
  await page.goto("/gesture-interruption-destination");
  const receipt = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("panefold.test.interruption-pagehide") ?? "null"),
  );
  expect(receipt).toEqual({
    entryState: expect.stringMatching(/^(resizing|idle)$/u),
    trusted: true,
    documentTarget: true,
    windowListener: true,
    state: "idle",
    captured: false,
    markerHidden: true,
    restored: before,
  });
  await page.mouse.up();
});

for (const mode of ["move", "resize"] as const) {
  test(`window interruptions restore a floating ${mode} and allow a fresh gesture`, async ({
    page,
  }) => {
    await prepare(page);
    await page.getByRole("tab", { name: "workspace.ts" }).click();
    await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
    await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();
    const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
    const handle = frame.locator(
      mode === "move" ? ".pf-floating-header-drag-region" : '[data-resize-edge="bottom-right"]',
    );
    const before = await boxOf(frame);
    const revision = await revisionOf(page);
    const changedAxis = mode === "move" ? "x" : "width";

    for (const reason of interruptions) {
      const pointerId = await startDrag(page, handle, 24, 16);
      await expect(frame).toHaveAttribute("data-floating-manipulation", "manipulating");
      expect(await handle.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(
        true,
      );
      await expect
        .poll(async () => (await boxOf(frame))[changedAxis])
        .toBe(before[changedAxis] + 24);
      expect(await revisionOf(page)).toBe(revision);
      await interrupt(page, reason);
      await expect(frame).toHaveAttribute("data-floating-manipulation", "idle");
      expect(await handle.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(
        false,
      );
      expect(await boxOf(frame)).toEqual(before);
      await page.mouse.up();
      expect(await revisionOf(page)).toBe(revision);
    }

    await startDrag(page, handle, 24, 16);
    await page.mouse.up();
    await expect.poll(() => revisionOf(page)).toBe(revision + 1);
    await expect.poll(async () => (await boxOf(frame))[changedAxis]).toBe(before[changedAxis] + 24);
    await expect(frame).toHaveAttribute("data-floating-manipulation", "idle");
  });
}
