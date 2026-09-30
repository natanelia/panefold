import { expect, test, type Locator } from "@playwright/test";

async function press(control: Locator) {
  if (test.info().project.use.hasTouch) await control.tap();
  else await control.click();
}

test("panel-local checklist state survives floating, minimization, redocking and history", async ({
  page,
}) => {
  await page.goto("./?fixture=touch");
  await expect(page.locator(".tp-workspace")).toBeVisible();
  await press(page.getByRole("tab", { name: "Checklist", exact: true }));
  const checked = page.getByRole("checkbox", { name: "Move a panel", exact: true });
  await press(checked);
  await expect(checked).toBeChecked();
  await press(page.getByRole("button", { name: "Actions for Checklist", exact: true }));
  await press(page.getByRole("menuitem", { name: "Float Checklist", exact: true }));
  const frame = page.locator(".pf-floating-surface");
  await expect(frame).toBeVisible();
  await expect(checked).toBeChecked();
  await press(frame.getByRole("button", { name: /^Minimize Checklist/ }));
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await press(frame.getByRole("button", { name: /^Restore Checklist/ }));
  await expect(checked).toBeVisible();
  await expect(checked).toBeChecked();
  await press(frame.getByRole("button", { name: /^Maximize Checklist/ }));
  await expect(frame).toHaveAttribute("data-maximized", "true");
  await expect(checked).toBeChecked();
  await press(frame.getByRole("button", { name: /^Restore Checklist/ }));
  await expect(frame).toHaveAttribute("data-maximized", "false");
  await press(frame.getByRole("button", { name: /^Dock Checklist/ }));
  await expect(frame).toHaveCount(0);
  await expect(checked).toBeChecked();
  await press(page.locator(".tp-toolbar").getByRole("button", { name: "Undo", exact: true }));
  await expect(frame).toHaveCount(1);
  await expect(checked).toBeChecked();
  await press(page.locator(".tp-toolbar").getByRole("button", { name: "Redo", exact: true }));
  await expect(frame).toHaveCount(0);
  await expect(checked).toBeChecked();
});
