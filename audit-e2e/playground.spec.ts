import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const titles = { notes: "Notes", checklist: "Checklist", preview: "Preview", activity: "Activity" };
const tab = (page: Page, id: string) => page.locator(`[data-workspace-panel-tab="${id}"]`);
const group = (page: Page, id: string) => page.locator(`[data-workspace-group="${id}"]`);
const tool = (page: Page, name: string) =>
  page.locator(".tp-toolbar").getByRole("button", { name, exact: true });
async function press(locator: Locator) {
  if (test.info().project.use.hasTouch) await locator.tap();
  else await locator.click();
}
async function owner(page: Page, id: string) {
  // Query the current DOM atomically. A layout commit can detach the previous tab
  // between Playwright's handle resolution and evaluate, especially after touch.
  return page.evaluate((panelId) => {
    const el = document.querySelector(`[data-workspace-panel-tab="${panelId}"]`);
    const label = el?.closest('[role="tablist"]')?.getAttribute("aria-labelledby");
    const group =
      el?.closest("[data-workspace-group]") ??
      (label ? document.getElementById(label)?.closest("[data-workspace-group]") : null);
    return group?.getAttribute("data-workspace-group");
  }, id);
}
async function picker(page: Page, title: string) {
  await press(tool(page, "Panels"));
  await press(
    page.locator(".tp-panel-picker button").filter({ has: page.getByText(title, { exact: true }) }),
  );
  await expect(page.locator(".tp-sheet")).toHaveCount(0);
}
async function actions(page: Page, title: string) {
  await picker(page, title);
  await press(page.getByRole("button", { name: `Actions for ${title}`, exact: true }));
  return page.getByRole("menu", { name: `${title} actions`, exact: true });
}
async function floating(page: Page) {
  const menu = await actions(page, "Notes");
  await press(menu.getByRole("menuitem", { name: "Float Notes", exact: true }));
  const frame = page.locator(".pf-floating-surface");
  await expect(frame).toHaveCount(1);
  return frame;
}
async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  if (!result) throw new Error("Expected visible geometry");
  return result;
}
async function saved(page: Page) {
  await expect(page.locator(".tp-save")).toContainText("Layout saved");
}

test.beforeEach(async ({ page }) => {
  await page.goto("./?fixture=touch");
  await expect(page.locator(".tp-workspace")).toBeVisible();
});

test("opens every sample panel and keeps live content during tab selection", async ({ page }) => {
  await expect(page.locator(".pf-group")).toHaveCount(2);
  await expect(tool(page, "Undo")).toBeDisabled();
  await expect(tool(page, "Redo")).toBeDisabled();
  const note = page.getByRole("textbox", { name: "Your working note" });
  const text = "<script>not executable</script>\nA working note.";
  await note.fill(text);
  for (const [id, title] of Object.entries(titles)) {
    await picker(page, title);
    await expect(tab(page, id)).toHaveAttribute("aria-selected", "true");
  }
  await picker(page, "Preview");
  await expect(page.locator(".tp-note-preview")).toHaveText(text);
  await picker(page, "Checklist");
  await press(page.getByLabel("Move a panel", { exact: true }));
  await picker(page, "Notes");
  await expect(note).toHaveValue(text);
  await picker(page, "Checklist");
  await expect(page.getByLabel("Move a panel", { exact: true })).toBeChecked();
});

for (const [id, title] of Object.entries(titles)) {
  for (const placement of ["Above", "Left", "As tab", "Right", "Below"]) {
    test(`Move sheet: ${title} / ${placement}, preview, commit, undo and redo`, async ({
      page,
    }) => {
      const from = await owner(page, id);
      const to = from === "primary" ? "secondary" : "primary";
      await press(tool(page, "Move"));
      const dialog = page.getByRole("dialog", { name: "Move or split a panel" });
      await dialog.getByLabel("Panel", { exact: true }).selectOption(id);
      await dialog.getByLabel("Destination pane").selectOption(to);
      await press(dialog.getByRole("button", { name: placement, exact: true }));
      await expect(dialog.getByRole("button", { name: placement, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const revision = await page
        .locator(".touch-playground")
        .getAttribute("data-workspace-revision");
      await expect(dialog.getByRole("img", { name: /Layout preview/ })).toBeVisible();
      expect(await page.locator(".touch-playground").getAttribute("data-workspace-revision")).toBe(
        revision,
      );
      await press(dialog.getByRole("button", { name: "Apply move" }));
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => owner(page, id)).not.toBe(from);
      await expect(page.locator(".pf-group")).toHaveCount(placement === "As tab" ? 2 : 3);
      const movedOwner = await owner(page, id);
      if (placement !== "As tab") {
        const moved = await box(group(page, movedOwner ?? "missing"));
        const target = await box(group(page, to));
        if (placement === "Left") expect(moved.x + moved.width).toBeLessThanOrEqual(target.x + 1);
        if (placement === "Right")
          expect(moved.x).toBeGreaterThanOrEqual(target.x + target.width - 1);
        if (placement === "Above") expect(moved.y + moved.height).toBeLessThanOrEqual(target.y + 1);
        if (placement === "Below")
          expect(moved.y).toBeGreaterThanOrEqual(target.y + target.height - 1);
      } else expect(movedOwner).toBe(to);
      await press(tool(page, "Undo"));
      await expect.poll(() => owner(page, id)).toBe(from);
      await press(tool(page, "Redo"));
      await expect.poll(() => owner(page, id)).toBe(movedOwner);
    });
  }
}

test("can close every panel, reopen from an empty workspace, and restore after reload", async ({
  page,
}) => {
  for (const [id, title] of Object.entries(titles)) {
    const menu = await actions(page, title);
    await press(menu.getByRole("menuitem", { name: `Close ${title}`, exact: true }));
    await expect(tab(page, id)).toHaveCount(0);
  }
  await expect(tool(page, "Move")).toBeDisabled();
  await saved(page);
  await page.reload();
  await expect(page.locator(".tp-workspace")).toBeVisible();
  for (const [id, title] of Object.entries(titles)) {
    await picker(page, title);
    await expect(tab(page, id)).toHaveAttribute("aria-selected", "true");
  }
  await saved(page);
  await page.reload();
  await expect(page.locator("[data-workspace-panel-tab]")).toHaveCount(4);
});

test("panel menus reorder, move, and remove a container without losing panels", async ({
  page,
}) => {
  let menu = await actions(page, "Notes");
  await press(menu.getByRole("menuitem", { name: "Move Notes tab after Checklist", exact: true }));
  await expect(group(page, "primary").locator(".pf-tab-title")).toHaveText(["Checklist", "Notes"]);
  menu = await actions(page, "Notes");
  await press(menu.getByRole("menuitem", { name: "Move Notes tab before Checklist", exact: true }));
  menu = await actions(page, "Notes");
  await press(menu.getByRole("menuitem", { name: "Move to Preview + Activity", exact: true }));
  await expect.poll(() => owner(page, "notes")).toBe("secondary");
  menu = await actions(page, "Checklist");
  await press(menu.getByRole("menuitem", { name: /Remove panel container/ }));
  await expect(page.locator(".pf-group")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(4);
  await press(tool(page, "Undo"));
  await expect(page.locator(".pf-group")).toHaveCount(2);
});

for (const edge of ["left", "right", "above", "below"]) {
  test(`panel menu splits ${edge}`, async ({ page }) => {
    const menu = await actions(page, "Notes");
    await press(menu.getByRole("menuitem", { name: `Split ${edge}`, exact: true }));
    await expect(page.locator(".pf-group")).toHaveCount(3);
    await expect.poll(() => owner(page, "notes")).not.toBe("primary");
    await press(tool(page, "Undo"));
    await expect(page.locator(".pf-group")).toHaveCount(2);
  });
}

test("menu destination and group-move dialogs also work without a keyboard", async ({ page }) => {
  let menu = await actions(page, "Notes");
  await press(menu.getByRole("menuitem", { name: "Choose destination…", exact: true }));
  let dialog = page.getByRole("dialog", { name: "Move Notes", exact: true });
  await expect(dialog.getByRole("button", { name: "Cancel move", exact: true })).toBeVisible();
  await dialog.getByRole("combobox").selectOption({ label: "Preview + Activity" });
  await press(dialog.getByRole("button", { name: "Move here", exact: true }));
  await expect.poll(() => owner(page, "notes")).toBe("secondary");
  await press(tool(page, "Undo"));
  menu = await actions(page, "Notes");
  await press(
    menu.getByRole("menuitem", { name: "Move Notes + Checklist panel container", exact: true }),
  );
  dialog = page.getByRole("dialog", {
    name: "Move Notes + Checklist panel container",
    exact: true,
  });
  await dialog
    .getByRole("combobox")
    .selectOption({ label: "Merge Notes + Checklist into Preview + Activity" });
  await press(dialog.getByRole("button", { name: "Move here", exact: true }));
  await expect(page.locator(".pf-group")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(4);
});

test("floating controls preserve readable chrome, maximize, restore, minimize and dock", async ({
  page,
}, info) => {
  const frame = await floating(page);
  const header = await box(frame.locator(".pf-floating-titlebar"));
  const content = await box(frame.locator(".pf-floating-content"));
  for (const button of await frame.locator(".pf-floating-controls button").all()) {
    const rect = await box(button);
    expect(rect.y + rect.height).toBeLessThanOrEqual(content.y + 1);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  expect(header.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath("floating-chrome.png") });
  await press(frame.getByRole("button", { name: /Maximize Notes/ }));
  await expect(frame).toHaveAttribute("data-maximized", "true");
  await press(frame.getByRole("button", { name: /Restore Notes/ }));
  await expect(frame).toHaveAttribute("data-maximized", "false");
  await press(frame.getByRole("button", { name: /Minimize Notes/ }));
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await press(frame.getByRole("button", { name: /Restore Notes/ }));
  await expect(frame).toHaveAttribute("data-minimized", "false");
  await press(frame.getByRole("button", { name: /Dock Notes/ }));
  await expect(frame).toHaveCount(0);
  await expect(tab(page, "notes")).toBeVisible();
});

test("Show panel restores a minimized floating panel", async ({ page }) => {
  const frame = await floating(page);
  await press(frame.getByRole("button", { name: /Minimize Notes/ }));
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await picker(page, "Notes");
  await expect(frame).toHaveAttribute("data-minimized", "false");
  await expect(page.getByRole("textbox", { name: "Your working note" })).toBeVisible();
});

test("Move sheet reaches floating destinations and shows the moved panel in its preview", async ({
  page,
}) => {
  await floating(page);
  const destination = await owner(page, "notes");
  await press(tool(page, "Move"));
  const dialog = page.getByRole("dialog", { name: "Move or split a panel" });
  await dialog.getByLabel("Panel", { exact: true }).selectOption("checklist");
  await dialog.getByLabel("Destination pane").selectOption(destination ?? "missing");
  await press(dialog.getByRole("button", { name: "As tab", exact: true }));
  await expect(dialog.getByRole("button", { name: "Apply move" })).toBeEnabled();
  await expect(dialog.locator('[data-selected="true"]')).toContainText("Checklist");
  await press(dialog.getByRole("button", { name: "Apply move" }));
  await expect.poll(() => owner(page, "checklist")).toBe(destination);
  await press(tool(page, "Undo"));
  await expect.poll(() => owner(page, "checklist")).toBe("primary");
});

test("short-screen menus stay inside the visible viewport", async ({ page }, info) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const menu = await actions(page, "Preview");
    const rect = await box(menu);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: info.outputPath(`menu-${viewport.width}.png`) });
    await page.keyboard.press("Escape");
  }
});

test("help, sheet cancellation, focus restoration, and Arrange do not edit the layout", async ({
  page,
}) => {
  const revision = await page.locator(".touch-playground").getAttribute("data-workspace-revision");
  await press(tool(page, "Arrange"));
  await expect(page.locator(".touch-playground")).toHaveAttribute("data-arranging", "true");
  await expect(page.locator(".pf-group-drag-region").first()).toBeVisible();
  await press(tool(page, "Done"));
  for (const name of ["Panels", "Move"]) {
    await press(tool(page, name));
    await press(page.getByRole("button", { name: "Close panel sheet" }));
    await expect(tool(page, name)).toBeFocused();
  }
  await press(page.getByRole("button", { name: "Playground help" }));
  await expect(page.getByRole("link", { name: /Open the full Code example/ })).toHaveAttribute(
    "href",
    /\?fixture=code$/,
  );
  await page.keyboard.press("Escape");
  expect(await page.locator(".touch-playground").getAttribute("data-workspace-revision")).toBe(
    revision,
  );
});

test("keyboard tab navigation, reordering and splitter resizing work", async ({ page }) => {
  await tab(page, "notes").focus();
  await page.keyboard.press("End");
  await expect(tab(page, "checklist")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab(page, "notes")).toBeFocused();
  const splitter = page.locator(".pf-splitter").first();
  const before = await splitter.getAttribute("aria-valuenow");
  await splitter.focus();
  await page.keyboard.press("ArrowDown");
  await expect(splitter).not.toHaveAttribute("aria-valuenow", before ?? "missing");
});

test("automatic accessibility checks include every sheet and a floating panel", async ({
  page,
}) => {
  for (const name of [undefined, "Panels", "Move", "help"] as const) {
    if (name)
      await press(
        name === "help" ? page.getByRole("button", { name: "Playground help" }) : tool(page, name),
      );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    if (name) await press(page.getByRole("button", { name: "Close panel sheet" }));
  }
  await floating(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

for (const placement of ["Above", "Left", "Right", "Below", "As tab"]) {
  test(`floating destination: ${placement}, preview and reversible redock`, async ({ page }) => {
    const note = page.getByRole("textbox", { name: "Your working note" });
    await note.fill("State across surfaces");
    const frame = await floating(page);
    const destination = await owner(page, "notes");
    await press(frame.getByRole("button", { name: /Minimize Notes/ }));
    await press(tool(page, "Move"));
    const sheet = page.getByRole("dialog", { name: "Move or split a panel" });
    await sheet.getByLabel("Panel", { exact: true }).selectOption("checklist");
    await sheet.getByLabel("Destination pane").selectOption(destination ?? "missing");
    await press(sheet.getByRole("button", { name: placement, exact: true }));
    await expect(sheet.getByRole("button", { name: placement, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(sheet.locator('[data-selected="true"]')).toContainText("Checklist");
    await press(sheet.getByRole("button", { name: "Apply move" }));
    await expect(frame).toHaveAttribute("data-minimized", "false");
    await expect(frame.getByRole("tab", { name: "Checklist", exact: true })).toBeVisible();
    const revision = Number(
      await page.locator(".touch-playground").getAttribute("data-workspace-revision"),
    );
    await press(frame.getByRole("button", { name: /^Dock / }));
    await expect(frame).toHaveCount(0);
    await expect(page.locator(".touch-playground")).toHaveAttribute(
      "data-workspace-revision",
      String(revision + 1),
    );
    await expect(page.getByRole("tab")).toHaveCount(4);
    await press(tool(page, "Undo"));
    await expect(frame).toHaveCount(1);
    await press(tool(page, "Redo"));
    await expect(frame).toHaveCount(0);
    await picker(page, "Notes");
    await expect(note).toHaveValue("State across surfaces");
  });
}

test("floating move and resize controls commit once and keep state through reload", async ({
  page,
}) => {
  const frame = await floating(page);
  const before = await box(frame);
  await frame.locator(".pf-floating-titlebar").focus();
  await page.keyboard.press("ArrowUp");
  const moved = await box(frame);
  expect(moved.y).toBeLessThan(before.y);
  const handle = frame.locator('[data-resize-edge="bottom"]');
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  expect((await box(frame)).height).toBeGreaterThan(moved.height);
  await saved(page);
  const finalBox = await box(frame);
  await page.reload();
  await expect(page.locator(".pf-floating-surface")).toBeVisible();
  const restored = await box(page.locator(".pf-floating-surface"));
  expect(restored.x).toBeCloseTo(finalBox.x, 0);
  expect(restored.height).toBeCloseTo(finalBox.height, 0);
});

test("unavailable storage is explicit and temporary mode retains all layout controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("Storage disabled");
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("saved data has not been removed");
  await press(page.getByRole("button", { name: "Continue without saving" }));
  await expect(page.locator(".tp-save")).toContainText("not saved");
  const menu = await actions(page, "Notes");
  await press(menu.getByRole("menuitem", { name: "Split below", exact: true }));
  await expect(page.locator(".pf-group")).toHaveCount(3);
  await press(tool(page, "Undo"));
  await expect(page.locator(".pf-group")).toHaveCount(2);
});
