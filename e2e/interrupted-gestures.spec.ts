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
  test(`claimed and composing Escape preserve a ${mode} splitter drag`, async ({ page }) => {
    const workspace = await prepare(page, mode);
    const splitter = workspace
      .locator('[data-workspace-splitter][aria-orientation="vertical"]')
      .first();
    const primary = splitter.locator("xpath=preceding-sibling::*[1]");
    const marker = workspace.locator("[data-workspace-resize-preview]");
    const before = await boxOf(primary);
    const valueBefore = await splitter.getAttribute("aria-valuenow");
    const revision = await revisionOf(page);
    const pointerId = await startDrag(page, splitter, 24, 0);
    await expect(splitter).toBeFocused();
    if (mode === "live") {
      await expect.poll(async () => (await boxOf(primary)).width).toBe(before.width + 24);
    } else {
      await expect(marker).toBeVisible();
    }
    const preview = await boxOf(primary);
    const previewValue = await splitter.getAttribute("aria-valuenow");
    const assertDragging = async () => {
      await expect(splitter).toHaveAttribute("data-resize-state", "resizing");
      expect(
        await splitter.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
      ).toBe(true);
      expect(await boxOf(primary)).toEqual(preview);
      expect(await splitter.getAttribute("aria-valuenow")).toBe(previewValue);
      expect(await marker.isVisible()).toBe(mode === "separator");
      expect(await revisionOf(page)).toBe(revision);
    };
    await assertDragging();

    await splitter.evaluate((element) => {
      element.addEventListener("keydown", (event) => event.preventDefault(), {
        capture: true,
        once: true,
      });
    });
    await page.keyboard.press("Escape");
    await assertDragging();
    // Exercise composition/modifier routing without invoking OS-level shortcuts.
    for (const flag of ["isComposing", "altKey", "ctrlKey", "metaKey"]) {
      const consumed = await splitter.evaluate((element, flag) => {
        const event = new KeyboardEvent("keydown", {
          key: "Escape",
          [flag]: true,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, flag);
      expect(consumed).toBe(false);
      await assertDragging();
    }

    await page.keyboard.press("Escape");
    await expect(splitter).toHaveAttribute("data-resize-state", "idle");
    expect(await splitter.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(
      false,
    );
    await expect(marker).toBeHidden();
    expect(await boxOf(primary)).toEqual(before);
    expect(await splitter.getAttribute("aria-valuenow")).toBe(valueBefore);
    await page.mouse.up();
    expect(await revisionOf(page)).toBe(revision);
    await expect(page.getByRole("button", { name: "Undo layout change" })).toBeDisabled();

    await startDrag(page, splitter, 24, 0);
    await page.mouse.up();
    await expect.poll(() => revisionOf(page)).toBe(revision + 1);
    await expect.poll(async () => (await boxOf(primary)).width).toBe(before.width + 24);
  });

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
    // The drag region starts movement through its titlebar's pointer handler.
    const captureOwner = mode === "move" ? frame.locator(".pf-floating-titlebar") : handle;
    const before = await boxOf(frame);
    const revision = await revisionOf(page);
    const changedAxis = mode === "move" ? "x" : "width";

    for (const reason of interruptions) {
      const pointerId = await startDrag(page, handle, 24, 16);
      await expect(frame).toHaveAttribute("data-floating-manipulation", "manipulating");
      expect(
        await captureOwner.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
      ).toBe(true);
      await expect
        .poll(async () => (await boxOf(frame))[changedAxis])
        .toBe(before[changedAxis] + 24);
      expect(await revisionOf(page)).toBe(revision);
      await interrupt(page, reason);
      await expect(frame).toHaveAttribute("data-floating-manipulation", "idle");
      expect(
        await captureOwner.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
      ).toBe(false);
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

async function floatingEditor(page: Page) {
  await prepare(page);
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
  await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();
  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const editor = frame.getByRole("textbox", { name: "workspace.ts editor", exact: true });
  await expect(editor).toBeVisible();
  return { frame, editor };
}

for (const mode of ["move", "resize"] as const) {
  test(`Escape cancels a floating ${mode} with editor focus and leaves undo history intact`, async ({
    page,
  }) => {
    const { frame, editor } = await floatingEditor(page);
    const handle = frame.locator(
      mode === "move" ? ".pf-floating-header-drag-region" : '[data-resize-edge="bottom-right"]',
    );
    const captureOwner = mode === "move" ? frame.locator(".pf-floating-titlebar") : handle;
    const before = await boxOf(frame);
    const revision = await revisionOf(page);
    const changedAxis = mode === "move" ? "x" : "width";
    await editor.fill("Keep this editor content through cancellation and undo.");
    await editor.focus();

    const pointerId = await startDrag(page, handle, 24, 16);
    await expect(editor).toBeFocused();
    await expect(frame).toHaveAttribute("data-floating-manipulation", "manipulating");
    await expect.poll(async () => (await boxOf(frame))[changedAxis]).toBe(before[changedAxis] + 24);
    expect(
      await captureOwner.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
    ).toBe(true);
    expect(await revisionOf(page)).toBe(revision);

    await page.keyboard.press("Escape");
    await expect(frame).toHaveAttribute("data-floating-manipulation", "idle");
    expect(await boxOf(frame)).toEqual(before);
    await expect(editor).toBeFocused();
    expect(
      await captureOwner.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
    ).toBe(false);
    await page.mouse.up();
    expect(await revisionOf(page)).toBe(revision);

    await startDrag(page, handle, 24, 16);
    await page.mouse.up();
    await expect.poll(() => revisionOf(page)).toBe(revision + 1);
    await expect.poll(async () => (await boxOf(frame))[changedAxis]).toBe(before[changedAxis] + 24);
    await page.getByRole("button", { name: "Undo layout change", exact: true }).click();
    await expect.poll(() => boxOf(frame)).toEqual(before);
    // The next undo reverses the original float, not an abandoned drag.
    await page.getByRole("button", { name: "Undo layout change", exact: true }).click();
    await expect(frame).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "workspace.ts editor", exact: true }),
    ).toHaveValue("Keep this editor content through cancellation and undo.");
  });

  test(`floating keyboard ${mode} preserves shortcuts and cannot compete with a pointer gesture`, async ({
    page,
  }) => {
    const { frame } = await floatingEditor(page);
    const control = frame.locator(
      mode === "move" ? ".pf-floating-titlebar" : '[data-resize-edge="right"]',
    );
    const dragHandle = mode === "move" ? frame.locator(".pf-floating-header-drag-region") : control;
    const before = await boxOf(frame);
    const revision = await revisionOf(page);
    const changedAxis = mode === "move" ? "x" : "width";
    await control.focus();
    await control.evaluate((element) => {
      element.ownerDocument.defaultView?.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight")
          element.setAttribute("data-test-default-prevented", String(event.defaultPrevented));
      });
    });
    for (const chord of ["Alt+ArrowRight", "Control+ArrowRight", "Meta+ArrowRight"]) {
      await control.evaluate((element) => element.removeAttribute("data-test-default-prevented"));
      await page.keyboard.press(chord);
      expect(await boxOf(frame)).toEqual(before);
      expect(await revisionOf(page)).toBe(revision);
      await expect(control).toHaveAttribute("data-test-default-prevented", "false");
    }

    // A host shortcut and an IME event must not reach the layout command path.
    await control.evaluate((element) => {
      element.addEventListener("keydown", (event) => event.preventDefault(), {
        capture: true,
        once: true,
      });
    });
    await page.keyboard.press("ArrowRight");
    await control.dispatchEvent("keydown", { key: "ArrowRight", isComposing: true });
    expect(await boxOf(frame)).toEqual(before);
    expect(await revisionOf(page)).toBe(revision);

    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await boxOf(frame))[changedAxis]).toBe(before[changedAxis] + 8);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await boxOf(frame))[changedAxis]).toBe(before[changedAxis] + 40);
    await expect.poll(() => revisionOf(page)).toBe(revision + 2);
    const committed = await boxOf(frame);

    await startDrag(page, dragHandle, 24, 0);
    await expect(control).toBeFocused();
    await expect
      .poll(async () => (await boxOf(frame))[changedAxis])
      .toBe(committed[changedAxis] + 24);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    expect(await revisionOf(page)).toBe(revision + 2);
    await expect(frame).toHaveAttribute("data-floating-manipulation", "manipulating");
    await page.keyboard.press("Escape");
    expect(await boxOf(frame)).toEqual(committed);
    await page.mouse.up();
    expect(await revisionOf(page)).toBe(revision + 2);
  });
}

test("floating Escape respects an editor's claimed event and text composition", async ({
  page,
}) => {
  const { frame, editor } = await floatingEditor(page);
  const before = await boxOf(frame);
  const revision = await revisionOf(page);
  await editor.focus();
  await startDrag(page, frame.locator(".pf-floating-header-drag-region"), 24, 16);
  await expect.poll(async () => (await boxOf(frame)).x).toBe(before.x + 24);
  await editor.evaluate((element) => {
    element.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  });
  await page.keyboard.press("Escape");
  await editor.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(frame).toHaveAttribute("data-floating-manipulation", "manipulating");
  expect((await boxOf(frame)).x).toBe(before.x + 24);
  expect(await revisionOf(page)).toBe(revision);

  await page.keyboard.press("Escape");
  await expect(frame).toHaveAttribute("data-floating-manipulation", "idle");
  expect(await boxOf(frame)).toEqual(before);
  await expect(editor).toBeFocused();
  await page.mouse.up();
  expect(await revisionOf(page)).toBe(revision);
});
