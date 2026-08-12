import fc from "fast-check";
import {
  commandId,
  createKernelState,
  getEntity,
  groupId,
  nodeId,
  panelId,
  type CommandEnvelope,
  type LogicalEdge,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  dispatchKernelState,
  executeCommand,
  planPanelDropCommand,
  semanticHash,
  validateWorkspace,
  type PanelDropIds,
  type PanelDropIntent,
} from "../src/index";
import { fixtureSnapshot, ids } from "./fixtures";

let sequence = 0;

function envelope(snapshot: WorkspaceSnapshot, command: WorkspaceCommand): CommandEnvelope {
  sequence += 1;
  return {
    id: commandId(`drop-plan:${String(sequence)}`),
    origin: "application",
    label: "Drop panel",
    baseRevision: snapshot.revision,
    command,
  };
}

function plannedIds(suffix: string): PanelDropIds {
  return {
    newGroupId: groupId(`group:drop:${suffix}`),
    newGroupNodeId: nodeId(`node:drop-group:${suffix}`),
    splitNodeId: nodeId(`node:drop-split:${suffix}`),
  };
}

function requirePlan(
  snapshot: WorkspaceSnapshot,
  intent: PanelDropIntent,
  dropIds = plannedIds(String(sequence + 1)),
) {
  const result = planPanelDropCommand(snapshot, intent, dropIds);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.message);
  return result;
}

function executePlan(snapshot: WorkspaceSnapshot, intent: PanelDropIntent, dropIds?: PanelDropIds) {
  const plan = requirePlan(snapshot, intent, dropIds);
  const result = executeCommand(snapshot, envelope(snapshot, plan.command));
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error.message);
  expect(validateWorkspace(result.next)).toEqual([]);
  return { plan, result };
}

describe("planPanelDropCommand", () => {
  it("plans center drops as relational panel moves, including sole-source cleanup", () => {
    const initial = fixtureSnapshot();
    const moved = executePlan(initial, {
      panelId: ids.panels[0],
      target: {
        kind: "center",
        groupId: ids.groups[1],
        beforePanelId: ids.panels[2],
      },
    });

    expect(moved.plan.command).toEqual({
      type: "move-panel",
      panelId: ids.panels[0],
      target: { groupId: ids.groups[1], beforePanelId: ids.panels[2] },
      select: true,
      activate: true,
    });
    expect(getEntity(moved.result.next.groups, ids.groups[1])?.panelIds).toEqual([
      ids.panels[0],
      ids.panels[2],
    ]);

    const soleSource = executePlan(initial, {
      panelId: ids.panels[2],
      target: { kind: "center", groupId: ids.groups[0] },
    });
    expect(soleSource.plan.command.type).toBe("move-panel");
    expect(getEntity(soleSource.result.next.groups, ids.groups[1])).toBeUndefined();
    expect(getEntity(soleSource.result.next.groups, ids.groups[0])?.panelIds).toEqual([
      ids.panels[0],
      ids.panels[1],
      ids.panels[2],
    ]);
  });

  it("plans a same-group edge drop as one split-group command", () => {
    const dropIds = plannedIds("same-group");
    const { plan, result } = executePlan(
      fixtureSnapshot(),
      {
        panelId: ids.panels[1],
        target: {
          kind: "edge",
          groupId: ids.groups[0],
          edge: "block-start",
          ratio: 0.35,
        },
      },
      dropIds,
    );

    expect(plan.command).toMatchObject({
      type: "split-group",
      targetGroupId: ids.groups[0],
      panelIds: [ids.panels[1]],
      ...dropIds,
      edge: "block-start",
      ratio: 0.35,
    });
    expect(getEntity(result.next.groups, dropIds.newGroupId)?.panelIds).toEqual([ids.panels[1]]);
  });

  it("plans a cross-group edge drop atomically without exposing an intermediate state", () => {
    const initial = fixtureSnapshot();
    const dropIds = plannedIds("cross-group");
    const { plan, result } = executePlan(
      initial,
      {
        panelId: ids.panels[0],
        target: {
          kind: "edge",
          groupId: ids.groups[1],
          edge: "block-end",
          ratio: 0.4,
        },
      },
      dropIds,
    );

    expect(plan.command).toMatchObject({
      type: "batch",
      commands: [
        {
          type: "move-panel",
          panelId: ids.panels[0],
          target: { groupId: ids.groups[1] },
        },
        {
          type: "split-group",
          targetGroupId: ids.groups[1],
          panelIds: [ids.panels[0]],
          ...dropIds,
        },
      ],
    });
    expect(result.next.revision).toBe(initial.revision + 1n);
    expect(getEntity(result.next.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[1]]);
    expect(getEntity(result.next.groups, ids.groups[1])?.panelIds).toEqual([ids.panels[2]]);
    expect(getEntity(result.next.groups, dropIds.newGroupId)?.panelIds).toEqual([ids.panels[0]]);
  });

  it("moves a sole-source group as a unit for an edge drop", () => {
    const dropIds = plannedIds("whole-group");
    const { plan, result } = executePlan(
      fixtureSnapshot(),
      {
        panelId: ids.panels[2],
        target: {
          kind: "edge",
          groupId: ids.groups[0],
          edge: "inline-start",
          ratio: 0.3,
        },
      },
      dropIds,
    );

    expect(plan.command).toEqual({
      type: "move-group",
      groupId: ids.groups[1],
      targetGroupId: ids.groups[0],
      edge: "inline-start",
      splitNodeId: dropIds.splitNodeId,
      ratio: 0.3,
    });
    expect(getEntity(result.next.groups, ids.groups[1])?.panelIds).toEqual([ids.panels[2]]);
  });

  it("returns frozen typed rejections for invalid topology, anchors, ratios, and IDs", () => {
    const initial = fixtureSnapshot();
    const cases = [
      planPanelDropCommand(
        initial,
        {
          panelId: panelId("panel:missing"),
          target: { kind: "center", groupId: ids.groups[0] },
        },
        plannedIds("missing-panel"),
      ),
      planPanelDropCommand(
        initial,
        {
          panelId: ids.panels[0],
          target: { kind: "center", groupId: groupId("group:missing") },
        },
        plannedIds("missing-group"),
      ),
      planPanelDropCommand(
        initial,
        {
          panelId: ids.panels[0],
          target: {
            kind: "center",
            groupId: ids.groups[0],
            beforePanelId: ids.panels[1],
            afterPanelId: ids.panels[1],
          },
        },
        plannedIds("anchors"),
      ),
      planPanelDropCommand(
        initial,
        {
          panelId: ids.panels[0],
          target: {
            kind: "edge",
            groupId: ids.groups[0],
            edge: "inline-end",
            ratio: Number.MIN_VALUE,
          },
        },
        plannedIds("tiny-ratio"),
      ),
      planPanelDropCommand(
        initial,
        {
          panelId: ids.panels[0],
          target: {
            kind: "edge",
            groupId: ids.groups[0],
            edge: "inline-end",
            ratio: 0.5,
          },
        },
        {
          newGroupId: groupId("group:alias"),
          newGroupNodeId: nodeId("node:alias"),
          splitNodeId: nodeId("node:alias"),
        },
      ),
    ];

    expect(cases.map((result) => (result.ok ? "ok" : result.code))).toEqual([
      "PANEL_NOT_FOUND",
      "TARGET_GROUP_NOT_FOUND",
      "INVALID_DROP",
      "INVALID_DROP",
      "INVALID_DROP",
    ]);
    cases.forEach((result) => expect(Object.isFrozen(result)).toBe(true));

    const accepted = requirePlan(initial, {
      panelId: ids.panels[0],
      target: { kind: "center", groupId: ids.groups[1] },
    });
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.command)).toBe(true);
    expect(semanticHash(initial)).toBe(semanticHash(fixtureSnapshot()));
  });

  it("is invariant-safe and deterministic for every edge and representable ratio", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<LogicalEdge>("inline-start", "inline-end", "block-start", "block-end"),
        fc.integer({ min: 1, max: 999_999 }),
        (edge, ratioWeight) => {
          const initial = fixtureSnapshot();
          const intent: PanelDropIntent = {
            panelId: ids.panels[0],
            target: {
              kind: "edge",
              groupId: ids.groups[1],
              edge,
              ratio: ratioWeight / 1_000_000,
            },
          };
          const dropIds = plannedIds("property");
          const first = planPanelDropCommand(initial, intent, dropIds);
          const second = planPanelDropCommand(initial, intent, dropIds);
          expect(second).toEqual(first);
          if (!first.ok) throw new Error(first.message);
          const executed = executeCommand(initial, envelope(initial, first.command));
          expect(executed).toMatchObject({ ok: true });
          if (!executed.ok) throw new Error(executed.error.message);
          expect(validateWorkspace(executed.next)).toEqual([]);
        },
      ),
      { numRuns: 250 },
    );
  });

  it("keeps a planned structural drop atomic across undo and redo", () => {
    const initial = fixtureSnapshot();
    const plan = requirePlan(
      initial,
      {
        panelId: ids.panels[0],
        target: {
          kind: "edge",
          groupId: ids.groups[1],
          edge: "block-end",
          ratio: 0.4,
        },
      },
      plannedIds("history"),
    );
    const committed = dispatchKernelState(
      createKernelState(initial, 4),
      envelope(initial, plan.command),
    );
    expect(committed).toMatchObject({ ok: true });
    if (!committed.ok) throw new Error(committed.error.message);
    const committedHash = semanticHash(committed.state.snapshot);

    const undone = dispatchKernelState(
      committed.state,
      envelope(committed.state.snapshot, { type: "undo-workspace-operation" }),
    );
    expect(undone).toMatchObject({ ok: true });
    if (!undone.ok) throw new Error(undone.error.message);
    expect(semanticHash(undone.state.snapshot)).toBe(semanticHash(initial));

    const redone = dispatchKernelState(
      undone.state,
      envelope(undone.state.snapshot, { type: "redo-workspace-operation" }),
    );
    expect(redone).toMatchObject({ ok: true });
    if (!redone.ok) throw new Error(redone.error.message);
    expect(semanticHash(redone.state.snapshot)).toBe(committedHash);
  });
});
