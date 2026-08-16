import {
  commandId,
  getEntity,
  groupId,
  nodeId,
  surfaceId,
  type CommandEnvelope,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  executeCommand,
  planGroupDropCommand,
  planPanelDropCommand,
  validateWorkspace,
} from "../src/index";
import { fixtureSnapshot, ids } from "./fixtures";

function execute(snapshot: WorkspaceSnapshot, command: WorkspaceCommand) {
  const envelope: CommandEnvelope = {
    id: commandId(`group-drop:${command.type}`),
    origin: "application",
    label: "Move panel container",
    baseRevision: snapshot.revision,
    command,
  };
  const result = executeCommand(snapshot, envelope);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error.message);
  expect(validateWorkspace(result.next)).toEqual([]);
  return result.next;
}

describe("planGroupDropCommand", () => {
  it("swaps two intact panel containers for a center drop", () => {
    const initial = fixtureSnapshot();
    const plan = planGroupDropCommand(
      initial,
      {
        groupId: ids.groups[0],
        target: { kind: "swap", groupId: ids.groups[1] },
      },
      { splitNodeId: nodeId("unused-for-swap") },
    );

    expect(plan).toEqual({
      ok: true,
      command: {
        type: "swap-groups",
        firstGroupId: ids.groups[0],
        secondGroupId: ids.groups[1],
      },
    });
    if (!plan.ok) throw new Error(plan.message);
    const next = execute(initial, plan.command);
    const root = getEntity(next.nodes, ids.nodes[2]);
    expect(root?.kind).toBe("split");
    if (root?.kind === "split") {
      expect(root.children).toEqual([ids.nodes[1], ids.nodes[0]]);
    }
    expect(getEntity(next.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[0], ids.panels[1]]);
    expect(next.revision).toBe(initial.revision + 1n);
  });

  it("moves a populated panel container beside a target as one command", () => {
    const initial = fixtureSnapshot();
    const splitNodeId = nodeId("node:group-drop");
    const first = planGroupDropCommand(
      initial,
      {
        groupId: ids.groups[0],
        target: {
          kind: "edge",
          groupId: ids.groups[1],
          edge: "block-start",
          ratio: 0.4,
        },
      },
      { splitNodeId },
    );
    const second = planGroupDropCommand(
      initial,
      {
        groupId: ids.groups[0],
        target: {
          kind: "edge",
          groupId: ids.groups[1],
          edge: "block-start",
          ratio: 0.4,
        },
      },
      { splitNodeId },
    );

    expect(second).toEqual(first);
    expect(first).toEqual({
      ok: true,
      command: {
        type: "move-group",
        groupId: ids.groups[0],
        targetGroupId: ids.groups[1],
        edge: "block-start",
        splitNodeId,
        ratio: 0.4,
      },
    });
    if (!first.ok) throw new Error(first.message);
    const next = execute(initial, first.command);
    expect(getEntity(next.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[0], ids.panels[1]]);
    expect(getEntity(next.groups, ids.groups[1])?.panelIds).toEqual([ids.panels[2]]);
  });

  it("rejects detaching the main root beside a floating target while allowing an intact swap", () => {
    const initial = fixtureSnapshot();
    const withFloating = execute(initial, {
      type: "create-floating-surface",
      groupId: ids.groups[0],
      surfaceId: surfaceId("surface:floating"),
      bounds: { x: 40, y: 40, width: 320, height: 240 },
    });

    const edge = planGroupDropCommand(
      withFloating,
      {
        groupId: ids.groups[1],
        target: {
          kind: "edge",
          groupId: ids.groups[0],
          edge: "inline-start",
          ratio: 0.5,
        },
      },
      { splitNodeId: nodeId("node:cross-surface-edge") },
    );
    expect(edge).toMatchObject({ ok: false, code: "INVALID_DROP" });
    expect(
      planPanelDropCommand(
        withFloating,
        {
          panelId: ids.panels[2],
          target: {
            kind: "edge",
            groupId: ids.groups[0],
            edge: "inline-start",
            ratio: 0.5,
          },
        },
        {
          newGroupId: groupId("group:unused"),
          newGroupNodeId: nodeId("node:unused-group"),
          splitNodeId: nodeId("node:cross-surface-panel-edge"),
        },
      ),
    ).toMatchObject({ ok: false, code: "INVALID_DROP" });

    const swap = planGroupDropCommand(
      withFloating,
      {
        groupId: ids.groups[1],
        target: { kind: "swap", groupId: ids.groups[0] },
      },
      { splitNodeId: nodeId("node:unused-swap") },
    );
    expect(swap).toMatchObject({ ok: true, command: { type: "swap-groups" } });
  });

  it("fails closed for missing, self, invalid-ratio, and reused-identity drops", () => {
    const initial = fixtureSnapshot();
    const results = [
      planGroupDropCommand(
        initial,
        {
          groupId: groupId("group:missing"),
          target: { kind: "swap", groupId: ids.groups[0] },
        },
        { splitNodeId: nodeId("node:missing-source") },
      ),
      planGroupDropCommand(
        initial,
        {
          groupId: ids.groups[0],
          target: { kind: "swap", groupId: ids.groups[0] },
        },
        { splitNodeId: nodeId("node:self") },
      ),
      planGroupDropCommand(
        initial,
        {
          groupId: ids.groups[0],
          target: {
            kind: "edge",
            groupId: ids.groups[1],
            edge: "inline-end",
            ratio: 0,
          },
        },
        { splitNodeId: nodeId("node:ratio") },
      ),
      planGroupDropCommand(
        initial,
        {
          groupId: ids.groups[0],
          target: {
            kind: "edge",
            groupId: ids.groups[1],
            edge: "inline-end",
            ratio: 0.5,
          },
        },
        { splitNodeId: ids.nodes[2] },
      ),
    ];

    expect(results.map((result) => (result.ok ? "ok" : result.code))).toEqual([
      "SOURCE_GROUP_NOT_FOUND",
      "INVALID_DROP",
      "INVALID_DROP",
      "INVALID_DROP",
    ]);
    results.forEach((result) => expect(Object.isFrozen(result)).toBe(true));
  });
});
