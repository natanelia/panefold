import { describe, expect, it } from "vitest";

import { benchmarkPanelGroupLookups } from "../src/index";
import { fixtureIds, fixtureSnapshot } from "./fixtures";

describe("projection lookup benchmark harness", () => {
  it("executes equivalent canonical scans and indexed lookups", () => {
    const result = benchmarkPanelGroupLookups(fixtureSnapshot(), fixtureIds.panels, 200);
    expect(result.lookups).toBe(600);
    expect(result.canonicalChecksum).toBe(result.indexedChecksum);
    expect(Number.isFinite(result.canonicalScanMilliseconds)).toBe(true);
    expect(Number.isFinite(result.indexedLookupMilliseconds)).toBe(true);
    expect(result.canonicalScanMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.indexedLookupMilliseconds).toBeGreaterThanOrEqual(0);
  });
});
