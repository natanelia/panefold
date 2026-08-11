import {
  commandId,
  createWorkspaceSnapshot,
  panelId,
  revision,
  type WorkspaceCommand,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import { evaluatePolicies, type WorkspacePolicy } from "../src";

describe("policy evaluation", () => {
  it("is deterministic by priority and policy id", () => {
    const command: WorkspaceCommand = {
      type: "select-panel",
      panelId: panelId("panel:map"),
    };
    const order: string[] = [];
    const policy = (id: string, priority: number): WorkspacePolicy => ({
      id,
      priority,
      evaluate: (_snapshot, _envelope, current) => {
        order.push(id);
        return { kind: "allow", command: current };
      },
    });
    const snapshot = createWorkspaceSnapshot({ revision: revision(4) });
    const result = evaluatePolicies(
      snapshot,
      { id: commandId("cmd:1"), origin: "application", label: "Select", command },
      [policy("z", 10), policy("b", 0), policy("a", 0)],
    );
    expect(result.ok).toBe(true);
    expect(order).toEqual(["a", "b", "z"]);
  });

  it("returns actionable typed denial", () => {
    const command: WorkspaceCommand = {
      type: "select-panel",
      panelId: panelId("panel:map"),
    };
    const result = evaluatePolicies(
      createWorkspaceSnapshot(),
      { id: commandId("cmd:2"), origin: "pointer", label: "Select", command },
      [
        {
          id: "readonly",
          priority: 0,
          evaluate: () => ({ kind: "deny", code: "READ_ONLY", reason: "Layout is read-only." }),
        },
      ],
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED", details: { policyId: "readonly" } },
    });
  });
});
