import { test } from "@playwright/test";
import "./code-workbench-cases";

// Keep legacy Code tasks on the explicit Code example. Change the navigation
// argument, not network traffic: routing can delay popup stylesheet requests.
// The default phone URL is exercised separately by touch-playground-ux.spec.ts.
test.beforeEach(async ({ page }) => {
  const goto = page.goto.bind(page);
  page.goto = (url, options) => goto(url === "/" ? "/?fixture=code" : url, options);
});
