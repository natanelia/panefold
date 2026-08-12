import {
  APPLIED_REMOTE_TRANSACTION_LIMIT,
  BROWSER_WINDOW_SURFACE_CAPABILITIES,
  FLOATING_SURFACE_CAPABILITIES,
  PICTURE_IN_PICTURE_SURFACE_CAPABILITIES,
  nextRevision,
  type ClosedPanelRecord,
  type CommandEnvelope,
  type CommandRejectionCode,
  type GroupRecord,
  type KernelResult,
  type LayoutNode,
  type LogicalAxis,
  type PanelId,
  type SurfaceRecord,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";

import type { DifferentialKernelImplementation } from "./differential";
import {
  OPTIMIZED_WEIGHT_TOTAL,
  canonicalizeIndependentDraft,
  compareIndependentIds,
  createIndependentDraft,
  detachIndependentNode,
  diffIndependentSnapshots,
  findIndependentGroupNode,
  findIndependentNodeParent,
  findIndependentNodeSurface,
  findIndependentPanelGroup,
  hasUniqueValues,
  insertIndependentPanels,
  isIndependentFiniteRect,
  replaceIndependentNodeReference,
  snapshotIndependentDraft,
  validateIndependentCandidate,
  type IndependentWorkspaceDraft,
} from "./independent-workspace";

interface IndependentReductionFailure {
  readonly code: Exclude<CommandRejectionCode, "INVARIANT_VIOLATION" | "HISTORY_EMPTY">;
  readonly message: string;
  readonly remediation: readonly string[];
}

class IndependentRejection extends Error {
  public constructor(readonly failure: IndependentReductionFailure) {
    super(failure.message);
  }
}

function rejectIndependent(
  code: IndependentReductionFailure["code"],
  message: string,
  ...remediation: string[]
): never {
  throw new IndependentRejection({ code, message, remediation });
}

function requireIndependent<Value>(value: Value | undefined, kind: string, id: string): Value {
  if (value === undefined) {
    rejectIndependent(
      "ENTITY_NOT_FOUND",
      `${kind} "${id}" does not exist`,
      `Choose an existing ${kind.toLowerCase()}`,
    );
  }
  return value;
}

function populatedIndependentGroup(group: GroupRecord, panelIds: readonly PanelId[]): GroupRecord {
  const { placeholder: _placeholder, ...rest } = group;
  void _placeholder;
  return { ...rest, panelIds };
}

function updateIndependentGroupAfterRemoval(
  draft: IndependentWorkspaceDraft,
  group: GroupRecord,
  removed: readonly PanelId[],
): void {
  const previousIndex = Math.max(0, group.panelIds.indexOf(group.selectedPanelId));
  const panelIds = group.panelIds.filter((id) => !removed.includes(id));
  if (panelIds.length === 0) {
    draft.groups.set(group.id, { ...group, panelIds });
    return;
  }
  const selectedPanelId = panelIds.includes(group.selectedPanelId)
    ? group.selectedPanelId
    : (panelIds[Math.min(previousIndex, panelIds.length - 1)] as PanelId);
  draft.groups.set(group.id, { ...group, panelIds, selectedPanelId });
}

function surfaceForIndependentPanel(
  draft: IndependentWorkspaceDraft,
  panelId: PanelId,
): SurfaceRecord | undefined {
  const group = findIndependentPanelGroup(draft, panelId);
  const node = group === undefined ? undefined : findIndependentGroupNode(draft, group.id);
  return node === undefined ? undefined : findIndependentNodeSurface(draft, node.id);
}

function activateIndependentPanel(draft: IndependentWorkspaceDraft, panelId: PanelId): void {
  requireIndependent(draft.panels.get(panelId), "Panel", panelId);
  const group = requireIndependent(
    findIndependentPanelGroup(draft, panelId),
    "Group for panel",
    panelId,
  );
  const surface = surfaceForIndependentPanel(draft, panelId);
  draft.activation = {
    activePanelId: panelId,
    ...(surface === undefined ? {} : { activeSurfaceId: surface.id }),
  };
  draft.focusMemory = { panelId, groupId: group.id, fallback: "panel-root" };
}

function repairIndependentActivation(
  draft: IndependentWorkspaceDraft,
  preferredPanelId?: PanelId,
): void {
  const activePanelId = draft.activation.activePanelId;
  if (activePanelId !== undefined && draft.panels.has(activePanelId)) return;
  const nextPanelId =
    preferredPanelId !== undefined && draft.panels.has(preferredPanelId)
      ? preferredPanelId
      : [...draft.groups.values()]
          .sort((left, right) => compareIndependentIds(String(left.id), String(right.id)))
          .find((group) => group.panelIds.length > 0)?.selectedPanelId;
  if (nextPanelId === undefined) {
    draft.activation = {};
    draft.focusMemory = { fallback: "workspace-root" };
    return;
  }
  const surface = surfaceForIndependentPanel(draft, nextPanelId);
  draft.activation = {
    activePanelId: nextPanelId,
    ...(surface === undefined ? {} : { activeSurfaceId: surface.id }),
  };
  const group = findIndependentPanelGroup(draft, nextPanelId);
  draft.focusMemory = {
    panelId: nextPanelId,
    ...(group === undefined ? {} : { groupId: group.id }),
    fallback: "selected-tab",
  };
}

function removeIndependentGroupAndNode(
  draft: IndependentWorkspaceDraft,
  groupId: GroupRecord["id"],
): void {
  const node = findIndependentGroupNode(draft, groupId);
  if (node !== undefined) {
    detachIndependentNode(draft, node.id);
    draft.nodes.delete(node.id);
  }
  draft.groups.delete(groupId);
}

function reduceIndependentOpenPanel(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "open-panel" }>,
): void {
  if (draft.panels.has(command.panel.id)) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      `Panel "${command.panel.id}" already exists`,
      "Use a new stable panel ID",
    );
  }
  if (!Number.isSafeInteger(command.panel.typeVersion) || command.panel.typeVersion < 1) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Panel typeVersion must be a positive safe integer",
      "Provide a version of 1 or greater",
    );
  }
  const sameType = [...draft.panels.values()].filter((panel) => panel.type === command.panel.type);
  if (
    sameType.length > 0 &&
    (command.panel.capabilities.singleton || sameType.some((panel) => panel.capabilities.singleton))
  ) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      `Singleton panel type "${command.panel.type}" is already open`,
      "Activate the existing panel instead",
    );
  }
  const group = requireIndependent(
    draft.groups.get(command.placement.groupId),
    "Group",
    command.placement.groupId,
  );
  const panelIds = insertIndependentPanels(
    group.panelIds,
    [command.panel.id],
    command.placement.beforePanelId,
    command.placement.afterPanelId,
  );
  if (panelIds === undefined) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Open-panel placement anchor is invalid",
      "Choose one live tab anchor or append to the group",
    );
  }
  draft.panels.set(command.panel.id, command.panel);
  draft.groups.set(group.id, {
    ...populatedIndependentGroup(group, panelIds),
    selectedPanelId: command.select === false ? group.selectedPanelId : command.panel.id,
  });
  if (command.activate !== false) activateIndependentPanel(draft, command.panel.id);
}

function reduceIndependentDuplicatePanel(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "duplicate-panel" }>,
): void {
  const source = requireIndependent(draft.panels.get(command.panelId), "Panel", command.panelId);
  if (source.capabilities.singleton) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      `Panel "${command.panelId}" is a singleton and cannot be duplicated`,
      "Reuse the existing panel",
    );
  }
  const group = requireIndependent(
    findIndependentPanelGroup(draft, command.panelId),
    "Group for panel",
    command.panelId,
  );
  reduceIndependentOpenPanel(draft, {
    type: "open-panel",
    panel: { ...source, id: command.duplicatePanelId },
    placement: command.placement ?? { groupId: group.id, afterPanelId: command.panelId },
    ...(command.select === undefined ? {} : { select: command.select }),
    ...(command.activate === undefined ? {} : { activate: command.activate }),
  });
}

function requireIndependentCloseTargets(
  expected: readonly PanelId[],
  targets: Extract<WorkspaceCommand, { readonly type: "close-panels" }>["targets"],
  intent: string,
): void {
  const actual = targets.map((target) => target.panelId);
  if (
    expected.length !== actual.length ||
    expected.some((panelId, index) => panelId !== actual[index])
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      `${intent} targets do not exactly match the current semantic tab order`,
      "Re-read the group and provide one stable closed-record ID per eligible panel",
    );
  }
}

function reduceIndependentClosePanels(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "close-panels" }>,
): void {
  const activePanelId = draft.activation.activePanelId;
  const activeGroupId =
    activePanelId === undefined ? undefined : findIndependentPanelGroup(draft, activePanelId)?.id;
  if (
    command.targets.length === 0 ||
    !hasUniqueValues(command.targets.map((target) => target.panelId)) ||
    !hasUniqueValues(command.targets.map((target) => target.closedPanelId))
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Close targets must contain unique panel and closed-record IDs",
      "Choose at least one live panel exactly once",
    );
  }
  const existingClosedIds = new Set(draft.recoverableClosedPanels.map((record) => record.id));
  for (const target of command.targets) {
    const panel = requireIndependent(draft.panels.get(target.panelId), "Panel", target.panelId);
    if (!panel.capabilities.closable) {
      rejectIndependent(
        "CAPABILITY_DENIED",
        `Panel "${target.panelId}" is not closable`,
        "Keep the panel open",
      );
    }
    if (existingClosedIds.has(target.closedPanelId)) {
      rejectIndependent(
        "DUPLICATE_ENTITY",
        `Closed-panel record "${target.closedPanelId}" already exists`,
        "Use a new stable closed-record ID",
      );
    }
  }
  for (const target of command.targets) {
    const panel = draft.panels.get(target.panelId) as NonNullable<
      ReturnType<typeof draft.panels.get>
    >;
    const group = requireIndependent(
      findIndependentPanelGroup(draft, target.panelId),
      "Group for panel",
      target.panelId,
    );
    const index = group.panelIds.indexOf(target.panelId);
    const next = group.panelIds[index + 1];
    const previous = group.panelIds[index - 1];
    const record: ClosedPanelRecord = {
      id: target.closedPanelId,
      panel,
      formerPlacement: {
        groupId: group.id,
        ...(next !== undefined
          ? { beforePanelId: next }
          : previous !== undefined
            ? { afterPanelId: previous }
            : {}),
      },
      closedAtRevision: draft.revision,
    };
    draft.recoverableClosedPanels.push(record);
    updateIndependentGroupAfterRemoval(draft, group, [target.panelId]);
    draft.panels.delete(target.panelId);
  }
  const hasReopenDestination = [...draft.groups.values()].some(
    (group) => group.panelIds.length > 0 || group.persistent,
  );
  if (!hasReopenDestination && draft.recoverableClosedPanels.length > 0) {
    const placeholder = [...draft.groups.values()]
      .filter((group) => group.panelIds.length === 0)
      .sort((left, right) => compareIndependentIds(String(left.id), String(right.id)))[0];
    if (placeholder !== undefined) {
      draft.groups.set(placeholder.id, { ...placeholder, placeholder: true });
    }
  }
  const activeGroup = activeGroupId === undefined ? undefined : draft.groups.get(activeGroupId);
  repairIndependentActivation(
    draft,
    activeGroup?.panelIds.length ? activeGroup.selectedPanelId : undefined,
  );
}

function reduceIndependentReopenPanel(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "reopen-panel" }>,
): void {
  const index = draft.recoverableClosedPanels.findIndex(
    (record) => record.id === command.closedPanelId,
  );
  if (index < 0) {
    rejectIndependent(
      "ENTITY_NOT_FOUND",
      `Closed panel "${command.closedPanelId}" does not exist`,
      "Choose a recoverable closed panel",
    );
  }
  const record = draft.recoverableClosedPanels[index] as ClosedPanelRecord;
  if (draft.panels.has(record.panel.id)) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      `Panel "${record.panel.id}" is already live`,
      "Remove the stale closed record",
    );
  }
  let placement = command.placement ?? record.formerPlacement;
  if (!draft.groups.has(placement.groupId)) {
    const fallback = [...draft.groups.values()]
      .filter(
        (group) => group.panelIds.length > 0 || group.persistent || group.placeholder === true,
      )
      .sort((left, right) => compareIndependentIds(String(left.id), String(right.id)))[0];
    if (fallback === undefined) {
      rejectIndependent(
        "ENTITY_NOT_FOUND",
        "No destination group is available for reopen",
        "Provide a live destination group",
      );
    }
    placement = { groupId: fallback.id };
  }
  const group = draft.groups.get(placement.groupId) as GroupRecord;
  let panelIds = insertIndependentPanels(
    group.panelIds,
    [record.panel.id],
    placement.beforePanelId,
    placement.afterPanelId,
  );
  panelIds ??= [...group.panelIds, record.panel.id];
  draft.panels.set(record.panel.id, record.panel);
  draft.groups.set(group.id, {
    ...populatedIndependentGroup(group, panelIds),
    selectedPanelId: command.select === false ? group.selectedPanelId : record.panel.id,
  });
  draft.recoverableClosedPanels.splice(index, 1);
  if (command.activate !== false) activateIndependentPanel(draft, record.panel.id);
}

function reduceIndependentMovePanel(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "move-panel" }>,
): void {
  requireIndependent(draft.panels.get(command.panelId), "Panel", command.panelId);
  const source = requireIndependent(
    findIndependentPanelGroup(draft, command.panelId),
    "Source group",
    command.panelId,
  );
  const target = requireIndependent(
    draft.groups.get(command.target.groupId),
    "Target group",
    command.target.groupId,
  );
  const sourceNode = requireIndependent(
    findIndependentGroupNode(draft, source.id),
    "Source group node",
    source.id,
  );
  const targetNode = requireIndependent(
    findIndependentGroupNode(draft, target.id),
    "Target group node",
    target.id,
  );
  const sourceSurface = requireIndependent(
    findIndependentNodeSurface(draft, sourceNode.id),
    "Source surface",
    sourceNode.id,
  );
  const targetSurface = requireIndependent(
    findIndependentNodeSurface(draft, targetNode.id),
    "Target surface",
    targetNode.id,
  );
  if (
    sourceSurface.id !== targetSurface.id &&
    (sourceSurface.capabilities.crossDocument || targetSurface.capabilities.crossDocument)
  ) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "A panel cannot move across cross-document ownership without preparation",
      "Use a prepared transfer, redock, or recovery command",
    );
  }
  const panelIds = insertIndependentPanels(
    target.panelIds,
    [command.panelId],
    command.target.beforePanelId,
    command.target.afterPanelId,
  );
  if (panelIds === undefined) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Move target anchor is invalid",
      "Choose one live destination tab or append",
    );
  }
  if (source.id !== target.id) updateIndependentGroupAfterRemoval(draft, source, [command.panelId]);
  draft.groups.set(target.id, {
    ...populatedIndependentGroup(target, panelIds),
    selectedPanelId: command.select === false ? target.selectedPanelId : command.panelId,
  });
  if (command.activate !== false) activateIndependentPanel(draft, command.panelId);
}

interface IndependentNodeLocation {
  readonly parentNodeId?: LayoutNode["id"];
  readonly childIndex?: number;
  readonly surfaceId?: SurfaceRecord["id"];
}

function locateIndependentNode(
  draft: IndependentWorkspaceDraft,
  nodeId: LayoutNode["id"],
): IndependentNodeLocation | undefined {
  const parent = findIndependentNodeParent(draft, nodeId);
  if (parent !== undefined) {
    return { parentNodeId: parent.node.id, childIndex: parent.childIndex };
  }
  const surface = [...draft.surfaces.values()].find((item) => item.rootNodeId === nodeId);
  return surface === undefined ? undefined : { surfaceId: surface.id };
}

function replaceIndependentAtLocation(
  draft: IndependentWorkspaceDraft,
  location: IndependentNodeLocation,
  expectedNodeId: LayoutNode["id"],
  replacementNodeId: LayoutNode["id"],
): void {
  if (location.parentNodeId !== undefined && location.childIndex !== undefined) {
    const parent = requireIndependent(
      draft.nodes.get(location.parentNodeId),
      "Parent split",
      location.parentNodeId,
    );
    if (parent.kind !== "split" || parent.children[location.childIndex] !== expectedNodeId) {
      rejectIndependent(
        "INVALID_COMMAND",
        "Layout changed while replacing a group location",
        "Re-read the workspace and replan the command",
      );
    }
    const children = [...parent.children];
    children[location.childIndex] = replacementNodeId;
    draft.nodes.set(parent.id, { ...parent, children });
    return;
  }
  if (location.surfaceId !== undefined) {
    const surface = requireIndependent(
      draft.surfaces.get(location.surfaceId),
      "Surface",
      location.surfaceId,
    );
    if (surface.rootNodeId !== expectedNodeId) {
      rejectIndependent(
        "INVALID_COMMAND",
        "Surface root changed while replacing a group location",
        "Re-read the workspace and replan the command",
      );
    }
    draft.surfaces.set(surface.id, { ...surface, rootNodeId: replacementNodeId });
    return;
  }
  rejectIndependent(
    "INVALID_COMMAND",
    "Group node has no reachable layout location",
    "Repair the workspace",
  );
}

function edgeAxis(edge: Extract<WorkspaceCommand, { type: "split-group" }>["edge"]): LogicalAxis {
  return edge.startsWith("inline") ? "inline" : "block";
}

function createIndependentSplit(
  id: LayoutNode["id"],
  edge: Extract<WorkspaceCommand, { type: "split-group" }>["edge"],
  ratio: number,
  firstNodeId: LayoutNode["id"],
  secondNodeId: LayoutNode["id"],
  insertedFirst: boolean,
): LayoutNode {
  return {
    kind: "split",
    id,
    axis: edgeAxis(edge),
    children: insertedFirst ? [firstNodeId, secondNodeId] : [secondNodeId, firstNodeId],
    weights: insertedFirst
      ? [ratio, OPTIMIZED_WEIGHT_TOTAL - ratio]
      : [OPTIMIZED_WEIGHT_TOTAL - ratio, ratio],
    collapsedChildIds: [],
  };
}

function requireRatio(value: number, intent: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    rejectIndependent(
      "INVALID_COMMAND",
      `${intent} ratio must be between 0 and 1`,
      "Choose a ratio such as 0.5",
    );
  }
  const weight = Math.round(value * OPTIMIZED_WEIGHT_TOTAL);
  if (weight <= 0 || weight >= OPTIMIZED_WEIGHT_TOTAL) {
    rejectIndependent(
      "INVALID_COMMAND",
      `${intent} ratio must produce two positive canonical weights`,
      "Choose a ratio from 0.000001 through 0.999999",
    );
  }
  return weight;
}

function reduceIndependentMoveGroup(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "move-group" }>,
): void {
  if (command.groupId === command.targetGroupId) {
    rejectIndependent(
      "INVALID_COMMAND",
      "A group cannot be moved beside itself",
      "Choose another group",
    );
  }
  if (draft.nodes.has(command.splitNodeId)) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      `Node "${command.splitNodeId}" already exists`,
      "Supply a new split ID",
    );
  }
  const ratio = requireRatio(command.ratio, "Move-group");
  const sourceGroup = requireIndependent(
    draft.groups.get(command.groupId),
    "Group",
    command.groupId,
  );
  const targetGroup = requireIndependent(
    draft.groups.get(command.targetGroupId),
    "Target group",
    command.targetGroupId,
  );
  if (sourceGroup.panelIds.length === 0) {
    rejectIndependent(
      "INVALID_COMMAND",
      "An empty placeholder group cannot be moved",
      "Move a populated group",
    );
  }
  const sourceNode = requireIndependent(
    findIndependentGroupNode(draft, sourceGroup.id),
    "Group node",
    sourceGroup.id,
  );
  const targetNode = requireIndependent(
    findIndependentGroupNode(draft, targetGroup.id),
    "Target group node",
    targetGroup.id,
  );
  const sourceSurface = requireIndependent(
    findIndependentNodeSurface(draft, sourceNode.id),
    "Source group surface",
    sourceNode.id,
  );
  const targetSurface = requireIndependent(
    findIndependentNodeSurface(draft, targetNode.id),
    "Target group surface",
    targetNode.id,
  );
  if (
    sourceSurface.id !== targetSurface.id &&
    (sourceSurface.capabilities.crossDocument || targetSurface.capabilities.crossDocument)
  ) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "A group cannot move across cross-document ownership without preparation",
      "Use a prepared transfer, redock, or recovery command",
    );
  }
  const sourceLocation = requireIndependent(
    locateIndependentNode(draft, sourceNode.id),
    "Group location",
    sourceNode.id,
  );
  if (sourceLocation.parentNodeId !== undefined) {
    detachIndependentNode(draft, sourceNode.id);
  } else if (sourceLocation.surfaceId !== undefined) {
    const sourceRootSurface = requireIndependent(
      draft.surfaces.get(sourceLocation.surfaceId),
      "Source surface",
      sourceLocation.surfaceId,
    );
    if (sourceRootSurface.kind !== "floating") {
      rejectIndependent(
        "CAPABILITY_DENIED",
        "Only an in-page floating root can move without an ownership recovery protocol",
        "Use redock or recover-orphaned-surface for external ownership",
      );
    }
    draft.surfaces.delete(sourceRootSurface.id);
    draft.floatingOrder = draft.floatingOrder.filter((id) => id !== sourceRootSurface.id);
  }
  const split = createIndependentSplit(
    command.splitNodeId,
    command.edge,
    ratio,
    sourceNode.id,
    targetNode.id,
    command.edge.endsWith("start"),
  );
  replaceIndependentNodeReference(draft, targetNode.id, split.id);
  draft.nodes.set(split.id, split);
  activateIndependentPanel(draft, sourceGroup.selectedPanelId);
}

function reduceIndependentSwapGroups(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "swap-groups" }>,
): void {
  if (command.firstGroupId === command.secondGroupId) {
    rejectIndependent(
      "INVALID_COMMAND",
      "A group cannot be swapped with itself",
      "Choose two groups",
    );
  }
  const first = requireIndependent(
    findIndependentGroupNode(draft, command.firstGroupId),
    "First group node",
    command.firstGroupId,
  );
  const second = requireIndependent(
    findIndependentGroupNode(draft, command.secondGroupId),
    "Second group node",
    command.secondGroupId,
  );
  const firstSurface = requireIndependent(
    findIndependentNodeSurface(draft, first.id),
    "First group surface",
    first.id,
  );
  const secondSurface = requireIndependent(
    findIndependentNodeSurface(draft, second.id),
    "Second group surface",
    second.id,
  );
  if (
    firstSurface.id !== secondSurface.id &&
    (firstSurface.capabilities.crossDocument || secondSurface.capabilities.crossDocument)
  ) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "Groups cannot swap across cross-document ownership boundaries",
      "Use a prepared transfer or recovery protocol",
    );
  }
  const firstLocation = requireIndependent(
    locateIndependentNode(draft, first.id),
    "First group location",
    first.id,
  );
  const secondLocation = requireIndependent(
    locateIndependentNode(draft, second.id),
    "Second group location",
    second.id,
  );
  if (
    firstLocation.parentNodeId !== undefined &&
    firstLocation.parentNodeId === secondLocation.parentNodeId &&
    firstLocation.childIndex !== undefined &&
    secondLocation.childIndex !== undefined
  ) {
    const parent = requireIndependent(
      draft.nodes.get(firstLocation.parentNodeId),
      "Parent split",
      firstLocation.parentNodeId,
    );
    if (parent.kind !== "split") {
      rejectIndependent(
        "INVALID_COMMAND",
        "Shared group parent is not a split",
        "Repair the workspace",
      );
    }
    const children = [...parent.children];
    children[firstLocation.childIndex] = second.id;
    children[secondLocation.childIndex] = first.id;
    draft.nodes.set(parent.id, { ...parent, children });
    return;
  }
  replaceIndependentAtLocation(draft, firstLocation, first.id, second.id);
  replaceIndependentAtLocation(draft, secondLocation, second.id, first.id);
}

function reduceIndependentSplitGroup(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "split-group" }>,
): void {
  const target = requireIndependent(
    draft.groups.get(command.targetGroupId),
    "Group",
    command.targetGroupId,
  );
  if (
    draft.groups.has(command.newGroupId) ||
    draft.nodes.has(command.newGroupNodeId) ||
    draft.nodes.has(command.splitNodeId) ||
    command.newGroupNodeId === command.splitNodeId
  ) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      "A supplied split, node, or group ID already exists",
      "Supply new stable IDs",
    );
  }
  const ratio = requireRatio(command.ratio, "Split");
  if (
    command.panelIds.length === 0 ||
    !hasUniqueValues(command.panelIds) ||
    command.panelIds.some((id) => !target.panelIds.includes(id)) ||
    command.panelIds.length === target.panelIds.length
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Split panels must be a unique proper subset of the target group",
      "Leave at least one panel in both groups",
    );
  }
  const targetNode = requireIndependent(
    findIndependentGroupNode(draft, target.id),
    "Layout node for group",
    target.id,
  );
  const moved = target.panelIds.filter((id) => command.panelIds.includes(id));
  updateIndependentGroupAfterRemoval(draft, target, moved);
  const group: GroupRecord = {
    id: command.newGroupId,
    panelIds: moved,
    selectedPanelId: moved.includes(target.selectedPanelId)
      ? target.selectedPanelId
      : (moved[0] as PanelId),
    ...(command.region === undefined ? {} : { region: command.region }),
    persistent: false,
  };
  const node: LayoutNode = { kind: "group", id: command.newGroupNodeId, groupId: group.id };
  const split = createIndependentSplit(
    command.splitNodeId,
    command.edge,
    ratio,
    command.newGroupNodeId,
    targetNode.id,
    command.edge.endsWith("start"),
  );
  draft.groups.set(group.id, group);
  draft.nodes.set(node.id, node);
  replaceIndependentNodeReference(draft, targetNode.id, split.id);
  draft.nodes.set(split.id, split);
  activateIndependentPanel(draft, group.selectedPanelId);
}

function reduceIndependentMergeGroups(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "merge-groups" }>,
): void {
  if (command.sourceGroupId === command.target.groupId) {
    rejectIndependent(
      "INVALID_COMMAND",
      "A group cannot be merged into itself",
      "Choose two different groups",
    );
  }
  const source = requireIndependent(
    draft.groups.get(command.sourceGroupId),
    "Source group",
    command.sourceGroupId,
  );
  const target = requireIndependent(
    draft.groups.get(command.target.groupId),
    "Target group",
    command.target.groupId,
  );
  const sourceNode = requireIndependent(
    findIndependentGroupNode(draft, source.id),
    "Source group node",
    source.id,
  );
  const targetNode = requireIndependent(
    findIndependentGroupNode(draft, target.id),
    "Target group node",
    target.id,
  );
  const sourceSurface = requireIndependent(
    findIndependentNodeSurface(draft, sourceNode.id),
    "Source surface",
    sourceNode.id,
  );
  const targetSurface = requireIndependent(
    findIndependentNodeSurface(draft, targetNode.id),
    "Target surface",
    targetNode.id,
  );
  if (sourceSurface.id !== targetSurface.id) {
    rejectIndependent(
      "UNSUPPORTED_OPERATION",
      "Merge-groups cannot cross surface ownership boundaries",
      "Redock the source surface or move the group first",
    );
  }
  const panelIds = insertIndependentPanels(
    target.panelIds,
    source.panelIds,
    command.target.beforePanelId,
    command.target.afterPanelId,
  );
  if (panelIds === undefined) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Merge target anchor is invalid",
      "Choose one live target tab or append",
    );
  }
  draft.groups.set(target.id, populatedIndependentGroup(target, panelIds));
  removeIndependentGroupAndNode(draft, source.id);
  repairIndependentActivation(draft);
}

function panelsBelowIndependentNode(
  draft: IndependentWorkspaceDraft,
  rootNodeId: LayoutNode["id"],
): readonly PanelId[] {
  const panels: PanelId[] = [];
  const stack = [rootNodeId];
  const seen = new Set<LayoutNode["id"]>();
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (nodeId === undefined || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = draft.nodes.get(nodeId);
    if (node?.kind === "group") panels.push(...(draft.groups.get(node.groupId)?.panelIds ?? []));
    if (node?.kind === "split") stack.push(...node.children);
  }
  return panels;
}

function requireIndependentSplitChild(
  draft: IndependentWorkspaceDraft,
  splitNodeId: LayoutNode["id"],
  childNodeId: LayoutNode["id"],
): Extract<LayoutNode, { readonly kind: "split" }> {
  const split = requireIndependent(draft.nodes.get(splitNodeId), "Split node", splitNodeId);
  if (split.kind !== "split" || !split.children.includes(childNodeId)) {
    rejectIndependent(
      "INVALID_COMMAND",
      `Node "${childNodeId}" is not a child of split "${splitNodeId}"`,
      "Choose a current split child",
    );
  }
  return split;
}

function requireIndependentFloatingSurface(
  draft: IndependentWorkspaceDraft,
  id: SurfaceRecord["id"],
): SurfaceRecord {
  const surface = requireIndependent(draft.surfaces.get(id), "Surface", id);
  if (surface.kind !== "floating") {
    rejectIndependent(
      "CAPABILITY_DENIED",
      `Surface "${id}" is not an in-page floating surface`,
      "Choose a floating surface",
    );
  }
  return surface;
}

function reduceIndependentCreateFloatingSurface(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "create-floating-surface" }>,
): void {
  if (draft.surfaces.has(command.surfaceId)) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      `Surface "${command.surfaceId}" already exists`,
      "Supply a new stable surface ID",
    );
  }
  if (!isIndependentFiniteRect(command.bounds)) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Floating bounds must be finite and non-negative",
      "Supply a valid CSS-pixel rectangle",
    );
  }
  const group = requireIndependent(draft.groups.get(command.groupId), "Group", command.groupId);
  if (group.panelIds.some((id) => !draft.panels.get(id)?.capabilities.floatable)) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "At least one panel in the group cannot float",
      "Keep the group docked",
    );
  }
  const node = requireIndependent(
    findIndependentGroupNode(draft, group.id),
    "Layout node for group",
    group.id,
  );
  const sourceSurface = requireIndependent(
    findIndependentNodeSurface(draft, node.id),
    "Source surface",
    node.id,
  );
  if (sourceSurface.capabilities.crossDocument) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "Cross-document content cannot become floating without an ownership protocol",
      "Redock or recover the external surface first",
    );
  }
  if (findIndependentNodeParent(draft, node.id) === undefined) {
    rejectIndependent(
      "INVALID_COMMAND",
      "The sole root group cannot be floated without a safe docked destination",
      "Split the workspace first",
    );
  }
  detachIndependentNode(draft, node.id);
  const surface: SurfaceRecord = {
    id: command.surfaceId,
    kind: "floating",
    rootNodeId: node.id,
    capabilities: FLOATING_SURFACE_CAPABILITIES,
    bounds: command.bounds,
    maximized: false,
  };
  draft.surfaces.set(surface.id, surface);
  draft.floatingOrder.push(surface.id);
  activateIndependentPanel(draft, group.selectedPanelId);
}

function reduceIndependentTransfer(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "transfer-to-browser-window" }>,
): void {
  if (draft.surfaces.has(command.surfaceId)) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      `Surface "${command.surfaceId}" already exists`,
      "Supply a new surface ID",
    );
  }
  if (
    !Number.isSafeInteger(command.ownerEpoch) ||
    command.ownerEpoch < 0 ||
    command.preparedSurfaceToken.trim().length === 0 ||
    (command.bounds !== undefined && !isIndependentFiniteRect(command.bounds))
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Browser transfer requires a prepared token, valid epoch, and optional finite bounds",
      "Prepare the destination before committing transfer",
    );
  }
  const group = requireIndependent(draft.groups.get(command.groupId), "Group", command.groupId);
  if (group.panelIds.some((panelId) => draft.panels.get(panelId)?.capabilities.popout !== true)) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "Every panel in the group must allow browser-window transfer",
      "Keep the group in its current surface",
    );
  }
  const node = requireIndependent(
    findIndependentGroupNode(draft, group.id),
    "Group node",
    group.id,
  );
  const sourceSurface = requireIndependent(
    findIndependentNodeSurface(draft, node.id),
    "Source surface",
    node.id,
  );
  if (sourceSurface.capabilities.crossDocument) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "Browser transfer cannot originate inside another cross-document surface",
      "Redock or recover the source first",
    );
  }
  if (!detachIndependentNode(draft, node.id)) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "The sole surface-root group cannot transfer without a safe source fallback",
      "Split the source surface first",
    );
  }
  const surface: SurfaceRecord = {
    id: command.surfaceId,
    kind: "browser-window",
    rootNodeId: node.id,
    capabilities: BROWSER_WINDOW_SURFACE_CAPABILITIES,
    ...(command.bounds === undefined ? {} : { bounds: command.bounds }),
    maximized: false,
    ownerEpoch: command.ownerEpoch,
  };
  draft.surfaces.set(surface.id, surface);
  activateIndependentPanel(draft, group.selectedPanelId);
}

function reduceIndependentPictureInPicture(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "move-to-picture-in-picture" }>,
): void {
  if (
    draft.groups.has(command.newGroupId) ||
    draft.nodes.has(command.newGroupNodeId) ||
    draft.surfaces.has(command.surfaceId)
  ) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      "Picture-in-Picture IDs must be new",
      "Supply new stable IDs",
    );
  }
  if (
    command.mode !== "move" ||
    !Number.isSafeInteger(command.ownerEpoch) ||
    command.ownerEpoch < 0 ||
    command.capabilityToken.trim().length === 0 ||
    (command.bounds !== undefined && !isIndependentFiniteRect(command.bounds))
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Picture-in-Picture move requires a capability token, valid epoch, and optional finite bounds",
      "Prepare a supported move destination before committing",
    );
  }
  const panel = requireIndependent(draft.panels.get(command.panelId), "Panel", command.panelId);
  if (!panel.capabilities.pictureInPicture) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      `Panel "${panel.id}" cannot enter Picture-in-Picture`,
      "Keep it in the workspace",
    );
  }
  const source = requireIndependent(
    findIndependentPanelGroup(draft, panel.id),
    "Source group",
    panel.id,
  );
  const sourceNode = requireIndependent(
    findIndependentGroupNode(draft, source.id),
    "Source group node",
    source.id,
  );
  const sourceSurface = requireIndependent(
    findIndependentNodeSurface(draft, sourceNode.id),
    "Source surface",
    sourceNode.id,
  );
  if (sourceSurface.capabilities.crossDocument) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "Picture-in-Picture move cannot bypass existing cross-document ownership",
      "Redock or recover the source surface first",
    );
  }
  updateIndependentGroupAfterRemoval(draft, source, [panel.id]);
  const group: GroupRecord = {
    id: command.newGroupId,
    panelIds: [panel.id],
    selectedPanelId: panel.id,
    persistent: false,
  };
  const node: LayoutNode = { kind: "group", id: command.newGroupNodeId, groupId: group.id };
  const surface: SurfaceRecord = {
    id: command.surfaceId,
    kind: "document-pip",
    rootNodeId: node.id,
    capabilities: PICTURE_IN_PICTURE_SURFACE_CAPABILITIES,
    ...(command.bounds === undefined ? {} : { bounds: command.bounds }),
    maximized: false,
    ownerEpoch: command.ownerEpoch,
  };
  draft.groups.set(group.id, group);
  draft.nodes.set(node.id, node);
  draft.surfaces.set(surface.id, surface);
  activateIndependentPanel(draft, panel.id);
}

function reduceIndependentMinimize(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "minimize-surface" }>,
): void {
  const surface = requireIndependentFloatingSurface(draft, command.surfaceId);
  if (surface.minimized === true) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Surface is already minimized",
      "Restore it before minimizing again",
    );
  }
  draft.surfaces.set(surface.id, { ...surface, minimized: true });
  if (draft.activation.activeSurfaceId === surface.id) {
    const fallback = [...draft.groups.values()]
      .filter((group) => {
        if (group.panelIds.length === 0) return false;
        const node = findIndependentGroupNode(draft, group.id);
        return node !== undefined && findIndependentNodeSurface(draft, node.id)?.id !== surface.id;
      })
      .sort((left, right) => compareIndependentIds(String(left.id), String(right.id)))[0];
    if (fallback !== undefined) {
      draft.activation = {};
      activateIndependentPanel(draft, fallback.selectedPanelId);
    }
  }
}

function reduceIndependentRecoverSurface(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "recover-orphaned-surface" }>,
): void {
  const surface = requireIndependent(
    draft.surfaces.get(command.surfaceId),
    "Surface",
    command.surfaceId,
  );
  if (surface.kind === "main" || surface.kind === "embedded") {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "Anchored surfaces cannot be recovered as orphans",
      "Choose an external surface",
    );
  }
  if ((surface.ownerEpoch ?? 0) !== command.expectedOwnerEpoch) {
    rejectIndependent(
      "REVISION_CONFLICT",
      `Surface owner epoch is ${surface.ownerEpoch ?? 0}, not ${command.expectedOwnerEpoch}`,
      "Re-read ownership evidence before recovery",
    );
  }
  if (draft.nodes.has(command.splitNodeId)) {
    rejectIndependent(
      "DUPLICATE_ENTITY",
      `Node "${command.splitNodeId}" already exists`,
      "Supply a new split ID",
    );
  }
  const ratio = requireRatio(command.ratio, "Recovery");
  const targetGroup = requireIndependent(
    draft.groups.get(command.targetGroupId),
    "Recovery target group",
    command.targetGroupId,
  );
  const targetNode = requireIndependent(
    findIndependentGroupNode(draft, targetGroup.id),
    "Recovery target node",
    targetGroup.id,
  );
  const targetSurface = requireIndependent(
    findIndependentNodeSurface(draft, targetNode.id),
    "Recovery target surface",
    targetNode.id,
  );
  if (targetSurface.id === surface.id) {
    rejectIndependent(
      "INVALID_COMMAND",
      "An orphaned surface cannot recover into itself",
      "Choose a group on another surface",
    );
  }
  if (targetSurface.capabilities.crossDocument) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "An orphaned surface cannot recover into a cross-document target",
      "Choose a target on an in-page surface",
    );
  }
  const split = createIndependentSplit(
    command.splitNodeId,
    command.edge,
    ratio,
    surface.rootNodeId,
    targetNode.id,
    command.edge.endsWith("start"),
  );
  draft.surfaces.delete(surface.id);
  draft.floatingOrder = draft.floatingOrder.filter((id) => id !== surface.id);
  replaceIndependentNodeReference(draft, targetNode.id, split.id);
  draft.nodes.set(split.id, split);
}

function reduceIndependentRedock(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "redock-surface" }>,
): void {
  const surface = requireIndependent(
    draft.surfaces.get(command.surfaceId),
    "Surface",
    command.surfaceId,
  );
  if (surface.kind === "main" || surface.kind === "embedded") {
    rejectIndependent(
      "CAPABILITY_DENIED",
      `Surface "${surface.id}" is not detachable`,
      "Choose a floating or external surface",
    );
  }
  if (
    surface.capabilities.crossDocument &&
    command.expectedOwnerEpoch !== (surface.ownerEpoch ?? 0)
  ) {
    rejectIndependent(
      "REVISION_CONFLICT",
      `Redock owner epoch ${String(command.expectedOwnerEpoch)} does not match ${surface.ownerEpoch ?? 0}`,
      "Re-read ownership evidence before redocking",
    );
  }
  const root = requireIndependent(
    draft.nodes.get(surface.rootNodeId),
    "Surface root node",
    surface.rootNodeId,
  );
  if (root.kind !== "group") {
    rejectIndependent(
      "UNSUPPORTED_OPERATION",
      "P0 redock supports floating surfaces containing one group",
      "Merge the floating layout to one group first",
    );
  }
  const source = requireIndependent(draft.groups.get(root.groupId), "Floating group", root.groupId);
  const target = requireIndependent(
    draft.groups.get(command.target.groupId),
    "Target group",
    command.target.groupId,
  );
  if (source.id === target.id) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Floating surface cannot redock into itself",
      "Choose a docked target group",
    );
  }
  const targetNode = requireIndependent(
    findIndependentGroupNode(draft, target.id),
    "Redock target node",
    target.id,
  );
  const targetSurface = requireIndependent(
    findIndependentNodeSurface(draft, targetNode.id),
    "Redock target surface",
    targetNode.id,
  );
  if (targetSurface.capabilities.crossDocument) {
    rejectIndependent(
      "CAPABILITY_DENIED",
      "A surface cannot redock into a cross-document target",
      "Choose a target on an in-page surface",
    );
  }
  const panelIds = insertIndependentPanels(
    target.panelIds,
    source.panelIds,
    command.target.beforePanelId,
    command.target.afterPanelId,
  );
  if (panelIds === undefined) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Redock target anchor is invalid",
      "Choose one live target tab or append",
    );
  }
  draft.groups.set(target.id, populatedIndependentGroup(target, panelIds));
  draft.groups.delete(source.id);
  draft.nodes.delete(root.id);
  draft.surfaces.delete(surface.id);
  draft.floatingOrder = draft.floatingOrder.filter((id) => id !== surface.id);
  repairIndependentActivation(draft);
}

function replaceIndependentWorkspace(
  draft: IndependentWorkspaceDraft,
  snapshot: WorkspaceSnapshot,
): void {
  const replacement = createIndependentDraft(snapshot);
  draft.schemaVersion = replacement.schemaVersion;
  draft.applicationLayoutVersion = replacement.applicationLayoutVersion;
  draft.panels = replacement.panels;
  draft.groups = replacement.groups;
  draft.nodes = replacement.nodes;
  draft.surfaces = replacement.surfaces;
  draft.activation = replacement.activation;
  draft.focusMemory = replacement.focusMemory;
  draft.floatingOrder = replacement.floatingOrder;
  draft.recoverableClosedPanels = replacement.recoverableClosedPanels;
  draft.appliedRemoteTransactions = replacement.appliedRemoteTransactions;
  draft.metadata = replacement.metadata;
}

function mergeIndependentWorkspace(
  draft: IndependentWorkspaceDraft,
  snapshot: WorkspaceSnapshot,
): void {
  if (
    snapshot.schemaVersion !== draft.schemaVersion ||
    snapshot.applicationLayoutVersion !== draft.applicationLayoutVersion
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Merged workspaces must already use the same schema and application layout versions",
      "Migrate the imported workspace before entering the kernel",
    );
  }
  const merge = <Id, Entity>(
    current: Map<Id, Entity>,
    incoming: readonly Entity[],
    idOf: (entity: Entity) => Id,
    kind: string,
  ): void => {
    for (const entity of incoming) {
      const id = idOf(entity);
      if (current.has(id)) {
        rejectIndependent(
          "DUPLICATE_ENTITY",
          `${kind} "${String(id)}" exists in both workspaces`,
          "Remap IDs before merging",
        );
      }
      current.set(id, entity);
    }
  };
  const values = <Entity>(ids: readonly string[], byId: Readonly<Record<string, Entity>>) =>
    ids.flatMap((id) => (byId[id] === undefined ? [] : [byId[id] as Entity]));
  merge(
    draft.panels,
    values(snapshot.panels.ids, snapshot.panels.byId),
    (entity) => entity.id,
    "Panel",
  );
  merge(
    draft.groups,
    values(snapshot.groups.ids, snapshot.groups.byId),
    (entity) => entity.id,
    "Group",
  );
  merge(
    draft.nodes,
    values(snapshot.nodes.ids, snapshot.nodes.byId),
    (entity) => entity.id,
    "Node",
  );
  merge(
    draft.surfaces,
    values(snapshot.surfaces.ids, snapshot.surfaces.byId),
    (entity) => entity.id,
    "Surface",
  );
  const closedIds = new Set(draft.recoverableClosedPanels.map((record) => String(record.id)));
  const closedPanelIds = new Set(
    draft.recoverableClosedPanels.map((record) => String(record.panel.id)),
  );
  for (const record of snapshot.recoverableClosedPanels) {
    if (
      closedIds.has(String(record.id)) ||
      closedPanelIds.has(String(record.panel.id)) ||
      draft.panels.has(record.panel.id)
    ) {
      rejectIndependent(
        "DUPLICATE_ENTITY",
        `Recoverable panel "${record.panel.id}" conflicts while merging`,
        "Remap or resolve recoverable panel identities before merging",
      );
    }
  }
  for (const panel of draft.panels.values()) {
    if (snapshot.recoverableClosedPanels.some((record) => record.panel.id === panel.id)) {
      rejectIndependent(
        "DUPLICATE_ENTITY",
        `Live panel "${panel.id}" conflicts with an imported recoverable panel`,
        "Resolve the panel identity before merging",
      );
    }
  }
  const remoteIds = new Set(draft.appliedRemoteTransactions.map((transaction) => transaction.id));
  if (snapshot.appliedRemoteTransactions.some((transaction) => remoteIds.has(transaction.id))) {
    rejectIndependent(
      "DUPLICATE_TRANSACTION",
      "The imported workspace repeats a remote transaction receipt",
      "Import a snapshot with a disjoint transaction ledger",
    );
  }
  draft.floatingOrder = [...draft.floatingOrder, ...snapshot.floatingOrder];
  draft.recoverableClosedPanels = [
    ...draft.recoverableClosedPanels,
    ...snapshot.recoverableClosedPanels,
  ];
  draft.appliedRemoteTransactions = [
    ...draft.appliedRemoteTransactions,
    ...snapshot.appliedRemoteTransactions,
  ].slice(-APPLIED_REMOTE_TRANSACTION_LIMIT);
  draft.metadata = { ...draft.metadata, ...snapshot.metadata };
  if (draft.activation.activePanelId === undefined) draft.activation = snapshot.activation;
  if (draft.focusMemory.panelId === undefined) draft.focusMemory = snapshot.focusMemory;
}

function applyIndependentWorkspace(
  draft: IndependentWorkspaceDraft,
  snapshot: WorkspaceSnapshot,
  mode: "replace" | "merge",
): void {
  if (mode === "replace") replaceIndependentWorkspace(draft, snapshot);
  else mergeIndependentWorkspace(draft, snapshot);
}

function reduceIndependentRemoteTransaction(
  draft: IndependentWorkspaceDraft,
  command: Extract<WorkspaceCommand, { readonly type: "apply-remote-transaction" }>,
): void {
  if (
    command.transactionId.trim().length === 0 ||
    command.actorId.trim().length === 0 ||
    !Number.isSafeInteger(command.ownerEpoch) ||
    command.ownerEpoch < 0
  ) {
    rejectIndependent(
      "INVALID_COMMAND",
      "Remote transaction identity, actor, and owner epoch must be valid",
      "Provide coordinator-authenticated transaction metadata",
    );
  }
  if (draft.appliedRemoteTransactions.some((item) => item.id === command.transactionId)) {
    rejectIndependent(
      "DUPLICATE_TRANSACTION",
      `Remote transaction "${command.transactionId}" was already applied`,
      "Acknowledge the existing receipt without dispatching it again",
    );
  }
  const surface = requireIndependent(
    draft.surfaces.get(command.surfaceId),
    "Surface",
    command.surfaceId,
  );
  if ((surface.ownerEpoch ?? 0) !== command.ownerEpoch) {
    rejectIndependent(
      "REVISION_CONFLICT",
      `Remote owner epoch ${command.ownerEpoch} is stale; current epoch is ${surface.ownerEpoch ?? 0}`,
      "Request coordinator resynchronization",
    );
  }
  if (
    command.command.type === "restore-workspace" ||
    command.command.type === "import-workspace" ||
    command.command.type === "apply-workspace-preset"
  ) {
    rejectIndependent(
      "UNSUPPORTED_OPERATION",
      "Remote snapshot replacement requires an operational reconciliation protocol",
      "Apply coordinator-approved structural commands instead",
    );
  }
  reduceIndependentCommand(draft, command.command);
  draft.appliedRemoteTransactions = [
    ...draft.appliedRemoteTransactions,
    {
      id: command.transactionId,
      actorId: command.actorId,
      surfaceId: command.surfaceId,
      ownerEpoch: command.ownerEpoch,
    },
  ].slice(-APPLIED_REMOTE_TRANSACTION_LIMIT);
}

function reduceIndependentCommand(
  draft: IndependentWorkspaceDraft,
  command: WorkspaceCommand,
): void {
  switch (command.type) {
    case "batch":
      if (command.commands.length === 0 || command.commands.length > 1_000) {
        rejectIndependent(
          "INVALID_COMMAND",
          "A batch must contain between 1 and 1,000 commands",
          "Split oversized work into bounded atomic transactions",
        );
      }
      for (const nested of command.commands) reduceIndependentCommand(draft, nested);
      return;
    case "open-panel":
      reduceIndependentOpenPanel(draft, command);
      return;
    case "duplicate-panel":
      reduceIndependentDuplicatePanel(draft, command);
      return;
    case "close-panels":
      reduceIndependentClosePanels(draft, command);
      return;
    case "close-other-panels": {
      const group = requireIndependent(draft.groups.get(command.groupId), "Group", command.groupId);
      if (!group.panelIds.includes(command.exceptPanelId)) {
        rejectIndependent(
          "INVALID_COMMAND",
          "The retained panel does not belong to the group",
          "Choose a live panel in the group",
        );
      }
      const expected = group.panelIds.filter(
        (panelId) =>
          panelId !== command.exceptPanelId &&
          draft.panels.get(panelId)?.capabilities.closable === true,
      );
      requireIndependentCloseTargets(expected, command.targets, "Close-other-panels");
      if (expected.length === 0) {
        rejectIndependent(
          "INVALID_COMMAND",
          "There are no other closable panels",
          "Keep the group unchanged",
        );
      }
      reduceIndependentClosePanels(draft, { type: "close-panels", targets: command.targets });
      return;
    }
    case "close-panels-to-right": {
      const group = requireIndependent(draft.groups.get(command.groupId), "Group", command.groupId);
      const index = group.panelIds.indexOf(command.panelId);
      if (index < 0) {
        rejectIndependent(
          "INVALID_COMMAND",
          "The close-to-right anchor does not belong to the group",
          "Choose a live panel in the group",
        );
      }
      const expected = group.panelIds
        .slice(index + 1)
        .filter((panelId) => draft.panels.get(panelId)?.capabilities.closable === true);
      requireIndependentCloseTargets(expected, command.targets, "Close-panels-to-right");
      if (expected.length === 0) {
        rejectIndependent(
          "INVALID_COMMAND",
          "There are no closable panels to the right",
          "Keep the group unchanged",
        );
      }
      reduceIndependentClosePanels(draft, { type: "close-panels", targets: command.targets });
      return;
    }
    case "reopen-panel":
      reduceIndependentReopenPanel(draft, command);
      return;
    case "select-panel": {
      requireIndependent(draft.panels.get(command.panelId), "Panel", command.panelId);
      const group = requireIndependent(
        findIndependentPanelGroup(draft, command.panelId),
        "Group for panel",
        command.panelId,
      );
      draft.groups.set(group.id, { ...group, selectedPanelId: command.panelId });
      if (command.activate !== false) activateIndependentPanel(draft, command.panelId);
      return;
    }
    case "activate-panel":
      requireIndependent(draft.panels.get(command.panelId), "Panel", command.panelId);
      activateIndependentPanel(draft, command.panelId);
      return;
    case "reorder-panels": {
      const group = requireIndependent(draft.groups.get(command.groupId), "Group", command.groupId);
      if (
        command.panelIds.length === 0 ||
        !hasUniqueValues(command.panelIds) ||
        command.panelIds.some((id) => !group.panelIds.includes(id))
      ) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Reorder panels must be a unique non-empty subset of the group",
          "Choose live tabs in the same group",
        );
      }
      const panelIds = insertIndependentPanels(
        group.panelIds,
        command.panelIds,
        command.beforePanelId,
        command.afterPanelId,
      );
      if (panelIds === undefined) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Reorder anchor is invalid",
          "Choose one tab outside the moving set as an anchor",
        );
      }
      draft.groups.set(group.id, { ...group, panelIds });
      return;
    }
    case "move-panel":
      reduceIndependentMovePanel(draft, command);
      return;
    case "move-group":
      reduceIndependentMoveGroup(draft, command);
      return;
    case "split-group":
      reduceIndependentSplitGroup(draft, command);
      return;
    case "merge-groups":
      reduceIndependentMergeGroups(draft, command);
      return;
    case "swap-groups":
      reduceIndependentSwapGroups(draft, command);
      return;
    case "resize-split": {
      const node = requireIndependent(
        draft.nodes.get(command.splitNodeId),
        "Split node",
        command.splitNodeId,
      );
      if (node.kind !== "split")
        rejectIndependent(
          "INVALID_COMMAND",
          `Node "${node.id}" is not a split`,
          "Choose a split node",
        );
      if (
        command.weights.length !== node.children.length ||
        command.weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
      ) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Resize weights must be finite, positive, and match split children",
          "Supply one positive weight per child",
        );
      }
      draft.nodes.set(node.id, { ...node, weights: [...command.weights] });
      return;
    }
    case "equalize-split": {
      const node = requireIndependent(
        draft.nodes.get(command.splitNodeId),
        "Split node",
        command.splitNodeId,
      );
      if (node.kind !== "split")
        rejectIndependent(
          "INVALID_COMMAND",
          `Node "${node.id}" is not a split`,
          "Choose a split node",
        );
      const childIds = command.childIds ?? node.children;
      if (
        childIds.length < 2 ||
        !hasUniqueValues(childIds) ||
        childIds.some((id) => !node.children.includes(id))
      ) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Equalize subset must contain at least two unique children of the split",
          "Choose two or more current split children",
        );
      }
      const selected = new Set(childIds);
      const selectedTotal = node.children.reduce(
        (total, childId, index) => total + (selected.has(childId) ? (node.weights[index] ?? 0) : 0),
        0,
      );
      const equalWeight = selectedTotal / childIds.length;
      draft.nodes.set(node.id, {
        ...node,
        weights: node.children.map((childId, index) =>
          selected.has(childId) ? equalWeight : (node.weights[index] ?? 1),
        ),
      });
      return;
    }
    case "collapse-child": {
      const split = requireIndependentSplitChild(draft, command.splitNodeId, command.childNodeId);
      if (split.collapsedChildIds.includes(command.childNodeId)) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Split child is already collapsed",
          "Keep it collapsed or restore it",
        );
      }
      if (split.children.length - split.collapsedChildIds.length <= 1) {
        rejectIndependent(
          "CAPABILITY_DENIED",
          "The final visible split child cannot be collapsed",
          "Keep one child visible",
        );
      }
      const panelIds = panelsBelowIndependentNode(draft, command.childNodeId);
      if (
        panelIds.length === 0 ||
        panelIds.some((id) => draft.panels.get(id)?.constraints.collapsible !== true)
      ) {
        rejectIndependent(
          "CAPABILITY_DENIED",
          "Every panel below a child must opt into semantic collapse",
          "Keep the child visible",
        );
      }
      draft.nodes.set(split.id, {
        ...split,
        collapsedChildIds: split.children.filter(
          (id) => id === command.childNodeId || split.collapsedChildIds.includes(id),
        ),
      });
      return;
    }
    case "restore-collapsed-child": {
      const split = requireIndependentSplitChild(draft, command.splitNodeId, command.childNodeId);
      if (!split.collapsedChildIds.includes(command.childNodeId)) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Split child is not collapsed",
          "Choose a collapsed child",
        );
      }
      draft.nodes.set(split.id, {
        ...split,
        collapsedChildIds: split.collapsedChildIds.filter((id) => id !== command.childNodeId),
      });
      return;
    }
    case "create-floating-surface":
      reduceIndependentCreateFloatingSurface(draft, command);
      return;
    case "move-floating-surface": {
      const surface = requireIndependentFloatingSurface(draft, command.surfaceId);
      if (
        !Number.isFinite(command.x) ||
        !Number.isFinite(command.y) ||
        surface.bounds === undefined
      ) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Floating position must be finite and the surface must have bounds",
          "Supply finite x and y values",
        );
      }
      draft.surfaces.set(surface.id, {
        ...surface,
        bounds: { ...surface.bounds, x: command.x, y: command.y },
      });
      return;
    }
    case "resize-floating-surface": {
      const surface = requireIndependentFloatingSurface(draft, command.surfaceId);
      if (!isIndependentFiniteRect(command.bounds)) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Floating bounds must be finite and non-negative",
          "Supply a valid CSS-pixel rectangle",
        );
      }
      draft.surfaces.set(surface.id, { ...surface, bounds: command.bounds });
      return;
    }
    case "raise-surface": {
      const surface = requireIndependentFloatingSurface(draft, command.surfaceId);
      draft.floatingOrder = [...draft.floatingOrder.filter((id) => id !== surface.id), surface.id];
      return;
    }
    case "maximize-surface": {
      const surface = requireIndependentFloatingSurface(draft, command.surfaceId);
      if (surface.maximized || surface.minimized === true || surface.bounds === undefined) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Surface is already maximized or lacks restorable bounds",
          "Choose a normal floating surface",
        );
      }
      draft.surfaces.set(surface.id, {
        ...surface,
        restoreBounds: surface.bounds,
        maximized: true,
      });
      return;
    }
    case "restore-surface": {
      const surface = requireIndependentFloatingSurface(draft, command.surfaceId);
      if (surface.minimized === true) {
        const { minimized: _minimized, ...rest } = surface;
        void _minimized;
        draft.surfaces.set(surface.id, rest);
        return;
      }
      if (!surface.maximized || surface.restoreBounds === undefined) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Surface is not maximized or has no restore bounds",
          "Choose a maximized floating surface",
        );
      }
      const { restoreBounds, ...rest } = surface;
      draft.surfaces.set(surface.id, { ...rest, bounds: restoreBounds, maximized: false });
      return;
    }
    case "minimize-surface":
      reduceIndependentMinimize(draft, command);
      return;
    case "transfer-to-browser-window":
      reduceIndependentTransfer(draft, command);
      return;
    case "redock-surface":
      reduceIndependentRedock(draft, command);
      return;
    case "move-to-picture-in-picture":
      reduceIndependentPictureInPicture(draft, command);
      return;
    case "apply-workspace-preset":
      if (command.presetId.trim().length === 0) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Preset ID must be non-empty",
          "Choose a named preset",
        );
      }
      applyIndependentWorkspace(draft, command.snapshot, command.mode);
      return;
    case "restore-workspace":
      replaceIndependentWorkspace(draft, command.snapshot);
      return;
    case "import-workspace":
      if (command.source.trim().length === 0) {
        rejectIndependent(
          "INVALID_COMMAND",
          "Import source must be non-empty",
          "Identify the decoded source",
        );
      }
      applyIndependentWorkspace(draft, command.snapshot, command.mode);
      return;
    case "undo-workspace-operation":
    case "redo-workspace-operation":
      return rejectIndependent(
        "HISTORY_REQUIRED",
        "Undo and redo require WorkspaceKernelState",
        "Use dispatchKernelState",
      );
    case "apply-remote-transaction":
      reduceIndependentRemoteTransaction(draft, command);
      return;
    case "recover-orphaned-surface":
      reduceIndependentRecoverSurface(draft, command);
      return;
  }
}

function independentRejection(
  snapshot: WorkspaceSnapshot,
  envelope: CommandEnvelope,
  failure: IndependentReductionFailure,
): KernelResult {
  return {
    ok: false,
    error: {
      ...failure,
      commandId: envelope.id,
      revision: snapshot.revision,
    },
  };
}

/**
 * Full independent semantic reducer for all 36 public command variants.
 * Reference imports are limited to validation/serialization in the companion
 * workspace module; no reference execution, reduction, canonicalization, diff,
 * transaction replay, or patch application participates in this path.
 */
export function executeIndependentCommand(
  snapshot: WorkspaceSnapshot,
  envelope: CommandEnvelope,
): KernelResult {
  if (String(envelope.id).trim().length === 0) {
    return independentRejection(snapshot, envelope, {
      code: "INVALID_COMMAND",
      message: "Every semantic command requires a stable non-empty command ID",
      remediation: ["Provide a stable command ID"],
    });
  }
  const currentViolations = validateIndependentCandidate(snapshot);
  if (currentViolations.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVARIANT_VIOLATION",
        message: `Current workspace violates ${currentViolations.length} invariant${currentViolations.length === 1 ? "" : "s"}: ${currentViolations[0] ?? "unknown violation"}`,
        remediation: ["Recover or restore a valid snapshot before dispatching commands"],
        commandId: envelope.id,
        revision: snapshot.revision,
      },
    };
  }
  if (envelope.baseRevision !== undefined && envelope.baseRevision !== snapshot.revision) {
    return independentRejection(snapshot, envelope, {
      code: "REVISION_CONFLICT",
      message: `Command is based on revision ${envelope.baseRevision}, but current revision is ${snapshot.revision}`,
      remediation: ["Re-read the workspace and replan the command"],
    });
  }
  if (envelope.label.trim().length === 0) {
    return independentRejection(snapshot, envelope, {
      code: "INVALID_COMMAND",
      message: "Every semantic command requires a human-readable label",
      remediation: ["Provide a concise operation label"],
    });
  }
  if (
    envelope.command.type === "undo-workspace-operation" ||
    envelope.command.type === "redo-workspace-operation"
  ) {
    return independentRejection(snapshot, envelope, {
      code: "HISTORY_REQUIRED",
      message: "Undo and redo require a WorkspaceKernelState",
      remediation: ["Use dispatchKernelState"],
    });
  }

  try {
    const draft = createIndependentDraft(snapshot);
    reduceIndependentCommand(draft, envelope.command);
    const diagnostics = canonicalizeIndependentDraft(draft);
    const canonical = snapshotIndependentDraft(draft);
    const violations = validateIndependentCandidate(canonical);
    if (violations.length > 0) {
      return {
        ok: false,
        error: {
          code: "INVARIANT_VIOLATION",
          message: `Command would violate ${violations.length} workspace invariant${violations.length === 1 ? "" : "s"}: ${violations[0] ?? "unknown violation"}`,
          remediation: ["Keep the current valid workspace", "Inspect the invariant diagnostics"],
          commandId: envelope.id,
          revision: snapshot.revision,
        },
      };
    }
    const revision = nextRevision(snapshot.revision);
    const next = Object.freeze({ ...canonical, revision });
    const patches = diffIndependentSnapshots(snapshot, next);
    const inverse: WorkspaceCommand | undefined =
      envelope.command.type === "apply-remote-transaction"
        ? undefined
        : { type: "restore-workspace", snapshot };
    const transaction = {
      id: envelope.id,
      origin: envelope.origin,
      label: envelope.label,
      previousRevision: snapshot.revision,
      revision,
      command: envelope.command,
      patches,
    } as const;
    return {
      ok: true,
      next,
      patches,
      ...(inverse === undefined ? {} : { inverse }),
      effects: [],
      diagnostics,
      transaction,
    };
  } catch (error) {
    if (error instanceof IndependentRejection) {
      return independentRejection(snapshot, envelope, error.failure);
    }
    throw error;
  }
}

export const INDEPENDENT_SEMANTIC_KERNEL: DifferentialKernelImplementation = Object.freeze({
  id: "@panefold/kernel-optimized.independent-semantic-reducer.v1",
  independent: true,
  execute: executeIndependentCommand,
});
