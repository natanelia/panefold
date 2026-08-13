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
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
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
  await expect(
    page.getByRole("heading", { name: "Panefold Atlas live workspace demo" }),
  ).toBeAttached();
  const atlas = page.frameLocator('iframe[title="Panefold Atlas live workspace demo"]');
  await expect(
    atlas.getByRole("heading", { name: "Panefold Atlas map operations workspace" }),
  ).toBeAttached();
  await expect(atlas.getByRole("link", { name: "Panefold home" })).toHaveAttribute(
    "href",
    /\/panefold\/$/,
  );
});

test("publishes complete route and social metadata", async ({ page }) => {
  await page.goto("./docs/architecture/");

  await expect(page).toHaveTitle("Architecture — Panefold documentation");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://natanelia.github.io/panefold/docs/architecture/",
  );
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "Panefold",
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute(
    "content",
    "Panefold workspace runtime shown as a three-pane Atlas map workspace",
  );
  const structuredData = page.locator('script[type="application/ld+json"]');
  await expect(structuredData).toHaveCount(1);
  expect(JSON.parse((await structuredData.textContent()) ?? "{}")).toMatchObject({
    "@type": "SoftwareSourceCode",
    name: "Panefold",
    codeRepository: "https://github.com/natanelia/panefold",
  });
});

test("keeps the standalone Atlas fixture out of search while sharing the demo route", async ({
  request,
}) => {
  const response = await request.get("./atlas/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<meta name="robots" content="noindex,follow"');
  expect(html).toContain('<link rel="canonical" href="https://natanelia.github.io/panefold/demo/"');
  expect(html).toContain(
    '<meta property="og:url" content="https://natanelia.github.io/panefold/demo/"',
  );
});

test("publishes every documentation route in the sitemap", async ({ page, request }) => {
  await page.goto("./docs/");
  const documentationLinks = page
    // The same source-backed sidebar is intentionally CSS-hidden behind the
    // mobile Browse button. Query its routes directly so this synchronization
    // assertion has identical coverage in both Playwright projects.
    .locator('nav[aria-label="Documentation"] a[href]');
  await expect.poll(() => documentationLinks.count()).toBeGreaterThan(1);
  const documentationPaths = await documentationLinks.evaluateAll((links) =>
    Array.from(new Set(links.map((link) => new URL((link as HTMLAnchorElement).href).pathname))),
  );
  expect(documentationPaths.length).toBeGreaterThan(1);

  const response = await request.get("./sitemap.xml");
  expect(response.ok()).toBe(true);
  const sitemap = await response.text();
  const locations = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
  for (const path of documentationPaths) {
    const canonicalPath = path.endsWith("/") ? path : `${path}/`;
    expect(locations, canonicalPath).toContain(`https://natanelia.github.io${canonicalPath}`);
  }
});

test("publishes the complete decision and marketing documentation", async ({ page }) => {
  await page.goto("./docs/design-audit/");
  await expect(
    page.getByRole("heading", { name: "System-design audit", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Both profiles", { exact: true })).toBeVisible();

  await page.goto("./docs/adr-independent-oracle/");
  await expect(
    page.getByRole("heading", { name: "Independent semantic oracle", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ADR 0011", { exact: true })).toBeVisible();

  await page.goto("./docs/adr-protocol-motion-lifecycles/");
  await expect(
    page.getByRole("heading", { name: "Protocol and motion lifecycles", exact: true }),
  ).toBeVisible();

  await page.goto("./docs/adr-post-commit-effects/");
  await expect(
    page.getByRole("heading", { name: "Post-commit effect delivery", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("ADR 0014", { exact: true })).toBeVisible();

  await page.goto("./docs/marketing/");
  await expect(
    page.getByRole("heading", { name: "Marketing and launch", exact: true }),
  ).toBeVisible();
});

test("renders the complete system design with its original figures", async ({ page }) => {
  await page.goto("./docs/system-design/");
  await expect(page.getByRole("heading", { name: "System design", exact: true })).toBeVisible();
  const article = page.locator("article");
  await expect(article.locator("h1")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Document control", exact: true }),
  ).toHaveJSProperty("tagName", "H2");
  await expect(
    page.getByRole("heading", { name: "1. Scope, status, and normative language", exact: true }),
  ).toHaveJSProperty("tagName", "H2");
  await expect(page.getByRole("heading", { name: "1.1 In scope", exact: true })).toHaveJSProperty(
    "tagName",
    "H3",
  );
  const headingLevels = await article
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
  expect(
    headingLevels.every(
      (level, index) => index === 0 || level <= (headingLevels[index - 1] ?? 0) + 1,
    ),
  ).toBe(true);
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
