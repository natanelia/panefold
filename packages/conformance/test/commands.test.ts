import { WORKSPACE_COMMAND_TYPES } from "../../model/src";
import { describe, expect, it } from "vitest";

import documentedCommands from "../../../conformance/commands.json";
import { auditCommandRegistry } from "../src";

describe("command registry parity", () => {
  it("keeps the published registry in exact parity with the exhaustive model inventory", () => {
    const report = auditCommandRegistry(WORKSPACE_COMMAND_TYPES, documentedCommands.commands);

    expect(report.expected).toHaveLength(36);
    expect(report.documented).toHaveLength(36);
    expect(report.missing).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it("accepts complete caller-owned metadata without depending on model internals", () => {
    const registry = WORKSPACE_COMMAND_TYPES.map((type) => ({
      type,
      status: "experimental-implemented",
      execution:
        type === "undo-workspace-operation" || type === "redo-workspace-operation"
          ? "dispatchKernelState"
          : "executeCommand",
      limitations: [],
    }));

    const report = auditCommandRegistry(WORKSPACE_COMMAND_TYPES, registry);
    expect(report.missing).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(report.duplicate).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it("rejects duplicate, invented, and internally contradictory entries", () => {
    const report = auditCommandRegistry(
      ["known"],
      [
        {
          type: "known",
          status: "experimental-implemented",
          execution: "executeCommand",
          limitations: [],
        },
        {
          type: "known",
          status: "experimental-implemented",
          execution: "executeCommand",
          limitations: [],
        },
        {
          type: "invented",
          status: "experimental-implemented",
          execution: "executeCommand",
          limitations: [],
        },
        {
          type: "disabled",
          status: "unsupported",
          execution: "executeCommand",
          limitations: [],
        },
      ],
    );

    expect(report.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_DOCUMENTED_COMMAND",
        "UNKNOWN_DOCUMENTED_COMMAND",
        "UNSUPPORTED_COMMAND_HAS_EXECUTION",
        "UNSUPPORTED_COMMAND_WITHOUT_REASON",
      ]),
    );
  });
});
