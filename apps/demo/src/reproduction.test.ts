import { describe, expect, it } from "vitest";
import { createWorkspaceRuntime } from "@panefold/runtime";

import { createRedactedReproduction } from "./reproduction";
import { initialWorkspaceSnapshot } from "./workspace-config";

describe("demo reproduction export", () => {
  it("omits caller-controlled transaction labels and panel payloads", () => {
    const runtime = createWorkspaceRuntime({ initialSnapshot: initialWorkspaceSnapshot });
    const panelId = initialWorkspaceSnapshot.panels.ids[0];
    if (panelId === undefined) throw new Error("Demo fixture requires a panel");

    runtime.dispatch(
      { type: "select-panel", panelId, activate: true },
      { origin: "application", label: "customer-secret-label" },
    );

    const serialized = JSON.stringify(createRedactedReproduction(runtime, "ltr"));
    expect(serialized).not.toContain("customer-secret-label");
    expect(serialized).not.toContain("parameters");
    expect(serialized).toContain('"type":"select-panel"');
    runtime.dispose();
  });
});
