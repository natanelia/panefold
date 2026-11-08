import { expect, test, type Locator, type Page } from "@playwright/test";

const scales = [
  { name: "unscaled", css: "" },
  { name: "scale 0.75", css: "transform: scale(0.75)" },
  { name: "scale 1.5", css: "transform: scale(1.5)" },
  { name: "nonuniform scale", css: "transform: scale(1.5, 0.75)" },
  { name: "zoom 0.75", css: "zoom: 0.75" },
  { name: "zoom 1.5", css: "zoom: 1.5" },
] as const;

test.use({ viewport: { width: 2100, height: 1400 } });

function workspaceStyles(css: string) {
  // Keep both RTL and LTR fixtures on screen: transforms do not reserve their
  // enlarged visual width in the demo's grid, unlike CSS zoom.
  return `.pf-workspace { position: fixed !important; inset: 80px auto auto 48px !important; z-index: 1000 !important; inline-size: 1100px !important; block-size: 640px !important; transform-origin: 0 0; ${css} }`;
}

async function prepare(page: Page, css: string, direction: "ltr" | "rtl" = "ltr", observe = true) {
  await page.addInitScript((direction) => {
    localStorage.setItem("panefold.atlas.view.v1", JSON.stringify({ direction, motion: "off" }));
  }, direction);
  if (!observe) {
    await page.addInitScript(() => {
      Object.defineProperty(window, "ResizeObserver", { configurable: true, value: undefined });
    });
    await page.route("**/?fixture=code", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          "<head>",
          `<head><style>${workspaceStyles(css)}</style>`,
        ),
      });
    });
  }
  await page.goto("/?fixture=code");
  await page.addStyleTag({ content: workspaceStyles(css) });
  const workspace = page.getByLabel("Panefold Code workbench");
  await expect(workspace).toHaveAttribute("dir", direction);
  await expect(workspace).toHaveCSS("width", "1100px");
  // ResizeObserver delivers the unscaled content size before the second paint.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  return workspace;
}

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

async function expectScreenDelta(
  locator: Locator,
  before: Awaited<ReturnType<typeof boxOf>>,
  key: "x" | "y" | "width" | "height",
  delta: number,
) {
  await expect
    .poll(async () => Math.abs((await boxOf(locator))[key] - before[key] - delta))
    .toBeLessThan(2);
}

for (const scale of scales) {
  for (const direction of ["ltr", "rtl"] as const) {
    test(`${scale.name}: splitters follow the pointer on both axes in ${direction}`, async ({
      page,
    }) => {
      const workspace = await prepare(page, scale.css, direction);

      for (const orientation of ["vertical", "horizontal"] as const) {
        const splitter = workspace
          .locator(`[role="separator"][aria-orientation="${orientation}"]`)
          .first();
        const before = await boxOf(splitter);
        const revision = await revisionOf(page);
        const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
        const key = orientation === "vertical" ? "x" : "y";
        const end = { ...start, [key]: start[key] + 24 };

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 4 });
        await expectScreenDelta(splitter, before, key, 24);
        expect(await revisionOf(page)).toBe(revision);
        await page.mouse.up();
        await expectScreenDelta(splitter, before, key, 24);
        await expect.poll(() => revisionOf(page)).toBe(revision + 1);
      }
    });
  }

  test(`${scale.name}: floating movement and corner resize follow the pointer`, async ({
    page,
  }) => {
    await prepare(page, scale.css);
    await page.getByRole("tab", { name: "workspace.ts" }).click();
    const editor = page.locator('[data-workspace-panel-host="notes"]').getByRole("textbox");
    await editor.fill("Retained through scaled gestures.");
    await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
    await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();

    const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
    const moveHandle = frame.locator(".pf-floating-header-drag-region");
    const beforeMove = await boxOf(frame);
    const handle = await boxOf(moveHandle);
    const revision = await revisionOf(page);
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 36, { steps: 4 });
    await expectScreenDelta(frame, beforeMove, "x", 60);
    await expectScreenDelta(frame, beforeMove, "y", 36);
    expect(await revisionOf(page)).toBe(revision);
    await page.mouse.up();
    await expectScreenDelta(frame, beforeMove, "x", 60);
    await expectScreenDelta(frame, beforeMove, "y", 36);
    await expect.poll(() => revisionOf(page)).toBe(revision + 1);

    const beforeResize = await boxOf(frame);
    const corner = await boxOf(frame.locator('[data-resize-edge="bottom-right"]'));
    const resizeStart = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
    await page.mouse.move(resizeStart.x, resizeStart.y);
    await page.mouse.down();
    await page.mouse.move(resizeStart.x + 36, resizeStart.y + 24, { steps: 4 });
    await expectScreenDelta(frame, beforeResize, "width", 36);
    await expectScreenDelta(frame, beforeResize, "height", 24);
    expect(await revisionOf(page)).toBe(revision + 1);
    await page.mouse.up();
    await expectScreenDelta(frame, beforeResize, "width", 36);
    await expectScreenDelta(frame, beforeResize, "height", 24);
    await expect.poll(() => revisionOf(page)).toBe(revision + 2);
    await expect(editor).toHaveValue("Retained through scaled gestures.");
  });
}

for (const css of ["transform: scale(0.75)", "zoom: 1.5"]) {
  test(`initial layout uses CSS pixels without ResizeObserver (${css})`, async ({ page }) => {
    const workspace = await prepare(page, css, "ltr", false);
    const split = workspace.locator('[data-workspace-split="root"]');
    await expect
      .poll(() =>
        split.evaluate((element) =>
          Array.from(element.children).reduce(
            (width, child) => width + (child as HTMLElement).offsetWidth,
            0,
          ),
        ),
      )
      .toBe(1100);
  });
}
