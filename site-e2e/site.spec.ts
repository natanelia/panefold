import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("presents the product story and live reference fixture", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /Workspace state you can reason about/i }),
  ).toBeVisible();
  await expect(page.getByText("36", { exact: true })).toBeVisible();
  const embeddedFixture = page.getByTitle("Interactive Panefold Atlas map-operations demo");
  await expect(embeddedFixture).toBeVisible();
  await embeddedFixture.scrollIntoViewIfNeeded();
  await expect(
    page
      .frameLocator('iframe[title="Interactive Panefold Atlas map-operations demo"]')
      .getByLabel("Map operations workspace"),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("navigates the repository-backed documentation", async ({ page }) => {
  await page.goto("./docs");
  await expect(page.getByRole("heading", { name: /Understand the boundaries/i })).toBeVisible();
  await page.locator('main a.group[href$="/docs/architecture"]').click();
  await expect(page.getByRole("heading", { name: "Architecture", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Governing rule", exact: true })).toBeVisible();
});

test("normalizes static-host trailing-slash routes", async ({ page }) => {
  await page.goto("./docs/architecture/");
  await expect(page.getByRole("heading", { name: "Architecture", exact: true })).toBeVisible();
  await page.goto("./demo/");
  await expect(page.getByTitle("Panefold Atlas live workspace demo")).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Panefold Atlas live workspace demo"]')
      .getByLabel("Map operations workspace"),
  ).toBeVisible();
});

test("publishes the complete decision and marketing documentation", async ({ page }) => {
  await page.goto("./docs/adr-independent-oracle/");
  await expect(
    page.getByRole("heading", { name: "Independent semantic oracle", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ADR 0011", { exact: true })).toBeVisible();

  await page.goto("./docs/adr-protocol-motion-lifecycles/");
  await expect(
    page.getByRole("heading", { name: "Protocol and motion lifecycles", exact: true }),
  ).toBeVisible();

  await page.goto("./docs/marketing/");
  await expect(
    page.getByRole("heading", { name: "Marketing and launch", exact: true }),
  ).toBeVisible();
});

test("renders the complete system design with its original figures", async ({ page }) => {
  await page.goto("./docs/system-design/");
  await expect(page.getByRole("heading", { name: "System design", exact: true })).toBeVisible();
  await expect(page.locator(".docs-figure img")).toHaveCount(14);
  const firstFigure = page.locator(".docs-figure img").first();
  await firstFigure.scrollIntoViewIfNeeded();
  await expect
    .poll(() => firstFigure.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(() => firstFigure.evaluate((image) => image.getBoundingClientRect().height))
    .toBeGreaterThan(100);
  await expect(page.locator(".docs-prose blockquote").first()).not.toContainText("**");
  await expect(page.locator("#appendix-a-normative-requirement-register")).toHaveCount(1);
});

test("has no automated WCAG A/AA violations on the landing page", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "One desktop axe pass covers the same DOM projection",
  );
  await page.goto("./");
  await page.getByRole("heading", { name: /Workspace state you can reason about/i }).waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("has no automated WCAG A/AA violations in documentation", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "One desktop axe pass covers the same documentation projection",
  );
  await page.goto("./docs/architecture");
  await page.getByRole("heading", { name: "Governing rule", exact: true }).waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
