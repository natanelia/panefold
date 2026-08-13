import {
  commandId,
  createKernelState,
  revision,
  type CommandEnvelope,
  type WorkspaceCommand,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import { dispatchKernelState, executeCommand } from "../src/index";
import { fixtureSnapshot, ids } from "./fixtures";

function selectEnvelope(id = "effect:select"): CommandEnvelope {
  const snapshot = fixtureSnapshot();
  return {
    id: commandId(id),
    origin: "application",
    label: "Select panel",
    baseRevision: snapshot.revision,
    command: { type: "select-panel", panelId: ids.panels[1] },
  };
}

describe("kernel post-commit effects", () => {
  it("emits one deterministic immutable intent correlated to the committed transaction", () => {
    const snapshot = fixtureSnapshot();
    const envelope = selectEnvelope();
    const first = executeCommand(snapshot, envelope);
    const repeated = executeCommand(snapshot, envelope);
    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    if (!first.ok || !repeated.ok) return;

    expect(first.effects).toHaveLength(1);
    expect(first.effects).toBe(first.transaction.effects);
    expect(first.patches).toBe(first.transaction.patches);
    expect(first.effects).toEqual(repeated.effects);
    expect(first.effects[0]).toMatchObject({
      id: "effect:v1:transaction-committed:13:effect:select:0:1:0",
      kind: "transaction-committed",
      class: "post-commit-idempotent",
      transactionId: envelope.id,
      previousRevision: revision(0),
      revision: revision(1),
      ordinal: 0,
      payload: { commandType: "select-panel", origin: "application" },
    });
    expect(Object.isFrozen(first.effects)).toBe(true);
    expect(Object.isFrozen(first.effects[0])).toBe(true);
    expect(Object.isFrozen(first.effects[0]?.payload)).toBe(true);
    expect(Object.isFrozen(first.transaction)).toBe(true);
    expect(Object.isFrozen(first.transaction.command)).toBe(true);
    expect(Object.isFrozen(first.patches)).toBe(true);
    expect(first.patches.every(Object.isFrozen)).toBe(true);
    const groupPatch = first.patches.find((patch) => patch.kind === "group");
    expect(groupPatch?.before).toBe(snapshot.groups.byId[String(ids.groups[0])]);
    expect(groupPatch?.after).toBe(first.next.groups.byId[String(ids.groups[0])]);
  });

  it("owns caller command data and freezes every published commit structure", () => {
    const snapshot = fixtureSnapshot();
    const panelIds = [ids.panels[1]];
    const command: Extract<WorkspaceCommand, { readonly type: "reorder-panels" }> = {
      type: "reorder-panels",
      groupId: ids.groups[0],
      panelIds,
      beforePanelId: ids.panels[0],
    };
    const result = executeCommand(snapshot, {
      id: commandId("effect:owned-command"),
      origin: "application",
      label: "Reorder tabs",
      command,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    panelIds[0] = ids.panels[0];
    expect(result.transaction.command).toMatchObject({
      type: "reorder-panels",
      panelIds: [ids.panels[1]],
      beforePanelId: ids.panels[0],
    });
    expect(result.transaction.command).not.toBe(command);
    expect(Object.isFrozen(result.transaction.command)).toBe(true);
    expect(
      Object.isFrozen(
        (result.transaction.command as Extract<WorkspaceCommand, { type: "reorder-panels" }>)
          .panelIds,
      ),
    ).toBe(true);
    expect(() => {
      (result.transaction as { label: string }).label = "Changed";
    }).toThrow(TypeError);
    expect(() => {
      (result.patches as unknown as unknown[]).pop();
    }).toThrow(TypeError);
    expect(() => {
      (result.patches[0] as { kind: string }).kind = "metadata";
    }).toThrow(TypeError);
  });

  it("does not expose an effect for a rejected transaction", () => {
    const snapshot = fixtureSnapshot();
    const result = executeCommand(snapshot, {
      ...selectEnvelope("effect:stale"),
      baseRevision: revision(99),
    });

    expect(result.ok).toBe(false);
    expect("effects" in result).toBe(false);
  });

  it("propagates exact effects through state dispatch and gives undo and redo fresh identities", () => {
    const initial = fixtureSnapshot();
    const selected = dispatchKernelState(createKernelState(initial), selectEnvelope("effect:do"));
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.effects).toBe(selected.transaction.effects);

    const undone = dispatchKernelState(selected.state, {
      id: commandId("effect:undo"),
      origin: "history",
      label: "Undo workspace operation",
      baseRevision: selected.state.snapshot.revision,
      command: { type: "undo-workspace-operation" },
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    const redone = dispatchKernelState(undone.state, {
      id: commandId("effect:redo"),
      origin: "history",
      label: "Redo workspace operation",
      baseRevision: undone.state.snapshot.revision,
      command: { type: "redo-workspace-operation" },
    });
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;

    expect([
      selected.effects[0]?.transactionId,
      undone.effects[0]?.transactionId,
      redone.effects[0]?.transactionId,
    ]).toEqual([commandId("effect:do"), commandId("effect:undo"), commandId("effect:redo")]);
    expect([
      selected.effects[0]?.revision,
      undone.effects[0]?.revision,
      redone.effects[0]?.revision,
    ]).toEqual([revision(1), revision(2), revision(3)]);
    expect(
      new Set([selected.effects[0]?.id, undone.effects[0]?.id, redone.effects[0]?.id]).size,
    ).toBe(3);
    expect(undone.effects[0]?.payload).toEqual({
      commandType: "restore-workspace",
      origin: "history",
    });
    expect(redone.effects[0]?.payload).toEqual({
      commandType: "select-panel",
      origin: "history",
    });
  });

  it("keeps undo and redo bound to the owned command after caller mutation", () => {
    const initial = fixtureSnapshot();
    const panelIds = [ids.panels[1]];
    const command: Extract<WorkspaceCommand, { readonly type: "reorder-panels" }> = {
      type: "reorder-panels",
      groupId: ids.groups[0],
      panelIds,
      beforePanelId: ids.panels[0],
    };
    const committed = dispatchKernelState(createKernelState(initial), {
      id: commandId("effect:history-do"),
      origin: "application",
      label: "Reorder tabs",
      baseRevision: initial.revision,
      command,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    panelIds[0] = ids.panels[0];
    const entry = committed.state.undoStack[0];
    expect(entry?.envelope.command).toMatchObject({ panelIds: [ids.panels[1]] });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.envelope)).toBe(true);

    const undone = dispatchKernelState(committed.state, {
      id: commandId("effect:history-undo"),
      origin: "history",
      label: "Undo",
      command: { type: "undo-workspace-operation" },
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const redone = dispatchKernelState(undone.state, {
      id: commandId("effect:history-redo"),
      origin: "history",
      label: "Redo",
      command: { type: "redo-workspace-operation" },
    });
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;
    expect(redone.state.snapshot.groups.byId[String(ids.groups[0])]?.panelIds).toEqual([
      ids.panels[1],
      ids.panels[0],
    ]);
  });
});
