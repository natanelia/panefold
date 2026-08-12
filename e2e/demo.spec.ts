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
