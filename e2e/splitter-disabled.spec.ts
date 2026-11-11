import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1600, height: 1000 } });

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

async function setLocked(page: Page, locked: boolean) {
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page.getByRole("checkbox", { name: "Lock pane sizes" }).setChecked(locked);
  await page.getByRole("button", { name: "Close appearance settings" }).click();
}

for (const coarse of [false, true]) {
  test.describe(`${coarse ? "coarse" : "fine"} disabled dividers`, () => {
    test.use({ hasTouch: coarse });

    test("blocks resizing and releases the enlarged grab area", async ({ page }) => {
      const workspace = await prepare(page);
      const splitters = workspace.locator("[data-workspace-splitter]");
      await expect.poll(() => splitters.count()).toBeGreaterThan(1);
      const first = splitters.first();
      const before = await boxOf(first);
      const revision = await revisionOf(page);
      await first.evaluate((element) => {
        const pane = element.nextElementSibling;
        if (pane === null) throw new Error("Expected an adjacent pane");
        const button = document.createElement("button");
        button.textContent = "Adjacent pane control";
        Object.assign(button.style, {
          position: "absolute",
          left: "0",
          top: "50%",
          transform: "translateY(-50%)",
          width: "32px",
          height: "32px",
          zIndex: "3",
        });
        pane.append(button);
      });
      const nearby = { x: before.x + before.width + 2, y: before.y + before.height / 2 };
      const dividerAtPoint = () =>
        page.evaluate(
          ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".pf-splitter")),
          nearby,
        );
      expect(await dividerAtPoint()).toBe(true);
      await setLocked(page, true);

      for (const splitter of await splitters.all()) {
        await expect(splitter).toHaveAttribute("aria-disabled", "true");
        expect(await splitter.getAttribute("tabindex")).not.toBe("0");
        await expect(splitter).toHaveCSS("cursor", "default");
        await expect(splitter).toHaveCSS("touch-action", "auto");
        expect(
          await splitter.evaluate((element) => getComputedStyle(element, "::before").content),
        ).toBe("none");
      }

      // This point belongs to the adjacent pane, but an enabled divider's
      // expanded pseudo-element would intercept it on both pointer types.
      expect(await dividerAtPoint()).toBe(false);
      await page.mouse.click(nearby.x, nearby.y);
      const adjacentControl = workspace.getByRole("button", { name: "Adjacent pane control" });
      await expect(adjacentControl).toBeFocused();
      await adjacentControl.evaluate((element) => element.remove());

      const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 24, start.y, { steps: 3 });
      await page.mouse.up();
      await expect(first).not.toBeFocused();
      await expect(first).toHaveAttribute("data-resize-state", "idle");
      expect(await boxOf(first)).toEqual(before);
      expect(await revisionOf(page)).toBe(revision);

      // Check actual Tab navigation at a divider boundary, including nested splits.
      for (const splitter of await splitters.all()) {
        const precedingControl = splitter.locator("xpath=preceding-sibling::*[1]");
        await precedingControl.evaluate((element) => {
          const button = document.createElement("button");
          button.textContent = "Navigation probe";
          Object.assign(button.style, {
            position: "absolute",
            left: "12px",
            top: "40px",
            zIndex: "3",
          });
          element.append(button);
          button.focus();
        });
        await expect(
          precedingControl.getByRole("button", { name: "Navigation probe" }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(splitter).not.toBeFocused();
        await precedingControl
          .getByRole("button", { name: "Navigation probe" })
          .evaluate((e) => e.remove());
      }

      const input = workspace.getByRole("textbox", { name: "Terminal input", exact: true });
      await input.fill("pane content still works");
      await expect(input).toHaveValue("pane content still works");
      expect(await boxOf(first)).toEqual(before);
      // Focused tabs may activate their panels; the lock only restricts resizing.
      const revisionBeforeResize = await revisionOf(page);

      await setLocked(page, false);
      await expect(first).not.toHaveAttribute("aria-disabled", "true");
      await first.focus();
      await first.press("F6");
      await expect(splitters.nth(1)).toBeFocused();
      await first.press("ArrowRight");
      await expect.poll(() => revisionOf(page)).toBe(revisionBeforeResize + 1);
    });
  });
}

for (const mode of ["live", "separator"] as const) {
  test(`locking during a ${mode} drag rolls back before pointer release`, async ({ page }) => {
    const workspace = await prepare(page, mode);
    const splitter = workspace.locator("[data-workspace-splitter]").first();
    const primary = splitter.locator("xpath=preceding-sibling::*[1]");
    const marker = workspace.locator("[data-workspace-resize-preview]");
    const before = {
      splitter: await boxOf(splitter),
      primary: await boxOf(primary),
      value: await splitter.getAttribute("aria-valuenow"),
      revision: await revisionOf(page),
    };
    const start = {
      x: before.splitter.x + before.splitter.width / 2,
      y: before.splitter.y + before.splitter.height / 2,
    };
    await splitter.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        (event) =>
          element.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId)),
        { once: true },
      );
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 24, start.y, { steps: 4 });
    await expect(splitter).toHaveAttribute("data-resize-state", "resizing");
    await expect(splitter).toBeFocused();
    const pointerIdAttribute = await splitter.getAttribute("data-test-pointer-id");
    expect(pointerIdAttribute).toMatch(/^\d+$/);
    const pointerId = Number(pointerIdAttribute);
    expect(await splitter.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(
      true,
    );
    if (mode === "live") {
      await expect.poll(async () => (await boxOf(primary)).width).toBe(before.primary.width + 24);
    } else {
      await expect(marker).toBeVisible();
      expect(await boxOf(primary)).toEqual(before.primary);
    }

    // Change the real React prop through the demo controls without ending the
    // captured pointer gesture or moving focus away from its divider.
    await page
      .getByRole("button", { name: "Workspace appearance" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await page
      .getByRole("checkbox", { name: "Lock pane sizes" })
      .evaluate((e) => (e as HTMLInputElement).click());
    await expect(splitter).toHaveAttribute("aria-disabled", "true");
    await expect(splitter).toHaveAttribute("data-resize-state", "idle");
    await expect(splitter).toBeFocused();
    await expect(marker).toBeHidden();
    expect(await boxOf(splitter)).toEqual(before.splitter);
    expect(await boxOf(primary)).toEqual(before.primary);
    await expect(splitter).toHaveAttribute("aria-valuenow", before.value ?? "");
    expect(await splitter.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(
      false,
    );
    expect(await revisionOf(page)).toBe(before.revision);
    await expect(page.getByRole("button", { name: "Undo layout change" })).toBeDisabled();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("End");
    await page.keyboard.press("F6");
    await expect(splitter).toBeFocused();
    await page.mouse.move(start.x + 48, start.y);
    await page.mouse.up();
    expect(await revisionOf(page)).toBe(before.revision);
    expect(await boxOf(primary)).toEqual(before.primary);

    await page.getByRole("checkbox", { name: "Lock pane sizes" }).uncheck();
    await page.getByRole("button", { name: "Close appearance settings" }).click();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 24, start.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => revisionOf(page)).toBe(before.revision + 1);
    await expect.poll(async () => (await boxOf(primary)).width).toBe(before.primary.width + 24);
    await expect(marker).toBeHidden();
  });
}

test("locks nested floating dividers while keeping floating window controls available", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
  await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();
  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const header = await boxOf(frame.locator(".pf-floating-header-drag-region"));
  const start = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Actions for App.tsx" }).click();
  await page.getByRole("menuitem", { name: "Move to primary", exact: true }).click();
  await frame.getByRole("button", { name: "Actions for App.tsx" }).click();
  await frame.getByRole("menuitem", { name: "Split right", exact: true }).click();
  const splitter = frame.locator("[data-workspace-splitter]");
  await expect(splitter).toBeVisible();
  await setLocked(page, true);
  await expect(splitter).toHaveAttribute("aria-disabled", "true");

  const titlebar = frame.locator(".pf-floating-titlebar");
  const before = await boxOf(frame);
  const revision = await revisionOf(page);
  await titlebar.focus();
  await titlebar.press("ArrowUp");
  await expect.poll(() => revisionOf(page)).toBe(revision + 1);
  await expect.poll(async () => (await boxOf(frame)).y).toBe(before.y - 8);
  await expect(splitter).toHaveAttribute("aria-disabled", "true");
});
