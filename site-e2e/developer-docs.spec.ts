import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("searches document body text and navigates to the matching guide", async ({
  page,
}, testInfo) => {
  await page.goto("./docs/");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("searchbox", { name: "Search documentation" });
  await expect(input).toBeFocused();
  await input.fill("zero-height");
  await expect(page.getByRole("status")).toContainText("matching");
  await page.locator('nav[aria-label="Documentation"] a[href$="/docs/react"]').click();
  await expect(page.getByRole("heading", { name: "React integration", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Give the surface space", exact: true }),
  ).toBeVisible();
  if (testInfo.project.name.includes("mobile")) await expect(input).not.toBeVisible();
  expect(await page.locator("#docs-search").count()).toBe(1);
});

test("opens every new guide on a direct static route, without horizontal overflow", async ({
  page,
  request,
}) => {
  for (const slug of [
    "overview",
    "quickstart",
    "mental-model",
    "react",
    "panels",
    "layouts",
    "tabs",
    "styling",
    "persistence",
    "windows",
    "production",
    "troubleshooting",
    "api",
  ]) {
    const response = await request.get(`./docs/${slug}/`);
    expect(response.ok(), slug).toBe(true);
    expect(await response.text(), slug).toContain(
      `https://natanelia.github.io/panefold/docs/${slug}/`,
    );
    await page.goto(`./docs/${slug}/`);
    await expect(page.locator("article h1"), slug).toBeVisible();
    await expect(page.locator(".docs-prose"), slug).not.toBeEmpty();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      slug,
    ).toBe(true);
  }
});

test("appearance controls update the exact props and respect keyboard input", async ({ page }) => {
  await page.goto("./#customize");
  const playground = page.locator(".tab-playground");
  await playground.getByRole("button", { name: "Start", exact: true }).focus();
  await page.keyboard.press("Enter");
  await playground.getByRole("button", { name: "Icons", exact: true }).click();
  await playground.getByRole("checkbox", { name: "Right-to-left" }).check();
  await expect(playground.locator(".rail-preview")).toHaveAttribute(
    "data-placement",
    "inline-start",
  );
  await expect(playground.locator(".rail-preview")).toHaveAttribute("dir", "rtl");
  await expect(playground.locator("pre")).toContainText('placement: "inline-start"');
  await expect(playground.locator("pre")).toContainText('content: "icon-only"');
  await expect(playground.locator("pre")).toContainText('direction="rtl"');
  await playground.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(playground.getByText("Keep the thought in view.")).toBeVisible();
});

test("reports a clipboard error without losing selectable source", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("Permission denied")) },
    });
  });
  await page.goto("./docs/quickstart/");
  await page.getByRole("button", { name: "Copy code", exact: true }).first().click();
  await expect(page.getByText("Copy failed. Select and copy the code manually.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Code copied" })).toHaveCount(0);
  await expect(page.locator("pre").first()).toContainText("pnpm install --frozen-lockfile");
});

test("starter uses live panels and preserves note state across tab presentation changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./workbench/?fixture=starter");
  await expect(page.getByRole("heading", { name: "Your first workspace." })).toBeVisible();
  const note = page.getByRole("textbox", { name: "Your note" });
  await note.fill("My component state stays with the panel.");
  await page.getByLabel("Tab rail", { exact: true }).selectOption("inline-start");
  await page.getByRole("checkbox", { name: "Icons only" }).check();
  await expect(note).toHaveValue("My component state stays with the panel.");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Keep the application yours." })).toBeVisible();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(note).toHaveValue("My component state stays with the panel.");
  await expect(page.getByRole("button", { name: "Undo layout" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo layout" }).click();
  await expect(page.getByRole("button", { name: "Redo layout" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("unknown routes fail explicitly instead of masquerading as the home page", async ({
  page,
}) => {
  await page.goto("./docs/not-a-real-document/");
  await expect(page.getByRole("heading", { name: "Document not found" })).toBeVisible();
  await page.goto("./not-a-real-page/");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("new docs index and guides have no automated WCAG A/AA violations", async ({ page }) => {
  for (const path of ["./docs/", "./docs/quickstart/", "./docs/tabs/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path !== "./docs/") await expect(page.locator(".docs-prose")).not.toBeEmpty();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations, path).toEqual([]);
  }
});
