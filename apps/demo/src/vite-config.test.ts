import { describe, expect, it } from "vitest";

import { isDemoVendorModule } from "../vite.config";

describe("demo bundle boundaries", () => {
  it("keeps application-owned popup creation out of the vendor chunk", () => {
    expect(isDemoVendorModule("/workspace/apps/demo/src/external-panels.ts")).toBe(false);
    expect(
      isDemoVendorModule("/workspace/node_modules/.pnpm/react@19.2.8/node_modules/react/index.js"),
    ).toBe(true);
  });
});
