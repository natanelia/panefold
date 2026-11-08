import { expect, test, type Locator, type Page } from "@playwright/test";

test("identifies the primary pane and lets Escape cancel a pointer resize", async ({ page }) => {
  await page.goto("/?fixture=starter");
  const workspace = page.getByLabel("Starter workspace", { exact: true });
  await expect(workspace).toHaveAttribute("data-geometry-mode", "model");
  const splitter = workspace.locator("[data-workspace-splitter]").first();
  const primaryId = await splitter.getAttribute("aria-controls");
  expect(primaryId).toBeTruthy();
  const primary = page.locator(`[id="${String(primaryId)}"]`);
  const readPrimaryWidth = async () => (await primary.boundingBox())?.width ?? 0;
  const before = await readPrimaryWidth();
  const followingWidth = await workspace
    .locator('[data-workspace-split-child="inspector-node"]')
    .evaluate((element) => element.getBoundingClientRect().width);
  const percent = Math.round((before / (before + followingWidth)) * 10_000) / 100;
  await expect(splitter).toHaveAttribute("aria-valuenow", String(percent));
  await primary.locator("textarea").focus();
  const box = await splitter.boundingBox();
  if (box === null) throw new Error("Expected a visible splitter");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(splitter).toBeFocused();
  await page.mouse.move(x + 40, y, { steps: 4 });
  await expect.poll(readPrimaryWidth).toBe(before + 40);
  await page.keyboard.press("Escape");
  await expect.poll(readPrimaryWidth).toBe(before);
  await expect(splitter).toHaveAttribute("aria-valuenow", String(percent));
  await page.mouse.up();
  await expect(splitter).toBeFocused();
});

test("F6 cycles keyboard focus through workspace dividers", async ({ page }) => {
  await page.goto("/?fixture=code");
  const workspace = page.getByLabel("Panefold Code workbench", { exact: true });
  const splitters = workspace.locator('[data-workspace-splitter]:not([aria-disabled="true"])');
  await expect.poll(() => splitters.count()).toBeGreaterThan(1);
  const first = splitters.first();
  const second = splitters.nth(1);
  const last = splitters.last();
  await first.focus();
  await first.press("F6");
  await expect(second).toBeFocused();
  await second.press("Shift+F6");
  await expect(first).toBeFocused();
  await first.press("Shift+F6");
  await expect(last).toBeFocused();
  await last.press("F6");
  await expect(first).toBeFocused();
});

for (const coarse of [false, true]) {
  test.describe(`${coarse ? "coarse" : "fine"} divider targets`, () => {
    test.use({ hasTouch: coarse });

    test("enlarges the grab area independently of the visible gutter", async ({ page }) => {
      await page.goto("/?fixture=starter");
      const workspace = page.getByLabel("Starter workspace", { exact: true });
      const splitter = workspace.locator("[data-workspace-splitter]").first();
      await expect(splitter).toBeVisible();
      expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(coarse);
      const targetWidth = () =>
        splitter.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element, "::before").width),
        );
      expect(await targetWidth()).toBe(coarse ? 44 : 24);

      await workspace.evaluate((element) => {
        const workspaceElement = element as HTMLElement;
        workspaceElement.style.setProperty("--pf-splitter-hit-target-fine", "32px");
        workspaceElement.style.setProperty("--pf-splitter-hit-target-coarse", "52px");
      });
      expect(await targetWidth()).toBe(coarse ? 52 : 32);
      const box = await splitter.boundingBox();
      if (box === null) throw new Error("Expected a visible splitter");
      expect(box.width).toBe(6);
      const start = { x: box.x + box.width / 2 + 12, y: box.y + box.height / 2 };
      expect(
        await page.evaluate(
          ({ x, y }) =>
            Boolean(document.elementFromPoint(x, y)?.closest("[data-workspace-splitter]")),
          start,
        ),
      ).toBe(true);
      const primary = workspace.locator('[data-workspace-split-child="primary-node"]');
      const before = (await primary.boundingBox())?.width ?? 0;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 40, start.y, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await primary.boundingBox())?.width ?? 0).toBe(before + 40);
      expect((await splitter.boundingBox())?.width).toBe(6);
    });
  });
}

test.describe("constrained divider shortcuts", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  for (const direction of ["ltr", "rtl"] as const) {
    for (const axis of ["inline", "block"] as const) {
      test(`Home and End reach the attainable ${axis} limits in ${direction}`, async ({ page }) => {
        const workspace = await prepareConstrainedWorkspace(page, direction);
        const split = workspace.locator(
          `[data-workspace-split="${axis === "inline" ? "root" : "center-stack"}"]`,
        );
        const splitter = split.locator(":scope > [data-workspace-splitter]").first();
        const size = axis === "inline" ? "width" : "height";
        const before = await childBoxes(split);
        expect(before).toHaveLength(axis === "inline" ? 3 : 2);
        const [primaryBefore, followingBefore] = before;
        if (primaryBefore === undefined || followingBefore === undefined) {
          throw new Error("Expected two adjacent panes");
        }
        const pairSize = primaryBefore[size] + followingBefore[size];
        // At 1100×640, this fixture's preferred sizes do not jointly fit. The
        // adjacent hard minima therefore determine its attainable endpoints.
        const minimum = axis === "inline" ? 180 : 220;
        const maximum = pairSize - (axis === "inline" ? 320 : 130);
        const expectedAt = (primarySize: number) =>
          before.map((box, index) =>
            index === 0 ? primarySize : index === 1 ? pairSize - primarySize : box[size],
          );
        const readSizes = async () => (await childBoxes(split)).map((box) => box[size]);
        const outside = workspace.locator(
          axis === "inline"
            ? '[data-workspace-split-child="inspector-node"]'
            : '[data-workspace-split-child="navigation-node"], [data-workspace-split-child="inspector-node"]',
        );
        const outsideBefore = await boxesOf(outside);
        const expectValue = async (primarySize: number) => {
          await expect(splitter).toHaveAttribute("aria-valuemin", percent(minimum, pairSize));
          await expect(splitter).toHaveAttribute("aria-valuemax", percent(maximum, pairSize));
          await expect(splitter).toHaveAttribute("aria-valuenow", percent(primarySize, pairSize));
        };

        await expectValue(primaryBefore[size]);
        const revision = await workspaceRevision(page);
        await splitter.focus();
        await splitter.press("Home");
        await expect.poll(readSizes).toEqual(expectedAt(minimum));
        await expect.poll(() => workspaceRevision(page)).toBe(revision + 1);
        await expectValue(minimum);
        await expect(splitter).toBeFocused();
        expect(await boxesOf(outside)).toEqual(outsideBefore);

        await splitter.press("End");
        await expect.poll(readSizes).toEqual(expectedAt(maximum));
        await expect.poll(() => workspaceRevision(page)).toBe(revision + 2);
        await expectValue(maximum);
        await expect(splitter).toBeFocused();
        expect(await boxesOf(outside)).toEqual(outsideBefore);

        await page.getByRole("button", { name: "Undo layout change", exact: true }).click();
        await expect.poll(readSizes).toEqual(expectedAt(minimum));
        await expectValue(minimum);
        await page.getByRole("button", { name: "Redo layout change", exact: true }).click();
        await expect.poll(readSizes).toEqual(expectedAt(maximum));
        await expectValue(maximum);
        await page.getByRole("button", { name: "Undo layout change", exact: true }).click();
        await page.getByRole("button", { name: "Undo layout change", exact: true }).click();
        await expect.poll(() => childBoxes(split)).toEqual(before);

        await splitter.press("Shift+Home");
        await expect.poll(readSizes).toEqual(expectedAt(minimum));
        await splitter.press("Shift+End");
        await expect.poll(readSizes).toEqual(expectedAt(maximum));
        await splitter.press("End");
        await expect.poll(readSizes).toEqual(expectedAt(maximum));
        await expectValue(maximum);
        expect(await boxesOf(outside)).toEqual(outsideBefore);
      });
    }

    test(`leaves browser modifier shortcuts unhandled in ${direction}`, async ({ page }) => {
      const workspace = await prepareConstrainedWorkspace(page, direction);
      const split = workspace.locator('[data-workspace-split="root"]');
      const splitter = split.locator(":scope > [data-workspace-splitter]").first();
      const before = await childBoxes(split);
      const revision = await workspaceRevision(page);
      await splitter.focus();
      const consumed = await splitter.evaluate((element) => {
        const results = [];
        for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
          for (const key of ["Home", "End", "ArrowLeft", "ArrowRight"]) {
            const event = new KeyboardEvent("keydown", {
              key,
              [modifier]: true,
              bubbles: true,
              cancelable: true,
            });
            element.dispatchEvent(event);
            if (event.defaultPrevented) results.push(`${modifier}+${key}`);
          }
        }
        return results;
      });
      expect(consumed).toEqual([]);
      expect(await workspaceRevision(page)).toBe(revision);
      expect(await childBoxes(split)).toEqual(before);
      await expect(splitter).toBeFocused();
    });
  }
});

async function prepareConstrainedWorkspace(page: Page, direction: "ltr" | "rtl") {
  await page.addInitScript((direction) => {
    localStorage.setItem("panefold.atlas.view.v1", JSON.stringify({ direction, motion: "off" }));
  }, direction);
  await page.goto("/?fixture=code");
  await page.addStyleTag({
    content: ".pf-workspace { inline-size: 1100px !important; block-size: 640px !important; }",
  });
  const workspace = page.getByLabel("Panefold Code workbench", { exact: true });
  await expect(workspace).toHaveAttribute("dir", direction);
  await expect(workspace).toHaveAttribute("data-geometry-mode", "model");
  const root = workspace.locator('[data-workspace-split="root"]');
  await expect
    .poll(async () => (await childBoxes(root)).reduce((total, box) => total + box.width, 12))
    .toBe(1100);
  const center = workspace.locator('[data-workspace-split="center-stack"]');
  await expect
    .poll(async () => (await childBoxes(center)).reduce((total, box) => total + box.height, 6))
    .toBe(640);
  return workspace;
}

async function childBoxes(split: Locator) {
  return boxesOf(split.locator(":scope > [data-workspace-split-child]"));
}

async function boxesOf(elements: Locator) {
  return elements.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

async function workspaceRevision(page: Page) {
  return Number(
    await page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision"),
  );
}

function percent(size: number, pairSize: number) {
  return String(Math.round((size / pairSize) * 10_000) / 100);
}
