import { surfaceId } from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  destinationRetainedOutcome,
  returnedPanelOutcome,
  shouldRetainExternalLease,
} from "./external-panels";

describe("external panel transfer recovery disposition", () => {
  it("names a returned panel in both visual status and assistive feedback", () => {
    expect(returnedPanelOutcome("Notes", "requested return")).toEqual({
      announcement: "Notes returned to the main window.",
      statusMessage: "Notes returned to the main workspace after requested return.",
    });
  });

  it("retains the lease when a failed transfer still reports the destination as safe", () => {
    const destination = surfaceId("surface:external");

    expect(shouldRetainExternalLease(destination, destination)).toBe(true);
  });

  it("releases the lease only after ownership is confirmed back in the source", () => {
    expect(
      shouldRetainExternalLease(surfaceId("surface:main"), surfaceId("surface:external")),
    ).toBe(false);
  });

  it("reports destination-retained failures as committed interactions requiring recovery", () => {
    expect(
      destinationRetainedOutcome("Notes", {
        code: "COMPENSATION_FAILED",
        message: "fixture failure",
      }),
    ).toEqual({
      status: "committed",
      message:
        "Notes remains assigned to its external window because automatic rollback could not be confirmed. Use Return to main window to retry recovery.",
    });
  });
});
