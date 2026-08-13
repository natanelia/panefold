import { canonicalSerialize, executeCommand, planPanelDropCommand } from "@panefold/kernel";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  WORKSPACE_COMMAND_TYPES,
  closedPanelId,
  commandId,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type CommandEnvelope,
  type PanelCapabilities,
  type PanelRecord,
  type WorkspaceCommand,
  type WorkspaceCommandType,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import { createDifferentialCampaign } from "../src/index";
import { INDEPENDENT_SEMANTIC_KERNEL, executeIndependentCommand } from "../src/independent-reducer";

const ids = {
  panelA: panelId("panel:a"),
  panelB: panelId("panel:b"),
  panelC: panelId("panel:c"),
  panelD: panelId("panel:d"),
  groupA: groupId("group:a"),
  groupB: groupId("group:b"),
  nodeA: nodeId("node:a"),
  nodeB: nodeId("node:b"),
  root: nodeId("node:root"),
  main: surfaceId("surface:main"),
} as const;

function panel(
  id: PanelRecord["id"],
  capabilities: PanelCapabilities = {
    ...DEFAULT_PANEL_CAPABILITIES,
    popout: true,
    pictureInPicture: true,
  },
): PanelRecord {
  return {
    id,
    type: `test.${id}`,
    typeVersion: 1,
    parameters: {},
    capabilities,
    constraints: { collapsible: true },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

function fixture(): WorkspaceSnapshot {
  return createWorkspaceSnapshot({
    panels: [panel(ids.panelA), panel(ids.panelB), panel(ids.panelC)],
    groups: [
      {
        id: ids.groupA,
        panelIds: [ids.panelA, ids.panelB],
        selectedPanelId: ids.panelA,
        persistent: true,
      },
      {
        id: ids.groupB,
        panelIds: [ids.panelC],
        selectedPanelId: ids.panelC,
        persistent: true,
      },
    ],
    nodes: [
      { kind: "group", id: ids.nodeA, groupId: ids.groupA },
      { kind: "group", id: ids.nodeB, groupId: ids.groupB },
      {
        kind: "split",
        id: ids.root,
        axis: "inline",
        children: [ids.nodeA, ids.nodeB],
        weights: [500_000, 500_000],
        collapsedChildIds: [],
      },
    ],
    surfaces: [
      {
        id: ids.main,
        kind: "main",
        rootNodeId: ids.root,
        capabilities: MAIN_SURFACE_CAPABILITIES,
        maximized: false,
      },
    ],
    activation: { activePanelId: ids.panelA, activeSurfaceId: ids.main },
    focusMemory: {
      panelId: ids.panelA,
      groupId: ids.groupA,
      fallback: "selected-tab",
    },
  });
}

function envelope(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
  sequence: number,
): CommandEnvelope {
  return {
    id: commandId(`candidate:${String(sequence)}`),
    origin: "application",
    label: `Candidate ${command.type}`,
    baseRevision: snapshot.revision,
    command,
  };
}

function expectParity(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
  sequence = 0,
): WorkspaceSnapshot {
  const input = envelope(snapshot, command, sequence);
  const reference = executeCommand(snapshot, input);
  const candidate = executeIndependentCommand(snapshot, input);
  expect(canonicalSerialize(candidate)).toBe(canonicalSerialize(reference));
  return reference.ok ? reference.next : snapshot;
}

function expectAcceptedParity(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
  sequence = 0,
): WorkspaceSnapshot {
  const input = envelope(snapshot, command, sequence);
  const reference = executeCommand(snapshot, input);
  const candidate = executeIndependentCommand(snapshot, input);
  expect(reference).toMatchObject({ ok: true });
  expect(candidate).toMatchObject({ ok: true });
  expect(canonicalSerialize(candidate)).toBe(canonicalSerialize(reference));
  if (!reference.ok) throw new Error(`Reference rejected ${command.type}`);
  return reference.next;
}

describe("independent optimized semantic reducer", () => {
  it("matches the reference post-commit effect envelope exactly", () => {
    const snapshot = fixture();
    const input = envelope(snapshot, { type: "select-panel", panelId: ids.panelB }, 905);
    const reference = executeCommand(snapshot, input);
    const candidate = executeIndependentCommand(snapshot, input);
    expect(reference.ok).toBe(true);
    expect(candidate.ok).toBe(true);
    if (!reference.ok || !candidate.ok) return;

    expect(candidate.effects).toEqual(reference.effects);
    expect(candidate.effects).toBe(candidate.transaction.effects);
    expect(candidate.effects[0]?.id).toBe(reference.effects[0]?.id);
    expect(Object.isFrozen(candidate.effects)).toBe(true);
    expect(Object.isFrozen(candidate.effects[0])).toBe(true);
  });

  it("has full-result parity across a stateful accepted/rejected trace", () => {
    let snapshot = fixture();
    const commands: readonly WorkspaceCommand[] = [
      { type: "select-panel", panelId: ids.panelB },
      { type: "activate-panel", panelId: ids.panelC, focus: "restore-descendant" },
      {
        type: "open-panel",
        panel: panel(ids.panelD),
        placement: { groupId: ids.groupA, afterPanelId: ids.panelA },
      },
      {
        type: "reorder-panels",
        groupId: ids.groupA,
        panelIds: [ids.panelD],
        beforePanelId: ids.panelA,
      },
      { type: "move-panel", panelId: ids.panelD, target: { groupId: ids.groupB } },
      {
        type: "resize-split",
        splitNodeId: ids.root,
        weights: [320_000, 680_000],
      },
      { type: "equalize-split", splitNodeId: ids.root },
      { type: "collapse-child", splitNodeId: ids.root, childNodeId: ids.nodeA },
      {
        type: "restore-collapsed-child",
        splitNodeId: ids.root,
        childNodeId: ids.nodeA,
      },
      {
        type: "close-panels",
        targets: [{ panelId: ids.panelD, closedPanelId: closedPanelId("closed:d") }],
      },
      { type: "reopen-panel", closedPanelId: closedPanelId("closed:d") },
      { type: "select-panel", panelId: panelId("panel:missing") },
      { type: "undo-workspace-operation" },
      { type: "redo-workspace-operation" },
    ];
    commands.forEach((command, index) => {
      snapshot = expectParity(snapshot, command, index);
    });
  });

  it("accepts the ownership and recovery paths that broad generation may miss", () => {
    let snapshot = fixture();
    snapshot = expectAcceptedParity(
      snapshot,
      {
        type: "close-panels-to-right",
        groupId: ids.groupA,
        panelId: ids.panelA,
        targets: [{ panelId: ids.panelB, closedPanelId: closedPanelId("closed:right") }],
      },
      1,
    );
    snapshot = expectAcceptedParity(
      snapshot,
      {
        type: "transfer-to-browser-window",
        groupId: ids.groupA,
        surfaceId: surfaceId("surface:browser-accepted"),
        ownerEpoch: 4,
        preparedSurfaceToken: "prepared-browser",
      },
      2,
    );
    snapshot = expectAcceptedParity(
      snapshot,
      {
        type: "recover-orphaned-surface",
        surfaceId: surfaceId("surface:browser-accepted"),
        expectedOwnerEpoch: 4,
        targetGroupId: ids.groupB,
        edge: "inline-end",
        splitNodeId: nodeId("node:recovered"),
        ratio: 0.4,
      },
      3,
    );
    snapshot = expectAcceptedParity(
      snapshot,
      {
        type: "move-to-picture-in-picture",
        panelId: ids.panelA,
        newGroupId: groupId("group:pip-accepted"),
        newGroupNodeId: nodeId("node:pip-accepted"),
        surfaceId: surfaceId("surface:pip-accepted"),
        ownerEpoch: 5,
        capabilityToken: "prepared-pip",
        mode: "move",
      },
      4,
    );
    expect(snapshot.surfaces.byId["surface:pip-accepted"]?.kind).toBe("document-pip");

    let floating = fixture();
    floating = expectAcceptedParity(
      floating,
      {
        type: "create-floating-surface",
        groupId: ids.groupA,
        surfaceId: surfaceId("surface:floating-accepted"),
        bounds: { x: 10, y: 10, width: 500, height: 300 },
      },
      5,
    );
    floating = expectAcceptedParity(
      floating,
      {
        type: "redock-surface",
        surfaceId: surfaceId("surface:floating-accepted"),
        target: { groupId: ids.groupB },
      },
      6,
    );
    expect(floating.surfaces.byId["surface:floating-accepted"]).toBeUndefined();
  });

  it("has independent parity for every panel-drop planner shape", () => {
    const scenarios = [
      {
        panelId: ids.panelA,
        target: { kind: "center", groupId: ids.groupB } as const,
      },
      {
        panelId: ids.panelB,
        target: {
          kind: "edge",
          groupId: ids.groupA,
          edge: "block-start",
          ratio: 0.35,
        } as const,
      },
      {
        panelId: ids.panelA,
        target: {
          kind: "edge",
          groupId: ids.groupB,
          edge: "block-end",
          ratio: 0.4,
        } as const,
      },
      {
        panelId: ids.panelC,
        target: {
          kind: "edge",
          groupId: ids.groupA,
          edge: "inline-start",
          ratio: 0.3,
        } as const,
      },
    ];

    scenarios.forEach((intent, index) => {
      const snapshot = fixture();
      const plan = planPanelDropCommand(snapshot, intent, {
        newGroupId: groupId(`group:planned:${String(index)}`),
        newGroupNodeId: nodeId(`node:planned-group:${String(index)}`),
        splitNodeId: nodeId(`node:planned-split:${String(index)}`),
      });
      expect(plan).toMatchObject({ ok: true });
      if (!plan.ok) throw new Error(plan.message);
      expectAcceptedParity(snapshot, plan.command, 20 + index);
    });
  });

  it("mirrors ratio, node-alias, and cross-document rejection boundaries", () => {
    const base = fixture();
    expectParity(
      base,
      {
        type: "split-group",
        targetGroupId: ids.groupA,
        panelIds: [ids.panelB],
        newGroupId: groupId("group:tiny-parity"),
        newGroupNodeId: nodeId("node:tiny-parity"),
        splitNodeId: nodeId("node:tiny-split-parity"),
        edge: "inline-end",
        ratio: Number.MIN_VALUE,
      },
      30,
    );
    const aliasedId = nodeId("node:aliased-parity");
    expectParity(
      base,
      {
        type: "split-group",
        targetGroupId: ids.groupA,
        panelIds: [ids.panelB],
        newGroupId: groupId("group:aliased-parity"),
        newGroupNodeId: aliasedId,
        splitNodeId: aliasedId,
        edge: "block-end",
        ratio: 0.5,
      },
      31,
    );

    const browserId = surfaceId("surface:boundary-parity-browser");
    let external = expectAcceptedParity(
      base,
      {
        type: "transfer-to-browser-window",
        groupId: ids.groupB,
        surfaceId: browserId,
        ownerEpoch: 21,
        preparedSurfaceToken: "prepared:boundary-parity-browser",
      },
      32,
    );
    expectParity(
      external,
      {
        type: "move-group",
        groupId: ids.groupA,
        targetGroupId: ids.groupB,
        edge: "block-start",
        splitNodeId: nodeId("node:cross-document-parity"),
        ratio: 0.5,
      },
      33,
    );

    const pipId = surfaceId("surface:boundary-parity-pip");
    external = expectAcceptedParity(
      external,
      {
        type: "move-to-picture-in-picture",
        panelId: ids.panelA,
        newGroupId: groupId("group:boundary-parity-pip"),
        newGroupNodeId: nodeId("node:boundary-parity-pip"),
        surfaceId: pipId,
        ownerEpoch: 22,
        capabilityToken: "prepared:boundary-parity-pip",
        mode: "move",
      },
      34,
    );
    expectParity(
      external,
      {
        type: "redock-surface",
        surfaceId: pipId,
        expectedOwnerEpoch: 22,
        target: { groupId: ids.groupB },
      },
      35,
    );
    expectParity(
      external,
      {
        type: "recover-orphaned-surface",
        surfaceId: pipId,
        expectedOwnerEpoch: 22,
        targetGroupId: ids.groupB,
        edge: "inline-start",
        splitNodeId: nodeId("node:recover-cross-document-parity"),
        ratio: 0.5,
      },
      36,
    );
    expectParity(
      external,
      {
        type: "recover-orphaned-surface",
        surfaceId: pipId,
        expectedOwnerEpoch: 22,
        targetGroupId: ids.groupA,
        edge: "inline-start",
        splitNodeId: nodeId("node:recover-tiny-parity"),
        ratio: Number.MIN_VALUE,
      },
      37,
    );
  });

  it("matches every generated attempt and complete transaction contract", () => {
    for (const seed of [1, 7, 42]) {
      const report = createDifferentialCampaign({
        initial: fixture(),
        seed,
        candidate: INDEPENDENT_SEMANTIC_KERNEL,
        projection: { historyLimit: 0 },
      }).runChunk(2_000);

      expect(report.divergences, `seed ${String(seed)}`).toEqual([]);
      expect(report.checks.candidateComparisons).toBe(2_000);
      expect(report.generatedCommandTypes).toEqual(WORKSPACE_COMMAND_TYPES);
      expect(report.implementation).toEqual({
        reference: "@panefold/kernel.executeCommand",
        candidateId: "@panefold/kernel-optimized.independent-semantic-reducer.v1",
        independentCandidate: true,
      });
      expect(report.phaseOneDifferentialEligible).toBe(false);
    }
  }, 30_000);

  it("cannot grant Phase-1 eligibility through caller self-attestation", () => {
    const report = createDifferentialCampaign({
      initial: fixture(),
      seed: 9,
      candidate: {
        id: "self-attested-reference",
        independent: true,
        execute: executeCommand,
      },
    }).runChunk(10);

    expect(report.phaseOneDifferentialEligible).toBe(false);
  }, 30_000);

  it("covers every command discriminator through a curated parity catalog", () => {
    const base = fixture();
    const floatingSurfaceId = surfaceId("surface:floating");
    const browserSurfaceId = surfaceId("surface:browser");
    const pipSurfaceId = surfaceId("surface:pip");
    const closedId = closedPanelId("closed:catalog");
    const commandByType = {
      batch: { type: "batch", commands: [{ type: "select-panel", panelId: ids.panelA }] },
      "open-panel": {
        type: "open-panel",
        panel: panel(panelId("panel:open")),
        placement: { groupId: ids.groupA },
      },
      "duplicate-panel": {
        type: "duplicate-panel",
        panelId: ids.panelA,
        duplicatePanelId: panelId("panel:duplicate"),
      },
      "close-panels": {
        type: "close-panels",
        targets: [{ panelId: ids.panelA, closedPanelId: closedId }],
      },
      "close-other-panels": {
        type: "close-other-panels",
        groupId: ids.groupA,
        exceptPanelId: ids.panelA,
        targets: [{ panelId: ids.panelB, closedPanelId: closedId }],
      },
      "close-panels-to-right": {
        type: "close-panels-to-right",
        groupId: ids.groupA,
        panelId: ids.panelA,
        targets: [{ panelId: ids.panelB, closedPanelId: closedId }],
      },
      "reopen-panel": { type: "reopen-panel", closedPanelId: closedId },
      "select-panel": { type: "select-panel", panelId: ids.panelA },
      "activate-panel": {
        type: "activate-panel",
        panelId: ids.panelA,
        focus: "keep-focus",
      },
      "reorder-panels": {
        type: "reorder-panels",
        groupId: ids.groupA,
        panelIds: [ids.panelB],
        beforePanelId: ids.panelA,
      },
      "move-panel": {
        type: "move-panel",
        panelId: ids.panelA,
        target: { groupId: ids.groupB },
      },
      "move-group": {
        type: "move-group",
        groupId: ids.groupA,
        targetGroupId: ids.groupB,
        edge: "inline-start",
        splitNodeId: nodeId("node:move"),
        ratio: 0.5,
      },
      "split-group": {
        type: "split-group",
        targetGroupId: ids.groupA,
        panelIds: [ids.panelB],
        newGroupId: groupId("group:split"),
        newGroupNodeId: nodeId("node:split-group"),
        splitNodeId: nodeId("node:split"),
        edge: "block-end",
        ratio: 0.5,
      },
      "merge-groups": {
        type: "merge-groups",
        sourceGroupId: ids.groupA,
        target: { groupId: ids.groupB },
      },
      "swap-groups": {
        type: "swap-groups",
        firstGroupId: ids.groupA,
        secondGroupId: ids.groupB,
      },
      "resize-split": {
        type: "resize-split",
        splitNodeId: ids.root,
        weights: [250_000, 750_000],
      },
      "equalize-split": { type: "equalize-split", splitNodeId: ids.root },
      "collapse-child": {
        type: "collapse-child",
        splitNodeId: ids.root,
        childNodeId: ids.nodeA,
      },
      "restore-collapsed-child": {
        type: "restore-collapsed-child",
        splitNodeId: ids.root,
        childNodeId: ids.nodeA,
      },
      "create-floating-surface": {
        type: "create-floating-surface",
        groupId: ids.groupA,
        surfaceId: floatingSurfaceId,
        bounds: { x: 1, y: 2, width: 300, height: 200 },
      },
      "move-floating-surface": {
        type: "move-floating-surface",
        surfaceId: floatingSurfaceId,
        x: 2,
        y: 3,
      },
      "resize-floating-surface": {
        type: "resize-floating-surface",
        surfaceId: floatingSurfaceId,
        bounds: { x: 1, y: 2, width: 400, height: 250 },
      },
      "raise-surface": { type: "raise-surface", surfaceId: floatingSurfaceId },
      "maximize-surface": { type: "maximize-surface", surfaceId: floatingSurfaceId },
      "restore-surface": { type: "restore-surface", surfaceId: floatingSurfaceId },
      "minimize-surface": { type: "minimize-surface", surfaceId: floatingSurfaceId },
      "transfer-to-browser-window": {
        type: "transfer-to-browser-window",
        groupId: ids.groupA,
        surfaceId: browserSurfaceId,
        ownerEpoch: 1,
        preparedSurfaceToken: "prepared",
      },
      "redock-surface": {
        type: "redock-surface",
        surfaceId: floatingSurfaceId,
        target: { groupId: ids.groupB },
      },
      "move-to-picture-in-picture": {
        type: "move-to-picture-in-picture",
        panelId: ids.panelA,
        newGroupId: groupId("group:pip"),
        newGroupNodeId: nodeId("node:pip"),
        surfaceId: pipSurfaceId,
        ownerEpoch: 1,
        capabilityToken: "prepared",
        mode: "move",
      },
      "apply-workspace-preset": {
        type: "apply-workspace-preset",
        presetId: "preset",
        snapshot: base,
        mode: "replace",
      },
      "restore-workspace": { type: "restore-workspace", snapshot: base },
      "import-workspace": {
        type: "import-workspace",
        snapshot: base,
        mode: "replace",
        source: "catalog",
      },
      "undo-workspace-operation": { type: "undo-workspace-operation" },
      "redo-workspace-operation": { type: "redo-workspace-operation" },
      "apply-remote-transaction": {
        type: "apply-remote-transaction",
        transactionId: "remote",
        actorId: "actor",
        surfaceId: ids.main,
        ownerEpoch: 0,
        command: { type: "select-panel", panelId: ids.panelA },
      },
      "recover-orphaned-surface": {
        type: "recover-orphaned-surface",
        surfaceId: browserSurfaceId,
        expectedOwnerEpoch: 1,
        targetGroupId: ids.groupA,
        edge: "inline-end",
        splitNodeId: nodeId("node:recover"),
        ratio: 0.5,
      },
    } satisfies { readonly [Type in WorkspaceCommandType]: WorkspaceCommand & { type: Type } };

    expect(Object.keys(commandByType)).toEqual(WORKSPACE_COMMAND_TYPES);
    WORKSPACE_COMMAND_TYPES.forEach((type, index) => {
      expectParity(base, commandByType[type], index);
    });
  });
});
