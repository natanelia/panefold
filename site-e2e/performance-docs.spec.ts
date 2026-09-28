import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("renders current benchmark numbers from the repository Markdown", async ({ page }) => {
  const markdown = await readFile("docs/PERFORMANCE.md", "utf8");
  const candidate = /Measured merge commit: `([a-f0-9]{40})`/.exec(markdown)?.[1];
  if (candidate === undefined) throw new Error("Missing measured commit in benchmark report");
  await page.goto("./docs/performance/");
  await expect(page).toHaveTitle("Performance benchmarks — Panefold documentation");
  await expect(page.getByRole("heading", { name: "Performance benchmarks", exact: true })).toBeVisible();
  const article = page.locator("article");
  await expect(article.getByText(candidate, { exact: true })).toBeVisible();
  const selected = markdown.split("## Selected workloads")[1]?.split("## Regression checks")[0];
  const rows = selected?.split("\n").filter((line) => line.startsWith("|") && !/^\|[-:| ]+\|$/.test(line) && !line.includes("Workload (Node 24)")) ?? [];
  expect(rows.length).toBe(10);
  for (const sourceRow of rows) {
    const cells = sourceRow.split("|").slice(1, -1).map((cell) => cell.trim());
    const [workload] = cells;
    if (workload === undefined || workload.length === 0) throw new Error("Missing benchmark workload");
    const row = article.getByRole("row").filter({ has: page.getByRole("cell", { name: workload, exact: true }) });
    await expect(row).toHaveCount(1);
    for (const cell of cells) await expect(row.getByRole("cell", { name: cell, exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(article.getByText(candidate, { exact: true })).toBeVisible();
});
