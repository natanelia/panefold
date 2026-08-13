import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

type DropPosition = "center" | "inline-start" | "inline-end" | "block-start" | "block-end";

async function revisionOf(page: Page): Promise<number> {
  return Number(
    await page.locator("[data-workspace-revision]").getAttribute("data-workspace-revision"),
  );
}

async function dragTabToGroup(
  page: Page,
  panelId: string,
  targetGroupId: string,
  position: DropPosition,
) {
  const tab = page.locator(`[data-workspace-panel-tab="${panelId}"]`);
  const group = page.locator(`[data-workspace-group="${targetGroupId}"]`);
  const sourceBox = await requiredBox(tab);
  const targetBox = await requiredBox(group);
  const targetNodeId = await group.getAttribute("data-workspace-node");
  expect(targetNodeId).not.toBeNull();
  const inset = 8;
  const target =
    position === "center"
      ? { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
      : position === "inline-start"
        ? { x: targetBox.x + inset, y: targetBox.y + targetBox.height / 2 }
        : position === "inline-end"
          ? { x: targetBox.x + targetBox.width - inset, y: targetBox.y + targetBox.height / 2 }
          : position === "block-start"
            ? { x: targetBox.x + targetBox.width / 2, y: targetBox.y + inset }
            : { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height - inset };

  await tab.scrollIntoViewIfNeeded();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  const overlay = page.locator("[data-workspace-panel-drag]");
  await expect(overlay).toHaveAttribute(
    "data-workspace-drop-kind",
    position === "center" ? "center" : "edge",
  );
  await expect(overlay).toHaveAttribute(
    "data-workspace-drop-target",
    position === "center"
      ? `center:${String(targetNodeId)}`
      : `edge:${String(targetNodeId)}:${position}`,
  );
  if (position !== "center") {
    await expect(overlay).toHaveAttribute("data-workspace-drop-edge", position);
  }
  const previewRect = await requiredBox(overlay.locator(".pf-panel-drop-preview"));
  await page.mouse.up();
  return previewRect;
}

async function splitNotesFromMenu(page: Page, menuLabel: string) {
  const notesTab = page.getByRole("tab", { name: "Notes" });
  if ((await notesTab.getAttribute("aria-selected")) !== "true") await notesTab.click();
  await page.getByRole("button", { name: "Actions for Notes" }).click();
  await page.getByRole("menuitem", { name: menuLabel }).click();
}

async function dragTabRelative(
  page: Page,
  sourcePanelId: string,
  anchorPanelId: string,
  relation: "before" | "after",
  orientation: "horizontal" | "vertical",
  direction: "ltr" | "rtl" = "ltr",
) {
  const source = page.locator(`[data-workspace-panel-tab="${sourcePanelId}"]`);
  const anchor = page.locator(`[data-workspace-panel-tab="${anchorPanelId}"]`);
  await waitForRectToSettle(source);
  await waitForRectToSettle(anchor);
  const sourceBox = await requiredBox(source);
  const anchorBox = await requiredBox(anchor);
  const beforeAtPhysicalStart = orientation === "vertical" || direction === "ltr";
  const usePhysicalStart = relation === "before" ? beforeAtPhysicalStart : !beforeAtPhysicalStart;
  const target =
    orientation === "vertical"
      ? {
          x: anchorBox.x + anchorBox.width / 2,
          y: usePhysicalStart ? anchorBox.y + 3 : anchorBox.y + anchorBox.height - 3,
        }
      : {
          x: usePhysicalStart ? anchorBox.x + 3 : anchorBox.x + anchorBox.width - 3,
          y: anchorBox.y + anchorBox.height / 2,
        };
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  const overlay = page.locator("[data-workspace-panel-drag]");
  await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "reorder");
  await expect(overlay.locator("[data-workspace-tab-reorder-indicator]")).toBeVisible();
  await page.mouse.up();
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Expected a rendered drag target");
  return box;
}

async function waitForRectToSettle(locator: Locator) {
  let previous: Awaited<ReturnType<Locator["boundingBox"]>>;
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const current = await locator.boundingBox();
        if (current === null) return 0;
        if (
          previous !== null &&
          previous !== undefined &&
          Math.abs(current.x - previous.x) <= 0.5 &&
          Math.abs(current.y - previous.y) <= 0.5 &&
          Math.abs(current.width - previous.width) <= 0.5 &&
          Math.abs(current.height - previous.height) <= 0.5
        ) {
          stableSamples += 1;
        } else {
          stableSamples = 0;
        }
        previous = current;
        return stableSamples;
      },
      { timeout: 3_000, intervals: [50] },
    )
    .toBeGreaterThanOrEqual(2);
}

async function waitForGroupToFillWorkspaceBlock(page: Page, groupId: string) {
  const workspace = page.getByLabel("Map operations workspace");
  const group = page.locator(`[data-workspace-group="${groupId}"]`);
  await expect
    .poll(async () => {
      const workspaceRect = await requiredBox(workspace);
      const groupRect = await requiredBox(group);
      return Math.abs(workspaceRect.height - groupRect.height);
    })
    .toBeLessThanOrEqual(1);
}

async function expectRectToSettle(
  expected: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  locator: Locator,
) {
  await expect
    .poll(
      async () => {
        const actual = await requiredBox(locator);
        return Math.max(
          ...(["x", "y", "width", "height"] as const).map((key) =>
            Math.abs(expected[key] - actual[key]),
          ),
        );
      },
      { message: "Committed panel geometry must settle on the retained preview plan" },
    )
    .toBeLessThanOrEqual(1);
}

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
  await expect(page.locator('[data-workspace-revision="1"]')).toBeVisible();
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
  await expect(page.locator('[data-workspace-revision="2"]')).toBeVisible();
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

test("drags a stateful panel into another container and undoes it atomically", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Map operations workspace")).toBeVisible();
  const notesTab = page.locator('[data-workspace-panel-tab="notes"]');
  await notesTab.click();
  const notesHost = page.locator('[data-workspace-panel-host="notes"]');
  const hostId = await notesHost.getAttribute("id");
  const editor = notesHost.getByRole("textbox", { name: "Workspace review notes" });
  await editor.fill("State survives a direct panel drop.");
  const before = await revisionOf(page);

  await dragTabToGroup(page, "notes", "inspector", "center");

  await expect.poll(() => revisionOf(page)).toBe(before + 1);
  await expect(
    page
      .locator('[data-workspace-group="inspector"]')
      .locator('[data-workspace-panel-tab="notes"]'),
  ).toBeVisible();
  await expect(notesHost).toHaveAttribute("id", hostId ?? "");
  await expect(editor).toHaveValue("State survives a direct panel drop.");

  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(
    page.locator('[data-workspace-group="primary"]').locator('[data-workspace-panel-tab="notes"]'),
  ).toBeVisible();
  await expect(editor).toHaveValue("State survives a direct panel drop.");
});

test("reorders tabs by drag in horizontal LTR, RTL, and vertical rails without remounting", async ({
  page,
}) => {
  await page.goto("/");
  const primary = page.locator('[data-workspace-group="primary"]');
  const notesHost = page.locator('[data-workspace-panel-host="notes"]');
  const hostId = await notesHost.getAttribute("id");
  const editor = notesHost.getByRole("textbox", { name: "Workspace review notes" });
  await page.getByRole("tab", { name: "Notes" }).click();
  await editor.fill("Tab reorder keeps this live editor.");
  const initialRevision = await revisionOf(page);

  await dragTabRelative(page, "notes", "map-canvas", "before", "horizontal");
  await expect.poll(() => revisionOf(page)).toBe(initialRevision + 1);
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["notes", "map-canvas"]);
  await expect(notesHost).toHaveAttribute("id", hostId ?? "");
  await expect(editor).toHaveValue("Tab reorder keeps this live editor.");

  await dragTabRelative(page, "notes", "map-canvas", "after", "horizontal");
  await expect.poll(() => revisionOf(page)).toBe(initialRevision + 2);
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["map-canvas", "notes"]);

  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page
    .getByRole("dialog", { name: "Workspace appearance" })
    .getByRole("combobox", { name: "Direction" })
    .selectOption("rtl");
  await dragTabRelative(page, "notes", "map-canvas", "before", "horizontal", "rtl");
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["notes", "map-canvas"]);

  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page
    .getByRole("dialog", { name: "Workspace appearance" })
    .getByRole("combobox", { name: "Tab rail" })
    .selectOption("inline-start");
  await dragTabRelative(page, "notes", "map-canvas", "after", "vertical", "rtl");
  await expect(primary.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["map-canvas", "notes"]);
  await expect(notesHost).toHaveAttribute("id", hostId ?? "");
  await expect(editor).toHaveValue("Tab reorder keeps this live editor.");
});

test("autoscrolls an overflowing tab strip and retains the final insertion target", async ({
  page,
}) => {
  await page.goto("/");
  await page.addStyleTag({
    content: `
      [data-workspace-group="primary"] .pf-tab-list {
        flex: 0 0 260px;
        max-inline-size: 260px;
      }
      [data-workspace-group="primary"] .pf-tab {
        flex: 0 0 220px;
        min-inline-size: 220px;
      }
    `,
  });
  const primary = page.locator('[data-workspace-group="primary"]');
  const tablist = primary.getByRole("tablist");
  const dragFirstTabToLogicalEnd = async (direction: "ltr" | "rtl") => {
    await tablist.evaluate((element) => {
      element.scrollLeft = 0;
    });
    const source = primary.locator('[data-workspace-panel-tab="map-canvas"]');
    const sourceBox = await requiredBox(source);
    const stripBox = await requiredBox(tablist);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    const targetX = direction === "rtl" ? stripBox.x + 4 : stripBox.x + stripBox.width - 4;
    await page.mouse.move(targetX, stripBox.y + stripBox.height / 2, { steps: 12 });
    await expect
      .poll(() => tablist.evaluate((element) => element.scrollLeft))
      [direction === "rtl" ? "toBeLessThan" : "toBeGreaterThan"](0);
    await expect(page.locator("[data-workspace-panel-drag]")).toHaveAttribute(
      "data-workspace-drop-target",
      "reorder:primary:append",
    );
    await page.mouse.up();
  };

  const firstRevision = await revisionOf(page);
  await dragFirstTabToLogicalEnd("ltr");
  await expect.poll(() => revisionOf(page)).toBe(firstRevision + 1);
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["notes", "map-canvas"]);

  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["map-canvas", "notes"]);
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page
    .getByRole("dialog", { name: "Workspace appearance" })
    .getByRole("combobox", { name: "Direction" })
    .selectOption("rtl");
  const rtlRevision = await revisionOf(page);
  await dragFirstTabToLogicalEnd("rtl");
  await expect.poll(() => revisionOf(page)).toBe(rtlRevision + 1);
  await expect
    .poll(() =>
      primary
        .getByRole("tab")
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-workspace-panel-tab"))),
    )
    .toEqual(["notes", "map-canvas"]);
});

test("creates new containers on all four logical sides through the shared drop planner", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-workspace-group]")).toHaveCount(4);
  await page.getByRole("tab", { name: "Notes" }).click();

  for (const [menuLabel, side] of [
    ["Split left", "inline-start"],
    ["Split right", "inline-end"],
    ["Split above", "block-start"],
    ["Split below", "block-end"],
  ] as const) {
    const before = await revisionOf(page);
    await splitNotesFromMenu(page, menuLabel);
    await expect.poll(() => revisionOf(page)).toBe(before + 1);
    await expect(page.locator("[data-workspace-group]")).toHaveCount(5);
    const notesTab = page.getByRole("tab", { name: "Notes" });
    await expect(notesTab).toBeVisible();
    const notesGroup = notesTab.locator("xpath=ancestor::*[@data-workspace-group][1]");
    const primaryGroup = page.locator('[data-workspace-group="primary"]');
    const notesBox = await requiredBox(notesGroup);
    const primaryBox = await requiredBox(primaryGroup);
    if (side === "inline-start") {
      expect(notesBox.x + notesBox.width / 2).toBeLessThan(primaryBox.x + primaryBox.width / 2);
    } else if (side === "inline-end") {
      expect(notesBox.x + notesBox.width / 2).toBeGreaterThan(primaryBox.x + primaryBox.width / 2);
    } else if (side === "block-start") {
      expect(notesBox.y + notesBox.height / 2).toBeLessThan(primaryBox.y + primaryBox.height / 2);
    } else {
      expect(notesBox.y + notesBox.height / 2).toBeGreaterThan(
        primaryBox.y + primaryBox.height / 2,
      );
    }

    await page.getByRole("button", { name: "Undo layout change" }).click();
    await expect(page.locator("[data-workspace-group]")).toHaveCount(4);
    await expect(
      page.locator('[data-workspace-group="primary"]').getByRole("tab", { name: "Notes" }),
    ).toBeVisible();
  }
});

test("redocks into a persistent group after its last tab moves away", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("tab", { name: "Notes" }).click();
  await splitNotesFromMenu(page, "Split right");
  await expect(page.locator("[data-workspace-group]")).toHaveCount(5);

  await page.getByRole("button", { name: "Actions for Map Canvas" }).click();
  await page.getByRole("menuitem", { name: "Move to Inspector" }).click();
  const emptyPrimary = page.locator('[data-workspace-group="primary"]');
  await expect(emptyPrimary).toHaveAttribute("data-empty", "true");
  await expect(page.locator('[data-workspace-empty-group="primary"]')).toBeVisible();
  await expect(emptyPrimary).toContainText(/Primary workspace is empty/i);
  const emptyBox = await requiredBox(emptyPrimary);
  expect(emptyBox.width).toBeGreaterThanOrEqual(96);
  expect(emptyBox.height).toBeGreaterThanOrEqual(96);

  await dragTabToGroup(page, "notes", "primary", "center");
  await expect(
    page.locator('[data-workspace-group="primary"] [data-workspace-panel-tab="notes"]'),
  ).toBeVisible();
  await expect(page.locator('[data-workspace-empty-group="primary"]')).toHaveCount(0);
  await expect(page.locator("[data-workspace-group]")).toHaveCount(4);
});

test("allocates a fresh split identity from persisted topology after reload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("tab", { name: "Notes" }).click();
  await splitNotesFromMenu(page, "Split right");
  const persistedSplitRevision = await revisionOf(page);
  await expect(page.locator("[data-persistence-state='saved']")).toHaveAttribute(
    "data-persisted-revision",
    String(persistedSplitRevision),
  );

  await page.reload();
  await expect(page.locator("[data-persistence-state='restored']")).toBeVisible();
  await waitForGroupToFillWorkspaceBlock(page, "inspector");
  const beforeSecondSplit = await revisionOf(page);
  const previewRect = await dragTabToGroup(page, "notes", "inspector", "inline-start");

  await expect.poll(() => revisionOf(page)).toBe(beforeSecondSplit + 1);
  await expect(page.locator("[data-workspace-group]")).toHaveCount(5);
  const notesGroup = page
    .locator('[data-workspace-panel-tab="notes"]')
    .locator("xpath=ancestor::*[@data-workspace-group][1]");
  const inspector = page.locator('[data-workspace-group="inspector"]');
  const notesBox = await requiredBox(notesGroup);
  const inspectorBox = await requiredBox(inspector);
  expect(notesBox.x + notesBox.width / 2).toBeLessThan(inspectorBox.x + inspectorBox.width / 2);
  await expectRectToSettle(previewRect, notesGroup);
});

test("dragging a tab to a panel edge creates a new container in one transaction", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForGroupToFillWorkspaceBlock(page, "inspector");
  const before = await revisionOf(page);

  const previewRect = await dragTabToGroup(page, "notes", "inspector", "inline-start");

  await expect.poll(() => revisionOf(page)).toBe(before + 1);
  await expect(page.locator("[data-workspace-group]")).toHaveCount(5);
  const notesTab = page.locator('[data-workspace-panel-tab="notes"]');
  await expect(notesTab).toBeVisible();
  const notesGroup = notesTab.locator("xpath=ancestor::*[@data-workspace-group][1]");
  await expect(notesGroup).not.toHaveAttribute("data-workspace-group", "inspector");
  await expectRectToSettle(previewRect, notesGroup);
});

test("split menu, vertical rails, icon-only tabs, and pointer splitter remain usable", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Workspace appearance" }).click();
  const settings = page.getByRole("dialog", { name: "Workspace appearance" });
  await settings.getByRole("combobox", { name: "Tab rail" }).selectOption("inline-start");
  await settings.getByRole("combobox", { name: "Tab labels" }).selectOption("icon-only");
  const primaryTablist = page.locator('[data-workspace-group="primary"]').getByRole("tablist");
  await expect(primaryTablist).toHaveAttribute("aria-orientation", "vertical");
  const mapTab = primaryTablist.getByRole("tab", { name: "Map Canvas" });
  const notesTab = primaryTablist.getByRole("tab", { name: "Notes" });
  await expect(mapTab.locator(".pf-tab-title")).toHaveClass(/pf-visually-hidden/);
  await mapTab.focus();
  await mapTab.press("ArrowDown");
  await expect(notesTab).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Actions for Notes" }).click();
  await page.getByRole("menuitem", { name: "Split right" }).click();
  await expect(page.locator("[data-workspace-group]")).toHaveCount(5);
  await page.getByRole("button", { name: "Undo layout change" }).click();
  await expect(page.locator("[data-workspace-group]")).toHaveCount(4);

  await page.getByRole("button", { name: "Workspace appearance" }).click();
  await page
    .getByRole("dialog", { name: "Workspace appearance" })
    .getByRole("combobox", { name: "Tab rail" })
    .selectOption("block-start");
  const splitter = page.getByRole("separator").first();
  const firstGroup = page.locator('[data-workspace-group="navigation"]');
  const beforeWidth = (await requiredBox(firstGroup)).width;
  const splitterBox = await requiredBox(splitter);
  await page.mouse.move(
    splitterBox.x + splitterBox.width / 2,
    splitterBox.y + splitterBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    splitterBox.x + splitterBox.width / 2 + 100,
    splitterBox.y + splitterBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await requiredBox(firstGroup)).width)
    .toBeGreaterThan(beforeWidth + 45);
});

test("persists canonical panel configuration and view preferences across reload", async ({
  page,
}) => {
  await page.goto("/");
  await dragTabToGroup(page, "notes", "inspector", "center");
  const committedRevision = await revisionOf(page);
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  const settings = page.getByRole("dialog", { name: "Workspace appearance" });
  await settings.getByRole("combobox", { name: "Tab rail" }).selectOption("inline-end");
  await settings.getByRole("combobox", { name: "Tab labels" }).selectOption("icon-only");
  await expect(page.locator("[data-persistence-state='saved']")).toHaveAttribute(
    "data-persisted-revision",
    String(committedRevision),
  );

  await page.reload();

  await expect(page.locator("[data-persistence-state='restored']")).toContainText(
    `Restored revision ${String(committedRevision)} from IndexedDB`,
  );
  await expect(
    page
      .locator('[data-workspace-group="inspector"]')
      .locator('[data-workspace-panel-tab="notes"]'),
  ).toBeVisible();
  await expect(page.locator('[data-workspace-group="inspector"]')).toHaveAttribute(
    "data-tab-placement",
    "inline-end",
  );
  await expect(
    page.locator('[data-workspace-group="inspector"]').getByRole("tab", { name: "Notes" }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-workspace-group="inspector"]')
      .getByRole("tab", { name: "Notes" })
      .locator(".pf-tab-title"),
  ).toHaveClass(/pf-visually-hidden/);
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

test("keeps light-theme persistence and dynamic settings accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  const settings = page.getByRole("dialog", { name: "Workspace appearance" });
  await settings.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await expect(page.locator(".demo-app")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".demo-persistence-status")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("keeps persistence proof visible from desktop through 320px", async ({ page }) => {
  await page.goto("/");
  for (const width of [1200, 980, 880, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    const badge = page.locator(".demo-persistence-status");
    await expect(badge).toBeVisible();
    const box = await requiredBox(badge);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.width).toBeGreaterThan(24);
  }
});

test("caps and scrolls appearance settings in a low viewport", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 320 });
  await page.goto("/");
  await page.getByRole("button", { name: "Workspace appearance" }).click();
  const settings = page.getByRole("dialog", { name: "Workspace appearance" });
  const box = await requiredBox(settings);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(320);
  expect(await settings.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );

  const reset = settings.getByRole("button", { name: "Reset saved layout" });
  await reset.scrollIntoViewIfNeeded();
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(page.locator(".demo-surface-status")).toContainText("starting workspace");
});

test("fails closed instead of hanging when IndexedDB open rejects", async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function open() {
      throw new DOMException("IndexedDB intentionally unavailable", "InvalidStateError");
    };
  });
  await page.goto("/");

  await expect(page.getByText("Safe recovery boundary")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The saved workspace was not overwritten." }),
  ).toBeVisible();
  await expect(page.getByText("INDEXEDDB_OPEN_FAILED")).toBeVisible();
  await expect(page.getByLabel("Opening Atlas workspace")).toHaveCount(0);
});

test("drags a live panel beyond the workspace into a popup and redocks it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Notes" }).click();
  const notesHost = page.locator('[data-workspace-panel-host="notes"]');
  const hostId = await notesHost.getAttribute("id");
  const editor = notesHost.getByRole("textbox", { name: "Workspace review notes" });
  await editor.fill("The same React host is interactive across documents.");

  const notesTab = page.locator('[data-workspace-panel-tab="notes"]');
  await waitForRectToSettle(notesTab);
  const tabBox = await requiredBox(notesTab);
  const workspaceBox = await requiredBox(page.getByLabel("Map operations workspace"));
  const popupPromise = page.waitForEvent("popup");
  await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(workspaceBox.x + workspaceBox.width / 2, workspaceBox.y - 12, {
    steps: 10,
  });
  await expect(page.locator("[data-workspace-panel-drag]")).toHaveAttribute(
    "data-workspace-drop-kind",
    "external",
  );
  await page.mouse.up();
  const popup = await popupPromise;

  await expect(popup.getByText("Panefold browser surface")).toBeVisible();
  await expect(popup.getByText("Notes", { exact: true })).toBeVisible();
  await expect(popup.locator("#panefold-surface-root")).toHaveAttribute(
    "data-panefold-ready",
    "true",
  );
  await expect(popup.locator('meta[name="panefold-workspace-id"]')).toHaveAttribute(
    "content",
    "atlas-demo",
  );
  await expect(page.locator('[data-workspace-panel-tab="notes"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo layout change" })).toBeDisabled();
  await expect(page.locator("[data-workspace-group]")).toHaveCount(4);
  const popupHost = popup.locator('[data-workspace-panel-host="notes"]');
  await expect(popupHost).toHaveAttribute("id", hostId ?? "");
  const popupEditor = popupHost.getByRole("textbox", { name: "Workspace review notes" });
  await expect(popupEditor).toHaveValue("The same React host is interactive across documents.");
  const accessibility = await new AxeBuilder({ page: popup })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await popupEditor.fill("Edited inside the external browser window.");

  await popup
    .getByRole("button", { name: "Return to main window" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(() => popup.isClosed()).toBe(true);
  const returnedNotesTab = page.locator(
    '[data-workspace-group="primary"] [data-workspace-panel-tab="notes"]',
  );
  await expect(returnedNotesTab).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo layout change" })).toBeDisabled();
  await expect(page.locator("[data-workspace-group]")).toHaveCount(4);
  await expect(page.locator('[data-workspace-panel-host="notes"]')).toHaveCount(1);
  await expect(page.locator(".demo-health")).toHaveAttribute("data-valid", "true");
  await expect(page.locator(".demo-surface-status")).toContainText(
    "returned to the main workspace",
  );
  await expect(page.locator(".pf-live-region")).toHaveText("Notes returned to the main window.");
  await expect(returnedNotesTab).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(false);
  if ((await returnedNotesTab.getAttribute("aria-selected")) !== "true") {
    await returnedNotesTab.click();
  }
  await expect(notesHost).toHaveAttribute("id", hostId ?? "");
  await expect(editor).toHaveValue("Edited inside the external browser window.");
});

test("a blocked popup leaves the panel and semantic revision in the source workspace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto("/");
  const before = await revisionOf(page);
  await page.getByRole("tab", { name: "Notes" }).click();
  const afterSelection = await revisionOf(page);
  expect(afterSelection).toBeGreaterThanOrEqual(before);
  await page.getByRole("button", { name: "Actions for Notes" }).click();
  await page.getByRole("menuitem", { name: "Open in new window" }).click();

  await expect(page.locator(".demo-surface-status")).toContainText("popup was blocked");
  await expect(page.locator('[data-workspace-panel-tab="notes"]')).toBeVisible();
  await expect.poll(() => revisionOf(page)).toBe(afterSelection);
});

test("unexpected popup loss recovers the authoritative panel into the main workspace", async ({
  page,
}) => {
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("button", { name: "Actions for Notes" }).click();
  await page.getByRole("menuitem", { name: "Open in new window" }).click();
  const popup = await popupPromise;
  await expect(popup.locator("#panefold-surface-root")).toHaveAttribute(
    "data-panefold-ready",
    "true",
  );
  await popup.close();
  const returnedNotesTab = page.locator('[data-workspace-panel-tab="notes"]');
  await expect(returnedNotesTab).toBeVisible();
  await expect(page.locator(".demo-surface-status")).toContainText(
    "returned to the main workspace",
  );
  await expect(page.locator(".pf-live-region")).toHaveText("Notes returned to the main window.");
  await expect(returnedNotesTab).toBeFocused();
});

test("reload closes an external window, restores its panel, and permits a fresh popout", async ({
  page,
}) => {
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("button", { name: "Actions for Notes" }).click();
  await page.getByRole("menuitem", { name: "Open in new window" }).click();
  const popup = await popupPromise;
  await expect(popup.locator("#panefold-surface-root")).toHaveAttribute(
    "data-panefold-ready",
    "true",
  );
  const externalRevision = await revisionOf(page);
  await expect(page.locator("[data-persistence-state='saved']")).toHaveAttribute(
    "data-persisted-revision",
    String(externalRevision),
  );
  const unexpectedPopups: Page[] = [];
  page.on("popup", (candidate) => {
    unexpectedPopups.push(candidate);
  });

  await page.reload();

  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect.poll(() => page.context().pages().length).toBe(1);
  expect(page.context().pages()).toEqual([page]);
  expect(unexpectedPopups).toEqual([]);
  await expect(page.locator('[data-workspace-panel-tab="notes"]')).toBeVisible();
  await expect(page.locator('[data-workspace-panel-host="notes"]')).toBeAttached();
  const recoveredRevision = externalRevision + 1;
  const restorationProof = page.locator("[data-persistence-state='restored']");
  await expect(restorationProof).toContainText(
    `Restored revision ${String(externalRevision)} from IndexedDB · recovered 1 external surface · saved revision ${String(recoveredRevision)}`,
  );
  await expect(restorationProof).toHaveAttribute(
    "data-persisted-revision",
    String(recoveredRevision),
  );
  await expect.poll(() => revisionOf(page)).toBe(recoveredRevision);

  const secondPopupPromise = page.waitForEvent("popup");
  await page.locator('[data-workspace-panel-tab="notes"]').click();
  await page.getByRole("button", { name: "Actions for Notes" }).click();
  await page.getByRole("menuitem", { name: "Open in new window" }).click();
  const secondPopup = await secondPopupPromise;
  await expect(secondPopup.locator("#panefold-surface-root")).toHaveAttribute(
    "data-panefold-ready",
    "true",
  );
  await secondPopup.close();
  await expect(page.locator('[data-workspace-panel-tab="notes"]')).toBeVisible();
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

    await page.getByRole("button", { name: "Workspace appearance" }).click();
    const settings = page.getByRole("dialog", { name: "Workspace appearance" });
    await settings.getByRole("combobox", { name: "Tab rail" }).selectOption("inline-start");
    await settings.getByRole("combobox", { name: "Tab labels" }).selectOption("icon-only");
    await page.getByRole("button", { name: "Workspace appearance" }).click();
    const primaryTablist = page.locator('[data-workspace-group="primary"]').getByRole("tablist");
    await expect(primaryTablist).toHaveAttribute("aria-orientation", "vertical");
    const mapTarget = await requiredBox(primaryTablist.getByRole("tab", { name: "Map Canvas" }));
    expect(mapTarget.width).toBeGreaterThanOrEqual(44);
    expect(mapTarget.height).toBeGreaterThanOrEqual(44);
    await expect(
      primaryTablist.getByRole("tab", { name: "Map Canvas" }).locator(".pf-tab-title"),
    ).toHaveClass(/pf-visually-hidden/);

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
