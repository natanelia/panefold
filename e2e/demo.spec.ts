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
