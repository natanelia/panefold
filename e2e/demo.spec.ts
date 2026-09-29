import { test } from "@playwright/test";
import "./code-workbench-cases";

// Keep the established Code regression suite on the explicit Code example.
// The unqualified phone entry point is covered by touch-playground-ux.spec.ts.
// Redirect only the suite's root navigation; do not mock application responses.
test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/" && url.search === "",
    async (route) => {
      const destination = new URL(route.request().url());
      destination.searchParams.set("fixture", "code");
      await route.fulfill({ status: 302, headers: { location: destination.href } });
    },
  );
});
