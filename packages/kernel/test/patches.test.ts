import {
  commandId,
  createWorkspaceSnapshot,
  revision,
  type CommandEnvelope,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  applyPatches,
  applyTransaction,
  canonicalHash,
  executeCommand,
  invertPatches,
  semanticHash,
} from "../src/index";
import { fixtureSnapshot, ids } from "./fixtures";

describe("incremental patch projection", () => {
  it("reconstructs the reference result while retaining untouched tables", () => {
    const initial = fixtureSnapshot();
    const envelope: CommandEnvelope = {
      id: commandId("patch:select"),
      origin: "application",
      label: "Select panel",
      baseRevision: initial.revision,
      command: { type: "select-panel", panelId: ids.panels[1] },
    };
    const result = executeCommand(initial, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const projected = applyTransaction(initial, result.transaction);
    expect(canonicalHash(projected)).toBe(canonicalHash(result.next));
    expect(projected.panels).toBe(initial.panels);
    expect(projected.nodes).toBe(initial.nodes);
    expect(projected.surfaces).toBe(initial.surfaces);
    expect(projected.groups).not.toBe(initial.groups);
  });

  it("inverts a complete patch set and rejects stale or reordered application", () => {
    const initial = fixtureSnapshot();
    const result = executeCommand(initial, {
      id: commandId("patch:close"),
      origin: "application",
      label: "Close panel",
      baseRevision: initial.revision,
      command: {
        type: "move-panel",
        panelId: ids.panels[1],
        target: { groupId: ids.groups[1], beforePanelId: ids.panels[2] },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const restored = applyPatches(
      result.next,
      invertPatches(result.patches),
      revision(result.next.revision + 1n),
    );
    expect(semanticHash(restored)).toBe(semanticHash(initial));

    expect(() => applyTransaction(result.next, result.transaction)).toThrow(/expects revision/);
    expect(() =>
      applyPatches(result.next, result.patches, revision(result.next.revision + 1n)),
    ).toThrow(/precondition/);
  });

  it("projects schema and application-layout version changes", () => {
    const initial = fixtureSnapshot();
    const replacement = createWorkspaceSnapshot({
      schemaVersion: 3,
      applicationLayoutVersion: 3,
      panels: initial.panels.ids
        .map((id) => initial.panels.byId[id])
        .filter((item) => item !== undefined),
      groups: initial.groups.ids
        .map((id) => initial.groups.byId[id])
        .filter((item) => item !== undefined),
      nodes: initial.nodes.ids
        .map((id) => initial.nodes.byId[id])
        .filter((item) => item !== undefined),
      surfaces: initial.surfaces.ids
        .map((id) => initial.surfaces.byId[id])
        .filter((item) => item !== undefined),
      activation: initial.activation,
      focusMemory: initial.focusMemory,
    });
    const result = executeCommand(initial, {
      id: commandId("patch:versions"),
      origin: "restore",
      label: "Restore migrated workspace",
      baseRevision: initial.revision,
      command: { type: "restore-workspace", snapshot: replacement },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const projected = applyTransaction(initial, result.transaction);
    expect(projected.schemaVersion).toBe(3);
    expect(projected.applicationLayoutVersion).toBe(3);
    expect(canonicalHash(projected)).toBe(canonicalHash(result.next));
  });
});
