import {
  closedPanelId,
  commandId,
  type CommandEnvelope,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  applyTransaction,
  canonicalHash,
  canonicalizeWorkspace,
  executeCommand,
  semanticHash,
  validateWorkspace,
} from "../src/index";
import { fixtureSnapshot } from "./fixtures";

function candidateCommands(snapshot: WorkspaceSnapshot): readonly WorkspaceCommand[] {
  const commands: WorkspaceCommand[] = [];
  for (const panelId of snapshot.panels.ids) {
    commands.push({ type: "select-panel", panelId });
    for (const groupId of snapshot.groups.ids) {
      commands.push({ type: "move-panel", panelId, target: { groupId } });
    }
    if (
      !snapshot.recoverableClosedPanels.some(
        (record) => record.id === closedPanelId(`explore:${panelId}`),
      )
    ) {
      commands.push({
        type: "close-panels",
        targets: [{ panelId, closedPanelId: closedPanelId(`explore:${panelId}`) }],
      });
    }
  }
  for (const record of snapshot.recoverableClosedPanels) {
    commands.push({ type: "reopen-panel", closedPanelId: record.id });
  }
  for (const groupId of snapshot.groups.ids) {
    const group = snapshot.groups.byId[groupId];
    if (group !== undefined && group.panelIds.length >= 2) {
      const last = group.panelIds.at(-1);
      const first = group.panelIds[0];
      if (last !== undefined && first !== undefined) {
        commands.push({
          type: "reorder-panels",
          groupId,
          panelIds: [last],
          beforePanelId: first,
        });
      }
    }
  }
  return commands;
}

function envelope(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
  id: number,
): CommandEnvelope {
  return {
    id: commandId(`exploration:${id}`),
    origin: "application",
    label: command.type,
    baseRevision: snapshot.revision,
    command,
  };
}

describe("bounded exhaustive model exploration", () => {
  it("checks every transition through depth four against canonical, patch, and inverse oracles", () => {
    const seen = new Map<string, WorkspaceSnapshot>();
    const initial = fixtureSnapshot();
    seen.set(semanticHash(initial), initial);
    let frontier = [initial];
    let transitions = 0;

    for (let depth = 0; depth < 4; depth += 1) {
      const nextFrontier: WorkspaceSnapshot[] = [];
      for (const snapshot of frontier) {
        for (const command of candidateCommands(snapshot)) {
          transitions += 1;
          const first = executeCommand(snapshot, envelope(snapshot, command, transitions));

          if (!first.ok) {
            continue;
          }

          expect(validateWorkspace(first.next)).toEqual([]);
          expect(canonicalHash(applyTransaction(snapshot, first.transaction))).toBe(
            canonicalHash(first.next),
          );

          const canonicalAgain = canonicalizeWorkspace(first.next).snapshot;
          expect(canonicalHash(canonicalAgain)).toBe(canonicalHash(first.next));

          const inverse = first.inverse;
          if (inverse === undefined) {
            throw new Error("Every explored operation must be reversible");
          }
          const restored = executeCommand(
            first.next,
            envelope(first.next, inverse, transitions + 2_000_000),
          );
          expect(restored.ok).toBe(true);
          if (!restored.ok) throw new Error(restored.error.message);
          expect(semanticHash(restored.next)).toBe(semanticHash(snapshot));

          const hash = semanticHash(first.next);
          if (!seen.has(hash)) {
            seen.set(hash, first.next);
            nextFrontier.push(first.next);
          }
        }
      }
      frontier = nextFrontier;
    }

    expect(seen.size).toBeGreaterThan(100);
    expect(transitions).toBeGreaterThan(500);
  }, 20_000);
});
