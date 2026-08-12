import { revision } from "@panefold/model";
import { describe, expect, it } from "vitest";

import { BoundedProtocolTrace, createProtocolScope } from "../src";

describe("driver-neutral protocol contracts", () => {
  it("bounds diagnostic history without changing protocol ordering", () => {
    const trace = new BoundedProtocolTrace<"idle" | "active", "START" | "END">(2);
    trace.record({
      protocolId: "drag:1",
      state: "idle",
      event: "START",
      revision: revision(0),
      timestamp: 0,
    });
    trace.record({
      protocolId: "drag:1",
      state: "active",
      event: "END",
      revision: revision(0),
      timestamp: 1,
    });
    trace.record({
      protocolId: "drag:2",
      state: "idle",
      event: "START",
      revision: revision(1),
      timestamp: 2,
    });

    expect(trace.snapshot().map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it("propagates parent cancellation and closes idempotently", () => {
    const parent = new AbortController();
    const scope = createProtocolScope(parent.signal);
    parent.abort("surface-disposed");
    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBe("surface-disposed");
    scope.close("duplicate");
    expect(scope.signal.reason).toBe("surface-disposed");
  });
});
