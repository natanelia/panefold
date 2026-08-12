import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("projects semantic commands through accessible workspace chrome", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Map operations workspace")).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(4);

  const mapTab = page.getByRole("tab", { name: "Map Canvas" });
  const notesTab = page.getByRole("tab", { name: "Notes" });
  await expect(mapTab).toHaveAttribute("aria-selected", "true");

  await mapTab.focus();
  await mapTab.press("ArrowRight");
  await expect(notesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Active: Notes")).toBeVisible();

  await page.getByRole("button", { name: "Close Notes" }).click();
  await expect(notesTab).toHaveCount(0);
  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(page.getByRole("tab", { name: "Notes" })).toBeVisible();

  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toHaveCount(0);
});

test("has no automated WCAG A/AA violations in the initial projection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Map operations workspace")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("uses solved geometry for keyboard resize in LTR and RTL", async ({ page }) => {
  await page.goto("/");
  const workspace = page.getByLabel("Map operations workspace");
  await expect(workspace).toHaveAttribute("data-geometry-mode", "model");
  await expect(workspace).toHaveAttribute("data-geometry-diagnostics", "0");

  const splitter = page.getByRole("separator").first();
  const initial = Number(await splitter.getAttribute("aria-valuenow"));
  await splitter.focus();
  await splitter.press("Shift+ArrowRight");
  await expect(page.getByText("Revision 1")).toBeVisible();
  await expect
    .poll(async () => Number(await splitter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(initial);

  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page
    .getByRole("dialog", { name: "Workspace appearance" })
    .getByRole("combobox", { name: "Direction", exact: true })
    .selectOption("rtl");
  await expect(workspace).toHaveAttribute("dir", "rtl");
  const rtlInitial = Number(await splitter.getAttribute("aria-valuenow"));
  await splitter.focus();
  await splitter.press("Shift+ArrowRight");
  await expect(page.getByText("Revision 2")).toBeVisible();
  await expect
    .poll(async () => Number(await splitter.getAttribute("aria-valuenow")))
    .toBeLessThan(rtlInitial);
});

test("honors OS and explicit motion preferences without remounting panel hosts", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const workspace = page.getByLabel("Map operations workspace");
  await expect(workspace).toHaveAttribute("data-effective-motion", "reduced");

  const mapHost = page.locator('[data-workspace-panel-host="map-canvas"]');
  const originalHostId = await mapHost.getAttribute("id");
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("tab", { name: "Map Canvas" }).click();
  await expect(mapHost).toHaveAttribute("id", originalHostId ?? "");
  await expect(mapHost).toHaveAttribute("data-lifecycle", "active");

  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page.getByLabel("Off").check();
  await expect(workspace).toHaveAttribute("data-effective-motion", "off");
});

test("pauses and resumes expensive panel work without remounting its stable host", async ({
  page,
}) => {
  await page.goto("/");
  const host = page.locator('[data-workspace-panel-host="map-canvas"]');
  const work = host.locator('[aria-label="Map render work units"]');
  await expect.poll(async () => Number(await work.textContent())).toBeGreaterThan(2);
  const hostId = await host.getAttribute("id");

  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(host).toHaveAttribute("data-lifecycle", "suspended");
  const paused = Number(await work.textContent());
  await page.waitForTimeout(120);
  expect(Number(await work.textContent())).toBe(paused);

  await page.getByRole("tab", { name: "Map Canvas" }).click();
  await expect(host).toHaveAttribute("id", hostId ?? "");
  await expect(host).toHaveAttribute("data-lifecycle", "active");
  await expect.poll(async () => Number(await work.textContent())).toBeGreaterThan(paused);
});

test("runs all normative heavy-content fixture classes in a real browser lifecycle", async ({
  page,
}) => {
  await page.goto("/?fixture=heavy");
  const host = page.locator('[data-workspace-panel-host="map-canvas"]');
  const lab = host.locator("[data-heavy-fixture-lifecycle]");
  await expect(lab).toBeVisible();
  const fixtures = lab.locator("[data-test-panel-fixture]");
  await expect(fixtures).toHaveCount(17);
  expect(
    await fixtures.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-test-panel-fixture")),
    ),
  ).toEqual([
    "plain-form",
    "uncontrolled-form",
    "code-editor",
    "webgl-map",
    "canvas",
    "data-grid",
    "video",
    "same-origin-iframe",
    "cross-origin-iframe",
    "web-component",
    "microfrontend",
    "async-close-guard",
    "suspendable",
    "corrupt-checkpoint",
    "throwing-renderer",
    "slow-resize-consumer",
    "missing-plugin-placeholder",
  ]);

  const hostId = await host.getAttribute("id");
  const mountToken = await lab.getAttribute("data-heavy-mount-token");
  const webComponentToken = await host
    .locator("panefold-heavy-fixture")
    .getAttribute("data-instance-token");
  const editor = lab.getByRole("textbox", { name: "Code editor fixture" });
  await editor.fill("const preserved = true;");
  await expect(lab.getByLabel("GPU map fixture")).toHaveAttribute(
    "data-renderer",
    /^(webgl2|canvas-2d)$/,
  );
  await expect(lab.getByTitle("Same-origin fixture").contentFrame().getByRole("button")).toHaveText(
    "Frame action",
  );
  await expect(lab.getByTitle("Opaque-origin fixture")).toBeVisible();
  await expect(
    lab.locator("panefold-heavy-fixture").evaluate((element) => element.shadowRoot?.textContent),
  ).resolves.toBe("Shadow-root workspace probe");
  await expect(
    lab
      .getByLabel("Isolated microfrontend root")
      .evaluate((element) => element.shadowRoot?.querySelector("input")?.value),
  ).resolves.toBe("isolated application state");
  const work = lab.locator('[aria-label="Heavy fixture work units"]');
  await expect.poll(async () => Number(await work.textContent())).toBeGreaterThan(2);

  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(host).toHaveAttribute("data-lifecycle", "suspended");
  const paused = Number(await work.textContent());
  await page.waitForTimeout(120);
  expect(Number(await work.textContent())).toBe(paused);
  await expect(host.getByLabel("Video fixture")).toHaveAttribute("data-suspended", "");

  await page.getByRole("tab", { name: "Map Canvas" }).click();
  await expect(host).toHaveAttribute("id", hostId ?? "");
  await expect(lab).toHaveAttribute("data-heavy-mount-token", mountToken ?? "");
  await expect(editor).toHaveValue("const preserved = true;");
  await expect(host.locator("panefold-heavy-fixture")).toHaveAttribute(
    "data-instance-token",
    webComponentToken ?? "",
  );
  expect(
    Number(await host.locator("panefold-heavy-fixture").getAttribute("data-connect-count")),
  ).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => Number(await work.textContent())).toBeGreaterThan(paused);

  await host.getByRole("button", { name: "Throw renderer failure" }).click();
  await expect(host.getByRole("alert")).toContainText("Map Canvas could not be rendered");
  await expect(page.getByRole("tab", { name: "Map Canvas" })).toBeVisible();
  await host.getByRole("button", { name: "Retry" }).click();
  await expect(host.locator("[data-test-panel-fixture]")).toHaveCount(17);
  await expect(host).toHaveAttribute("id", hostId ?? "");
});

test("keeps dynamic settings usable with forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await expect(page.getByRole("dialog", { name: "Workspace appearance" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // Emulated forced colors replace authored colors with platform colors that
    // axe cannot resolve in headless Chromium. The ordinary-color profile
    // above remains responsible for automated contrast checks.
    .disableRules(["color-contrast"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("prepares, acknowledges, recovers, and intentionally closes a same-origin popup", async ({
  page,
}) => {
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open external surface fixture" }).click();
  const popup = await popupPromise;

  await expect(popup.getByRole("heading", { name: "Panefold external surface" })).toBeVisible();
  await expect(popup.locator("#panefold-surface-root")).toHaveAttribute(
    "data-panefold-ready",
    "true",
  );
  await expect(popup.locator('meta[name="panefold-workspace-id"]')).toHaveAttribute(
    "content",
    "atlas-demo",
  );
  await expect(page.locator(".demo-statusbar [role=status]")).toContainText(
    "External surface ready",
  );

  await popup.getByRole("button", { name: "Simulate unexpected surface loss" }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.locator(".demo-statusbar [role=status]")).toContainText(
    "External surface recovered",
  );
  await expect(page.getByLabel("Map operations workspace")).toBeVisible();

  const secondPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open external surface fixture" }).click();
  const secondPopup = await secondPopupPromise;
  await expect(secondPopup.locator("#panefold-surface-root")).toHaveAttribute(
    "data-panefold-ready",
    "true",
  );
  await secondPopup
    .getByRole("button", { name: "Close external fixture" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(() => secondPopup.isClosed()).toBe(true);
});

test.describe("compact touch projection", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("switches full-screen regions with coarse targets without mutating canonical topology", async ({
    page,
  }) => {
    await page.goto("/");
    const workspace = page.getByLabel("Map operations workspace");
    await expect(workspace).toHaveAttribute("data-responsive-projection", "single-region");
    const region = page.getByRole("combobox", { name: "Current workspace region" });
    await expect(region).toHaveValue("primary");
    await expect(page.getByRole("tab", { name: "Map Canvas" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Routes" })).toHaveCount(0);

    const before = await page
      .getByText(/^Revision \d+$/)
      .first()
      .textContent();
    await region.selectOption("navigation");
    await expect(page.getByRole("tab", { name: "Routes" })).toBeVisible();
    await page.getByRole("tab", { name: "Layers" }).tap();
    await expect(page.getByRole("tab", { name: "Layers" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const targetSize = await page
      .getByRole("tab", { name: "Layers" })
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(targetSize).toBeGreaterThanOrEqual(44);

    await region.selectOption("primary");
    await expect(page.getByRole("tab", { name: "Notes" })).toBeVisible();
    expect(
      await page
        .getByText(/^Revision \d+$/)
        .first()
        .textContent(),
    ).not.toBe(before);
    await expect(workspace.locator('[data-workspace-split="root"]')).toHaveCount(0);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
