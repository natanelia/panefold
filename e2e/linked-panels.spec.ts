import { expect, test } from "@playwright/test";

test("linked panels share selections, lock and catch up", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?fixture=linked");
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("road-1");
  await page.getByLabel("Map road", { exact: true }).selectOption("road-2");
  await expect(page.getByLabel("Table selected road", { exact: true })).toHaveText("road-2");
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("road-2");
  const lock = page.getByRole("button", { name: "Inspector lock selection", exact: true });
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Inspector road", { exact: true })).toBeDisabled();
  await page.getByLabel("Map road", { exact: true }).selectOption("road-3");
  await expect(page.getByLabel("Table selected road", { exact: true })).toHaveText("road-3");
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("road-2");
  await lock.click();
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("road-3");
  await expect(page.getByLabel("Inspector road", { exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("link groups isolate selections and adopt destination context", async ({ page }) => {
  await page.goto("/?fixture=linked");
  await page.getByLabel("Inspector link group", { exact: true }).selectOption("review-b");
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("None");
  await page.getByLabel("Map road", { exact: true }).selectOption("road-2");
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("None");
  await page.getByLabel("Inspector road", { exact: true }).selectOption("road-3");
  await expect(page.getByLabel("Map selected road", { exact: true })).toHaveText("road-2");
  await page.getByLabel("Inspector link group", { exact: true }).selectOption("review-a");
  await expect(page.getByLabel("Inspector selected road", { exact: true })).toHaveText("road-2");
});
