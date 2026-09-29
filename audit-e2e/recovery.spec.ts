import { expect, test, type Locator, type Page } from "@playwright/test";

const tools = (page: Page, name: string) =>
  page.locator(".tp-toolbar").getByRole("button", { name, exact: true });
async function press(button: Locator) {
  if (test.info().project.use.hasTouch) await button.tap();
  else await button.click();
}
async function notesMenu(page: Page) {
  await press(page.getByRole("button", { name: "Actions for Notes", exact: true }));
  return page.getByRole("menu", { name: "Notes actions", exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto("./?fixture=touch");
  await expect(page.locator(".tp-workspace")).toBeVisible();
  await expect(page.locator(".tp-save")).toContainText("Layout saved");
});

test("Retry save preserves the in-memory change and writes the recovered layout", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = original;
      throw new DOMException("Simulated full storage", "QuotaExceededError");
    };
  });
  const menu = await notesMenu(page);
  await press(menu.getByRole("menuitem", { name: "Split below", exact: true }));
  await expect(page.locator(".pf-group")).toHaveCount(3);
  await expect(page.locator(".tp-save")).toContainText("Layout not saved");
  await press(page.getByRole("button", { name: "Retry save", exact: true }));
  await expect(page.locator(".tp-save")).toContainText("Layout saved");
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".pf-group")).toHaveCount(3);
});

test("Retry opening recovers the existing layout without clearing saved data", async ({ page }) => {
  const menu = await notesMenu(page);
  await press(menu.getByRole("menuitem", { name: "Split below", exact: true }));
  await expect(page.locator(".pf-group")).toHaveCount(3);
  await expect(page.locator(".tp-save")).toContainText("Layout saved");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("audit-storage-blocked") === "once") return;
    sessionStorage.setItem("audit-storage-blocked", "once");
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("Temporarily unavailable");
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("saved data has not been removed");
  await press(page.getByRole("button", { name: "Retry", exact: true }));
  await expect(page.locator(".pf-group")).toHaveCount(3);
  await expect(page.locator(".tp-save")).toContainText("Layout saved");
});

test("an unchanged placement is disabled, and cancellation leaves history unchanged", async ({
  page,
}) => {
  const revision = await page.locator(".touch-playground").getAttribute("data-workspace-revision");
  await press(tools(page, "Move"));
  const sheet = page.getByRole("dialog", { name: "Move or split a panel" });
  await sheet.getByLabel("Panel", { exact: true }).selectOption("notes");
  await sheet.getByLabel("Destination pane").selectOption("primary");
  await press(sheet.getByRole("button", { name: "As tab", exact: true }));
  await expect(sheet.getByRole("button", { name: "Apply move" })).toBeDisabled();
  await expect(sheet.getByRole("status")).toContainText("would not change the layout");
  await press(sheet.getByRole("button", { name: "Close panel sheet" }));
  await expect(page.locator(".touch-playground")).toHaveAttribute(
    "data-workspace-revision",
    revision ?? "missing",
  );
  await expect(tools(page, "Undo")).toBeDisabled();
});

test("floating tab keyboard navigation never moves or resizes the window", async ({ page }) => {
  const menu = await notesMenu(page);
  await press(menu.getByRole("menuitem", { name: "Float Notes", exact: true }));
  const frame = page.locator(".pf-floating-surface");
  await expect(frame).toBeVisible();
  const before = await frame.boundingBox();
  await frame.getByRole("tab", { name: "Notes", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  expect(await frame.boundingBox()).toEqual(before);
});
