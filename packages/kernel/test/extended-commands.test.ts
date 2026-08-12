import {
  MAIN_SURFACE_CAPABILITIES,
  closedPanelId,
  commandId,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type CommandEnvelope,
  type PanelRecord,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import {
  applyTransaction,
  canonicalHash,
  executeCommand,
  semanticHash,
  validateWorkspace,
} from "../src/index";
import { fixtureSnapshot, ids, panel } from "./fixtures";

let sequence = 0;

function envelope(snapshot: WorkspaceSnapshot, command: WorkspaceCommand): CommandEnvelope {
  sequence += 1;
  return {
    id: commandId(`extended:${sequence}`),
    origin: "application",
    label: command.type,
    baseRevision: snapshot.revision,
    command,
  };
}

function execute(snapshot: WorkspaceSnapshot, command: WorkspaceCommand) {
  const result = executeCommand(snapshot, envelope(snapshot, command));
  if (!result.ok) throw new Error(result.error.message);
  expect(result.ok).toBe(true);
  expect(validateWorkspace(result.next)).toEqual([]);
  expect(canonicalHash(applyTransaction(snapshot, result.transaction))).toBe(
    canonicalHash(result.next),
  );
  return result;
}

function mapPanels(
  snapshot: WorkspaceSnapshot,
  transform: (panel: PanelRecord) => PanelRecord,
): WorkspaceSnapshot {
  return createWorkspaceSnapshot({
    schemaVersion: snapshot.schemaVersion,
    applicationLayoutVersion: snapshot.applicationLayoutVersion,
    revision: snapshot.revision,
    panels: snapshot.panels.ids.map((id) => transform(snapshot.panels.byId[id] as PanelRecord)),
    groups: snapshot.groups.ids
      .map((id) => snapshot.groups.byId[id])
      .filter((item) => item !== undefined),
    nodes: snapshot.nodes.ids
      .map((id) => snapshot.nodes.byId[id])
      .filter((item) => item !== undefined),
    surfaces: snapshot.surfaces.ids
      .map((id) => snapshot.surfaces.byId[id])
      .filter((item) => item !== undefined),
    activation: snapshot.activation,
    focusMemory: snapshot.focusMemory,
    floatingOrder: snapshot.floatingOrder,
    recoverableClosedPanels: snapshot.recoverableClosedPanels,
    appliedRemoteTransactions: snapshot.appliedRemoteTransactions,
    metadata: snapshot.metadata,
  });
}

function onePanelWorkspace(prefix: string): WorkspaceSnapshot {
  const panelRecord = panel(panelId(`${prefix}:panel`));
  const group = {
    id: groupId(`${prefix}:group`),
    panelIds: [panelRecord.id],
    selectedPanelId: panelRecord.id,
    persistent: false,
  } as const;
  const node = { kind: "group", id: nodeId(`${prefix}:node`), groupId: group.id } as const;
  const surface = {
    id: surfaceId(`${prefix}:surface`),
    kind: "main",
    rootNodeId: node.id,
    capabilities: MAIN_SURFACE_CAPABILITIES,
    maximized: false,
  } as const;
  return createWorkspaceSnapshot({
    panels: [panelRecord],
    groups: [group],
    nodes: [node],
    surfaces: [surface],
    activation: { activePanelId: panelRecord.id, activeSurfaceId: surface.id },
    focusMemory: { panelId: panelRecord.id, groupId: group.id, fallback: "panel-root" },
  });
}

describe("extended command catalog", () => {
  it("takes immutable ownership of command-supplied panel data", () => {
    const initial = fixtureSnapshot();
    const parameters = { nested: { values: [1, 2] } };
    const constraints = { hardMinInline: 90, preferredInline: 240 };
    const suppliedPanel = {
      ...panel(panelId("panel:caller-owned"), "Before"),
      parameters,
      constraints,
    };
    const committed = execute(initial, {
      type: "open-panel",
      panel: suppliedPanel,
      placement: { groupId: ids.groups[0] },
    }).next;

    suppliedPanel.title = "After";
    parameters.nested.values.push(3);
    constraints.hardMinInline = 999;

    const stored = getEntity(committed.panels, suppliedPanel.id);
    expect(stored?.title).toBe("Before");
    expect(stored?.parameters).toEqual({ nested: { values: [1, 2] } });
    expect(stored?.constraints.hardMinInline).toBe(90);
    expect(stored).not.toBe(suppliedPanel);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(
      Object.isFrozen(
        (stored?.parameters as { readonly nested: { readonly values: readonly number[] } }).nested
          .values,
      ),
    ).toBe(true);
  });

  it("runs a dependent batch atomically and rejects an invalid batch without partial state", () => {
    const initial = fixtureSnapshot();
    const duplicateId = panelId("panel:duplicate");
    const committed = execute(initial, {
      type: "batch",
      commands: [
        {
          type: "duplicate-panel",
          panelId: ids.panels[0],
          duplicatePanelId: duplicateId,
        },
        {
          type: "move-panel",
          panelId: duplicateId,
          target: { groupId: ids.groups[1] },
        },
      ],
    });

    expect(committed.next.revision).toBe(initial.revision + 1n);
    expect(getEntity(committed.next.groups, ids.groups[1])?.panelIds).toContain(duplicateId);

    const rejected = executeCommand(
      initial,
      envelope(initial, {
        type: "batch",
        commands: [
          {
            type: "duplicate-panel",
            panelId: ids.panels[0],
            duplicatePanelId: duplicateId,
          },
          { type: "select-panel", panelId: panelId("panel:missing") },
        ],
      }),
    );
    expect(rejected).toMatchObject({ ok: false, error: { code: "ENTITY_NOT_FOUND" } });
    expect(semanticHash(initial)).toBe(semanticHash(fixtureSnapshot()));
  });

  it("derives close-other and close-to-right from current tab order without caller drift", () => {
    const initial = fixtureSnapshot();
    const closedOther = execute(initial, {
      type: "close-other-panels",
      groupId: ids.groups[0],
      exceptPanelId: ids.panels[0],
      targets: [{ panelId: ids.panels[1], closedPanelId: closedPanelId("closed:two") }],
    }).next;
    expect(getEntity(closedOther.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[0]]);

    const duplicateId = panelId("panel:between");
    const withDuplicate = execute(initial, {
      type: "duplicate-panel",
      panelId: ids.panels[0],
      duplicatePanelId: duplicateId,
    }).next;
    const closedRight = execute(withDuplicate, {
      type: "close-panels-to-right",
      groupId: ids.groups[0],
      panelId: ids.panels[0],
      targets: [
        { panelId: duplicateId, closedPanelId: closedPanelId("closed:between") },
        { panelId: ids.panels[1], closedPanelId: closedPanelId("closed:right") },
      ],
    }).next;
    expect(getEntity(closedRight.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[0]]);

    const drifted = executeCommand(
      withDuplicate,
      envelope(withDuplicate, {
        type: "close-panels-to-right",
        groupId: ids.groups[0],
        panelId: ids.panels[0],
        targets: [{ panelId: ids.panels[1], closedPanelId: closedPanelId("closed:wrong") }],
      }),
    );
    expect(drifted).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("retains one canonical placeholder so closing the final panels is reversible", () => {
    const initial = fixtureSnapshot();
    const closed = execute(initial, {
      type: "close-panels",
      targets: ids.panels.map((id, index) => ({
        panelId: id,
        closedPanelId: closedPanelId(`closed:all:${index}`),
      })),
    }).next;

    expect(closed.panels.ids).toEqual([]);
    expect(closed.groups.ids).toHaveLength(1);
    expect(closed.groups.byId[closed.groups.ids[0] as string]?.placeholder).toBe(true);

    const reopened = execute(closed, {
      type: "reopen-panel",
      closedPanelId: closedPanelId("closed:all:2"),
    }).next;
    expect(getEntity(reopened.panels, ids.panels[2])).toBeDefined();
    expect(reopened.groups.byId[reopened.groups.ids[0] as string]?.placeholder).toBeUndefined();
  });

  it("swaps and moves whole groups while preserving single topology ownership", () => {
    const initial = fixtureSnapshot();
    const swapped = execute(initial, {
      type: "swap-groups",
      firstGroupId: ids.groups[0],
      secondGroupId: ids.groups[1],
    }).next;
    expect(getEntity(swapped.nodes, ids.nodes[2])).toMatchObject({
      children: [ids.nodes[1], ids.nodes[0]],
    });

    const moved = execute(initial, {
      type: "move-group",
      groupId: ids.groups[1],
      targetGroupId: ids.groups[0],
      edge: "block-end",
      splitNodeId: nodeId("node:moved-group"),
      ratio: 0.35,
    }).next;
    expect(getEntity(moved.surfaces, ids.surface)?.rootNodeId).toBe(nodeId("node:moved-group"));
    expect(getEntity(moved.nodes, nodeId("node:moved-group"))).toMatchObject({
      kind: "split",
      axis: "block",
      children: [ids.nodes[0], ids.nodes[1]],
    });
  });

  it("equalizes a subset and collapses only explicitly eligible children", () => {
    const split = execute(fixtureSnapshot(), {
      type: "split-group",
      targetGroupId: ids.groups[0],
      panelIds: [ids.panels[1]],
      newGroupId: groupId("group:third"),
      newGroupNodeId: nodeId("node:third"),
      splitNodeId: nodeId("node:flattened"),
      edge: "inline-end",
      ratio: 0.25,
    }).next;
    const resized = execute(split, {
      type: "resize-split",
      splitNodeId: ids.nodes[2],
      weights: [1, 3, 6],
    }).next;
    const root = getEntity(resized.nodes, ids.nodes[2]);
    if (root?.kind !== "split") throw new Error("Expected a split root");
    const equalized = execute(resized, {
      type: "equalize-split",
      splitNodeId: root.id,
      childIds: [
        root.children[0] as (typeof root.children)[number],
        root.children[1] as (typeof root.children)[number],
      ],
    }).next;
    expect(getEntity(equalized.nodes, root.id)).toMatchObject({
      weights: [200_000, 200_000, 600_000],
    });

    const collapsible = mapPanels(fixtureSnapshot(), (record) => ({
      ...record,
      constraints: { ...record.constraints, collapsible: true },
    }));
    const collapsed = execute(collapsible, {
      type: "collapse-child",
      splitNodeId: ids.nodes[2],
      childNodeId: ids.nodes[1],
      reason: "compact-mode",
    }).next;
    expect(getEntity(collapsed.nodes, ids.nodes[2])).toMatchObject({
      collapsedChildIds: [ids.nodes[1]],
    });
    const restored = execute(collapsed, {
      type: "restore-collapsed-child",
      splitNodeId: ids.nodes[2],
      childNodeId: ids.nodes[1],
    }).next;
    expect(getEntity(restored.nodes, ids.nodes[2])).toMatchObject({ collapsedChildIds: [] });
  });

  it("minimizes floating surfaces and transfers external ownership exactly once", () => {
    const floatingId = surfaceId("surface:float");
    const floated = execute(fixtureSnapshot(), {
      type: "create-floating-surface",
      groupId: ids.groups[1],
      surfaceId: floatingId,
      bounds: { x: 10, y: 20, width: 400, height: 300 },
    }).next;
    const minimized = execute(floated, { type: "minimize-surface", surfaceId: floatingId }).next;
    expect(getEntity(minimized.surfaces, floatingId)?.minimized).toBe(true);
    const restored = execute(minimized, { type: "restore-surface", surfaceId: floatingId }).next;
    expect(getEntity(restored.surfaces, floatingId)?.minimized).toBeUndefined();

    const transferable = mapPanels(fixtureSnapshot(), (record) =>
      record.id === ids.panels[2]
        ? { ...record, capabilities: { ...record.capabilities, popout: true } }
        : record,
    );
    const browserId = surfaceId("surface:browser");
    const transferred = execute(transferable, {
      type: "transfer-to-browser-window",
      groupId: ids.groups[1],
      surfaceId: browserId,
      ownerEpoch: 7,
      preparedSurfaceToken: "prepared:browser",
    }).next;
    expect(getEntity(transferred.surfaces, browserId)).toMatchObject({
      kind: "browser-window",
      ownerEpoch: 7,
      rootNodeId: ids.nodes[1],
    });

    const recovered = execute(transferred, {
      type: "recover-orphaned-surface",
      surfaceId: browserId,
      expectedOwnerEpoch: 7,
      targetGroupId: ids.groups[0],
      edge: "inline-end",
      splitNodeId: nodeId("node:recovered"),
      ratio: 0.4,
    }).next;
    expect(getEntity(recovered.surfaces, browserId)).toBeUndefined();
    expect(getEntity(recovered.nodes, nodeId("node:recovered"))).toMatchObject({
      children: [ids.nodes[0], ids.nodes[1]],
    });
  });

  it("moves an eligible panel to Picture-in-Picture without duplicating ownership", () => {
    const eligible = mapPanels(fixtureSnapshot(), (record) =>
      record.id === ids.panels[1]
        ? { ...record, capabilities: { ...record.capabilities, pictureInPicture: true } }
        : record,
    );
    const pipPanelGroup = groupId("group:pip");
    const pip = execute(eligible, {
      type: "move-to-picture-in-picture",
      panelId: ids.panels[1],
      newGroupId: pipPanelGroup,
      newGroupNodeId: nodeId("node:pip"),
      surfaceId: surfaceId("surface:pip"),
      ownerEpoch: 2,
      capabilityToken: "prepared:pip",
      mode: "move",
    }).next;
    expect(getEntity(pip.groups, ids.groups[0])?.panelIds).toEqual([ids.panels[0]]);
    expect(getEntity(pip.groups, pipPanelGroup)?.panelIds).toEqual([ids.panels[1]]);
    expect(getEntity(pip.surfaces, surfaceId("surface:pip"))?.kind).toBe("document-pip");
  });

  it("rejects unrepresentable splits, node aliases, and unprepared ownership crossings", () => {
    const initial = fixtureSnapshot();
    const tinySplit = executeCommand(
      initial,
      envelope(initial, {
        type: "split-group",
        targetGroupId: ids.groups[0],
        panelIds: [ids.panels[1]],
        newGroupId: groupId("group:tiny"),
        newGroupNodeId: nodeId("node:tiny"),
        splitNodeId: nodeId("node:tiny-split"),
        edge: "inline-end",
        ratio: Number.MIN_VALUE,
      }),
    );
    expect(tinySplit).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });

    const aliasedNodeId = nodeId("node:aliased-split");
    const aliasedSplit = executeCommand(
      initial,
      envelope(initial, {
        type: "split-group",
        targetGroupId: ids.groups[0],
        panelIds: [ids.panels[1]],
        newGroupId: groupId("group:aliased-split"),
        newGroupNodeId: aliasedNodeId,
        splitNodeId: aliasedNodeId,
        edge: "block-end",
        ratio: 0.5,
      }),
    );
    expect(aliasedSplit).toMatchObject({ ok: false, error: { code: "DUPLICATE_ENTITY" } });

    const transferable = mapPanels(initial, (record) => ({
      ...record,
      capabilities: {
        ...record.capabilities,
        popout: true,
        pictureInPicture: true,
      },
    }));
    const browserSurfaceId = surfaceId("surface:boundary-browser");
    let external = execute(transferable, {
      type: "transfer-to-browser-window",
      groupId: ids.groups[1],
      surfaceId: browserSurfaceId,
      ownerEpoch: 11,
      preparedSurfaceToken: "prepared:boundary-browser",
    }).next;

    const crossDocumentMove = executeCommand(
      external,
      envelope(external, {
        type: "move-group",
        groupId: ids.groups[0],
        targetGroupId: ids.groups[1],
        edge: "block-start",
        splitNodeId: nodeId("node:cross-document-move"),
        ratio: 0.5,
      }),
    );
    expect(crossDocumentMove).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });

    const pipSurfaceId = surfaceId("surface:boundary-pip");
    external = execute(external, {
      type: "move-to-picture-in-picture",
      panelId: ids.panels[0],
      newGroupId: groupId("group:boundary-pip"),
      newGroupNodeId: nodeId("node:boundary-pip"),
      surfaceId: pipSurfaceId,
      ownerEpoch: 12,
      capabilityToken: "prepared:boundary-pip",
      mode: "move",
    }).next;

    const redockToBrowser = executeCommand(
      external,
      envelope(external, {
        type: "redock-surface",
        surfaceId: pipSurfaceId,
        expectedOwnerEpoch: 12,
        target: { groupId: ids.groups[1] },
      }),
    );
    expect(redockToBrowser).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });

    const recoverToBrowser = executeCommand(
      external,
      envelope(external, {
        type: "recover-orphaned-surface",
        surfaceId: pipSurfaceId,
        expectedOwnerEpoch: 12,
        targetGroupId: ids.groups[1],
        edge: "inline-start",
        splitNodeId: nodeId("node:cross-document-recovery"),
        ratio: 0.5,
      }),
    );
    expect(recoverToBrowser).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });

    const tinyRecovery = executeCommand(
      external,
      envelope(external, {
        type: "recover-orphaned-surface",
        surfaceId: pipSurfaceId,
        expectedOwnerEpoch: 12,
        targetGroupId: ids.groups[0],
        edge: "inline-start",
        splitNodeId: nodeId("node:tiny-recovery"),
        ratio: Number.MIN_VALUE,
      }),
    );
    expect(tinyRecovery).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("applies replace/merge snapshots and authenticated remote commands deterministically", () => {
    const initial = fixtureSnapshot();
    const preset = onePanelWorkspace("preset");
    const replaced = execute(initial, {
      type: "apply-workspace-preset",
      presetId: "focused",
      snapshot: preset,
      mode: "replace",
    }).next;
    expect(replaced.panels.ids).toEqual(preset.panels.ids);

    const merged = execute(initial, {
      type: "import-workspace",
      source: "decoded:test-fixture",
      snapshot: onePanelWorkspace("imported"),
      mode: "merge",
    }).next;
    expect(merged.panels.ids).toHaveLength(initial.panels.ids.length + 1);

    const applied = execute(initial, {
      type: "apply-remote-transaction",
      transactionId: "remote:1",
      actorId: "actor:a",
      surfaceId: ids.surface,
      ownerEpoch: 0,
      command: { type: "select-panel", panelId: ids.panels[1] },
    }).next;
    expect(applied.appliedRemoteTransactions).toEqual([
      { id: "remote:1", actorId: "actor:a", surfaceId: ids.surface, ownerEpoch: 0 },
    ]);

    const duplicate = executeCommand(
      applied,
      envelope(applied, {
        type: "apply-remote-transaction",
        transactionId: "remote:1",
        actorId: "actor:a",
        surfaceId: ids.surface,
        ownerEpoch: 0,
        command: { type: "select-panel", panelId: ids.panels[0] },
      }),
    );
    expect(duplicate).toMatchObject({ ok: false, error: { code: "DUPLICATE_TRANSACTION" } });

    const stale = executeCommand(
      applied,
      envelope(applied, {
        type: "apply-remote-transaction",
        transactionId: "remote:2",
        actorId: "actor:a",
        surfaceId: ids.surface,
        ownerEpoch: 1,
        command: { type: "select-panel", panelId: ids.panels[0] },
      }),
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  });
});
