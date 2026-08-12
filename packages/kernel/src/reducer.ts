import {
  APPLIED_REMOTE_TRANSACTION_LIMIT,
  BROWSER_WINDOW_SURFACE_CAPABILITIES,
  FLOATING_SURFACE_CAPABILITIES,
  PICTURE_IN_PICTURE_SURFACE_CAPABILITIES,
  type ClosedPanelRecord,
  type Diagnostic,
  type GroupRecord,
  type LayoutNode,
  type LogicalAxis,
  type PanelId,
  type SurfaceRecord,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  detachNodeReference,
  compareCanonicalStrings,
  findGroupForPanel,
  findNodeForGroup,
  findNodeParent,
  findSurfaceForNode,
  fromMutable,
  insertByAnchor,
  isFiniteRect,
  replaceNodeReference,
  toMutable,
  unique,
  type MutableWorkspace,
} from "./internal";

export interface ReductionFailure {
  readonly code:
    | "REVISION_CONFLICT"
    | "ENTITY_NOT_FOUND"
    | "DUPLICATE_ENTITY"
    | "DUPLICATE_TRANSACTION"
    | "INVALID_COMMAND"
    | "CAPABILITY_DENIED"
    | "HISTORY_REQUIRED"
    | "UNSUPPORTED_OPERATION";
  readonly message: string;
  readonly remediation: readonly string[];
}

export type ReductionResult =
  | {
      readonly ok: true;
      readonly snapshot: WorkspaceSnapshot;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly error: ReductionFailure };

class RejectedReduction extends Error {
  constructor(readonly rejection: ReductionFailure) {
    super(rejection.message);
  }
}

function reject(code: ReductionFailure["code"], message: string, ...remediation: string[]): never {
  throw new RejectedReduction({ code, message, remediation });
}

function requireEntity<T>(entity: T | undefined, kind: string, id: string): T {
  if (entity === undefined) {
    reject(
      "ENTITY_NOT_FOUND",
      `${kind} "${id}" does not exist`,
      `Choose an existing ${kind.toLowerCase()}`,
    );
  }
  return entity;
}

function populatedGroup(group: GroupRecord, panelIds: readonly PanelId[]): GroupRecord {
  const { placeholder: _placeholder, ...rest } = group;
  void _placeholder;
  return { ...rest, panelIds };
}

function updateGroupAfterRemoval(
  state: MutableWorkspace,
  group: GroupRecord,
  removed: readonly PanelId[],
): void {
  const previousIndex = Math.max(0, group.panelIds.indexOf(group.selectedPanelId));
  const panelIds = group.panelIds.filter((id) => !removed.includes(id));
  if (panelIds.length === 0) {
    state.groups.set(group.id, { ...group, panelIds });
    return;
  }

  const selectedPanelId = panelIds.includes(group.selectedPanelId)
    ? group.selectedPanelId
    : (panelIds[Math.min(previousIndex, panelIds.length - 1)] as PanelId);
  state.groups.set(group.id, { ...group, panelIds, selectedPanelId });
}

function surfaceIdForPanel(
  state: MutableWorkspace,
  panelId: PanelId,
): SurfaceRecord["id"] | undefined {
  const group = findGroupForPanel(state, panelId);
  if (group === undefined) return undefined;
  const node = findNodeForGroup(state, group.id);
  if (node === undefined) return undefined;
  return findSurfaceForNode(state, node.id)?.id;
}

function repairActiveAfterRemoval(state: MutableWorkspace, preferredPanelId?: PanelId): void {
  const current = state.activation.activePanelId;
  if (current !== undefined && state.panels.has(current)) return;

  const firstSelected =
    preferredPanelId !== undefined && state.panels.has(preferredPanelId)
      ? preferredPanelId
      : [...state.groups.values()]
          .sort((left, right) => compareCanonicalStrings(String(left.id), String(right.id)))
          .find((group) => group.panelIds.length > 0)?.selectedPanelId;

  if (firstSelected === undefined) {
    state.activation = {};
    state.focusMemory = { fallback: "workspace-root" };
    return;
  }

  const activeSurfaceId = surfaceIdForPanel(state, firstSelected);
  state.activation =
    activeSurfaceId === undefined
      ? { activePanelId: firstSelected }
      : { activePanelId: firstSelected, activeSurfaceId };
  const group = findGroupForPanel(state, firstSelected);
  state.focusMemory = {
    panelId: firstSelected,
    ...(group === undefined ? {} : { groupId: group.id }),
    fallback: "selected-tab",
  };
}

function activatePanel(state: MutableWorkspace, panelId: PanelId): void {
  const panel = requireEntity(state.panels.get(panelId), "Panel", panelId);
  void panel;
  const group = requireEntity(findGroupForPanel(state, panelId), "Group for panel", panelId);
  const activeSurfaceId = surfaceIdForPanel(state, panelId);
  state.activation =
    activeSurfaceId === undefined
      ? { activePanelId: panelId }
      : { activePanelId: panelId, activeSurfaceId };
  state.focusMemory = {
    panelId,
    groupId: group.id,
    fallback: "panel-root",
  };
}

function removeGroupAndNode(state: MutableWorkspace, groupId: GroupRecord["id"]): void {
  const node = findNodeForGroup(state, groupId);
  if (node !== undefined) {
    detachNodeReference(state, node.id);
    state.nodes.delete(node.id);
  }
  state.groups.delete(groupId);
}

function reduceOpenPanel(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "open-panel" }>,
): void {
  if (state.panels.has(command.panel.id)) {
    reject(
      "DUPLICATE_ENTITY",
      `Panel "${command.panel.id}" already exists`,
      "Use a new stable panel ID",
    );
  }
  if (!Number.isSafeInteger(command.panel.typeVersion) || command.panel.typeVersion < 1) {
    reject(
      "INVALID_COMMAND",
      "Panel typeVersion must be a positive safe integer",
      "Provide a version of 1 or greater",
    );
  }
  const sameType = [...state.panels.values()].filter((panel) => panel.type === command.panel.type);
  if (
    sameType.length > 0 &&
    (command.panel.capabilities.singleton || sameType.some((panel) => panel.capabilities.singleton))
  ) {
    reject(
      "CAPABILITY_DENIED",
      `Singleton panel type "${command.panel.type}" is already open`,
      "Activate the existing panel instead",
    );
  }

  const group = requireEntity(
    state.groups.get(command.placement.groupId),
    "Group",
    command.placement.groupId,
  );
  const panelIds = insertByAnchor(
    group.panelIds,
    [command.panel.id],
    command.placement.beforePanelId,
    command.placement.afterPanelId,
  );
  if (panelIds === undefined) {
    reject(
      "INVALID_COMMAND",
      "Open-panel placement anchor is invalid",
      "Choose one live tab anchor or append to the group",
    );
  }

  state.panels.set(command.panel.id, command.panel);
  state.groups.set(group.id, {
    ...populatedGroup(group, panelIds),
    selectedPanelId: command.select === false ? group.selectedPanelId : command.panel.id,
  });
  if (command.activate !== false) activatePanel(state, command.panel.id);
}

function reduceDuplicatePanel(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "duplicate-panel" }>,
): void {
  const source = requireEntity(state.panels.get(command.panelId), "Panel", command.panelId);
  if (source.capabilities.singleton) {
    reject(
      "CAPABILITY_DENIED",
      `Panel "${command.panelId}" is a singleton and cannot be duplicated`,
      "Reuse the existing panel",
    );
  }
  const sourceGroup = requireEntity(
    findGroupForPanel(state, command.panelId),
    "Group for panel",
    command.panelId,
  );
  reduceOpenPanel(state, {
    type: "open-panel",
    panel: { ...source, id: command.duplicatePanelId },
    placement: command.placement ?? {
      groupId: sourceGroup.id,
      afterPanelId: command.panelId,
    },
    ...(command.select === undefined ? {} : { select: command.select }),
    ...(command.activate === undefined ? {} : { activate: command.activate }),
  });
}

function requireExactCloseTargets(
  expectedPanelIds: readonly PanelId[],
  targets: Extract<WorkspaceCommand, { readonly type: "close-panels" }>["targets"],
  intent: string,
): void {
  const suppliedPanelIds = targets.map((target) => target.panelId);
  if (
    expectedPanelIds.length !== suppliedPanelIds.length ||
    expectedPanelIds.some((panelId, index) => panelId !== suppliedPanelIds[index])
  ) {
    reject(
      "INVALID_COMMAND",
      `${intent} targets do not exactly match the current semantic tab order`,
      "Re-read the group and provide one stable closed-record ID per eligible panel",
    );
  }
}

function reduceCloseOtherPanels(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "close-other-panels" }>,
): void {
  const group = requireEntity(state.groups.get(command.groupId), "Group", command.groupId);
  if (!group.panelIds.includes(command.exceptPanelId)) {
    reject(
      "INVALID_COMMAND",
      "The retained panel does not belong to the group",
      "Choose a live panel in the group",
    );
  }
  const expected = group.panelIds.filter(
    (panelId) =>
      panelId !== command.exceptPanelId &&
      state.panels.get(panelId)?.capabilities.closable === true,
  );
  requireExactCloseTargets(expected, command.targets, "Close-other-panels");
  if (expected.length === 0) {
    reject("INVALID_COMMAND", "There are no other closable panels", "Keep the group unchanged");
  }
  reduceClosePanels(state, { type: "close-panels", targets: command.targets });
}

function reduceClosePanelsToRight(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "close-panels-to-right" }>,
): void {
  const group = requireEntity(state.groups.get(command.groupId), "Group", command.groupId);
  const anchorIndex = group.panelIds.indexOf(command.panelId);
  if (anchorIndex < 0) {
    reject(
      "INVALID_COMMAND",
      "The close-to-right anchor does not belong to the group",
      "Choose a live panel in the group",
    );
  }
  const expected = group.panelIds
    .slice(anchorIndex + 1)
    .filter((panelId) => state.panels.get(panelId)?.capabilities.closable === true);
  requireExactCloseTargets(expected, command.targets, "Close-panels-to-right");
  if (expected.length === 0) {
    reject(
      "INVALID_COMMAND",
      "There are no closable panels to the right",
      "Keep the group unchanged",
    );
  }
  reduceClosePanels(state, { type: "close-panels", targets: command.targets });
}

function reduceClosePanels(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "close-panels" }>,
): void {
  const activePanelId = state.activation.activePanelId;
  const activeGroupId =
    activePanelId === undefined ? undefined : findGroupForPanel(state, activePanelId)?.id;

  if (
    command.targets.length === 0 ||
    !unique(command.targets.map((target) => target.panelId)) ||
    !unique(command.targets.map((target) => target.closedPanelId))
  ) {
    reject(
      "INVALID_COMMAND",
      "Close targets must contain unique panel and closed-record IDs",
      "Choose at least one live panel exactly once",
    );
  }

  const existingClosedIds = new Set(state.recoverableClosedPanels.map((record) => record.id));
  for (const target of command.targets) {
    const panel = requireEntity(state.panels.get(target.panelId), "Panel", target.panelId);
    if (!panel.capabilities.closable) {
      reject(
        "CAPABILITY_DENIED",
        `Panel "${target.panelId}" is not closable`,
        "Keep the panel open",
      );
    }
    if (existingClosedIds.has(target.closedPanelId)) {
      reject(
        "DUPLICATE_ENTITY",
        `Closed-panel record "${target.closedPanelId}" already exists`,
        "Use a new stable closed-record ID",
      );
    }
  }

  for (const target of command.targets) {
    const panel = state.panels.get(target.panelId) as NonNullable<
      ReturnType<typeof state.panels.get>
    >;
    const group = requireEntity(
      findGroupForPanel(state, target.panelId),
      "Group for panel",
      target.panelId,
    );
    const index = group.panelIds.indexOf(target.panelId);
    const next = group.panelIds[index + 1];
    const previous = group.panelIds[index - 1];
    const formerPlacement = {
      groupId: group.id,
      ...(next !== undefined
        ? { beforePanelId: next }
        : previous !== undefined
          ? { afterPanelId: previous }
          : {}),
    };
    const record: ClosedPanelRecord = {
      id: target.closedPanelId,
      panel,
      formerPlacement,
      closedAtRevision: state.revision,
    };
    state.recoverableClosedPanels.push(record);
    updateGroupAfterRemoval(state, group, [target.panelId]);
    state.panels.delete(target.panelId);
  }
  const hasReopenDestination = [...state.groups.values()].some(
    (group) => group.panelIds.length > 0 || group.persistent,
  );
  if (!hasReopenDestination && state.recoverableClosedPanels.length > 0) {
    const placeholder = [...state.groups.values()]
      .filter((group) => group.panelIds.length === 0)
      .sort((left, right) => compareCanonicalStrings(String(left.id), String(right.id)))[0];
    if (placeholder !== undefined) {
      state.groups.set(placeholder.id, { ...placeholder, placeholder: true });
    }
  }
  const activeGroup = activeGroupId === undefined ? undefined : state.groups.get(activeGroupId);
  const preferredPanelId =
    activeGroup !== undefined && activeGroup.panelIds.length > 0
      ? activeGroup.selectedPanelId
      : undefined;
  repairActiveAfterRemoval(state, preferredPanelId);
}

function reduceReopenPanel(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "reopen-panel" }>,
): void {
  const index = state.recoverableClosedPanels.findIndex(
    (record) => record.id === command.closedPanelId,
  );
  if (index < 0) {
    reject(
      "ENTITY_NOT_FOUND",
      `Closed panel "${command.closedPanelId}" does not exist`,
      "Choose a recoverable closed panel",
    );
  }
  const record = state.recoverableClosedPanels[index] as ClosedPanelRecord;
  if (state.panels.has(record.panel.id)) {
    reject(
      "DUPLICATE_ENTITY",
      `Panel "${record.panel.id}" is already live`,
      "Remove the stale closed record",
    );
  }

  let placement = command.placement ?? record.formerPlacement;
  if (!state.groups.has(placement.groupId)) {
    const fallbackGroup = [...state.groups.values()]
      .filter(
        (group) => group.panelIds.length > 0 || group.persistent || group.placeholder === true,
      )
      .sort((left, right) => compareCanonicalStrings(String(left.id), String(right.id)))[0];
    if (fallbackGroup === undefined) {
      reject(
        "ENTITY_NOT_FOUND",
        "No destination group is available for reopen",
        "Provide a live destination group",
      );
    }
    placement = { groupId: fallbackGroup.id };
  }

  // A former neighbor may have closed since the record was created. Falling
  // back to append is deterministic and preserves the panel rather than data.
  const group = state.groups.get(placement.groupId) as GroupRecord;
  let panelIds = insertByAnchor(
    group.panelIds,
    [record.panel.id],
    placement.beforePanelId,
    placement.afterPanelId,
  );
  panelIds ??= [...group.panelIds, record.panel.id];
  state.panels.set(record.panel.id, record.panel);
  state.groups.set(group.id, {
    ...populatedGroup(group, panelIds),
    selectedPanelId: command.select === false ? group.selectedPanelId : record.panel.id,
  });
  state.recoverableClosedPanels.splice(index, 1);
  if (command.activate !== false) activatePanel(state, record.panel.id);
}

function reduceSelectPanel(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "select-panel" }>,
): void {
  requireEntity(state.panels.get(command.panelId), "Panel", command.panelId);
  const group = requireEntity(
    findGroupForPanel(state, command.panelId),
    "Group for panel",
    command.panelId,
  );
  state.groups.set(group.id, { ...group, selectedPanelId: command.panelId });
  if (command.activate !== false) activatePanel(state, command.panelId);
}

function reduceReorderPanels(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "reorder-panels" }>,
): void {
  const group = requireEntity(state.groups.get(command.groupId), "Group", command.groupId);
  if (
    command.panelIds.length === 0 ||
    !unique(command.panelIds) ||
    command.panelIds.some((id) => !group.panelIds.includes(id))
  ) {
    reject(
      "INVALID_COMMAND",
      "Reorder panels must be a unique non-empty subset of the group",
      "Choose live tabs in the same group",
    );
  }
  const panelIds = insertByAnchor(
    group.panelIds,
    command.panelIds,
    command.beforePanelId,
    command.afterPanelId,
  );
  if (panelIds === undefined) {
    reject(
      "INVALID_COMMAND",
      "Reorder anchor is invalid",
      "Choose one tab outside the moving set as an anchor",
    );
  }
  state.groups.set(group.id, { ...group, panelIds });
}

function reduceMovePanel(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "move-panel" }>,
): void {
  requireEntity(state.panels.get(command.panelId), "Panel", command.panelId);
  const source = requireEntity(
    findGroupForPanel(state, command.panelId),
    "Source group",
    command.panelId,
  );
  const target = requireEntity(
    state.groups.get(command.target.groupId),
    "Target group",
    command.target.groupId,
  );
  const sourceNode = requireEntity(
    findNodeForGroup(state, source.id),
    "Source group node",
    source.id,
  );
  const targetNode = requireEntity(
    findNodeForGroup(state, target.id),
    "Target group node",
    target.id,
  );
  const sourceSurface = requireEntity(
    findSurfaceForNode(state, sourceNode.id),
    "Source surface",
    sourceNode.id,
  );
  const targetSurface = requireEntity(
    findSurfaceForNode(state, targetNode.id),
    "Target surface",
    targetNode.id,
  );
  if (
    sourceSurface.id !== targetSurface.id &&
    (sourceSurface.capabilities.crossDocument || targetSurface.capabilities.crossDocument)
  ) {
    reject(
      "CAPABILITY_DENIED",
      "A panel cannot move across cross-document ownership without preparation",
      "Use a prepared transfer, redock, or recovery command",
    );
  }
  const targetBase = source.id === target.id ? target.panelIds : target.panelIds;
  const nextTargetIds = insertByAnchor(
    targetBase,
    [command.panelId],
    command.target.beforePanelId,
    command.target.afterPanelId,
  );
  if (nextTargetIds === undefined) {
    reject(
      "INVALID_COMMAND",
      "Move target anchor is invalid",
      "Choose one live destination tab or append",
    );
  }

  if (source.id !== target.id) updateGroupAfterRemoval(state, source, [command.panelId]);
  state.groups.set(target.id, {
    ...populatedGroup(target, nextTargetIds),
    selectedPanelId: command.select === false ? target.selectedPanelId : command.panelId,
  });
  if (command.activate !== false) activatePanel(state, command.panelId);
}

interface NodeLocation {
  readonly parentNodeId?: LayoutNode["id"];
  readonly childIndex?: number;
  readonly surfaceId?: SurfaceRecord["id"];
}

function locateNode(state: MutableWorkspace, nodeId: LayoutNode["id"]): NodeLocation | undefined {
  const parent = findNodeParent(state, nodeId);
  if (parent !== undefined) {
    return { parentNodeId: parent.node.id, childIndex: parent.childIndex };
  }
  const surface = [...state.surfaces.values()].find((item) => item.rootNodeId === nodeId);
  return surface === undefined ? undefined : { surfaceId: surface.id };
}

function replaceAtLocation(
  state: MutableWorkspace,
  location: NodeLocation,
  expectedNodeId: LayoutNode["id"],
  replacementNodeId: LayoutNode["id"],
): void {
  if (location.parentNodeId !== undefined && location.childIndex !== undefined) {
    const parent = requireEntity(
      state.nodes.get(location.parentNodeId),
      "Parent split",
      location.parentNodeId,
    );
    if (parent.kind !== "split" || parent.children[location.childIndex] !== expectedNodeId) {
      reject(
        "INVALID_COMMAND",
        "Layout changed while replacing a group location",
        "Re-read the workspace and replan the command",
      );
    }
    const children = [...parent.children];
    children[location.childIndex] = replacementNodeId;
    state.nodes.set(parent.id, { ...parent, children });
    return;
  }
  if (location.surfaceId !== undefined) {
    const surface = requireEntity(
      state.surfaces.get(location.surfaceId),
      "Surface",
      location.surfaceId,
    );
    if (surface.rootNodeId !== expectedNodeId) {
      reject(
        "INVALID_COMMAND",
        "Surface root changed while replacing a group location",
        "Re-read the workspace and replan the command",
      );
    }
    state.surfaces.set(surface.id, { ...surface, rootNodeId: replacementNodeId });
    return;
  }
  reject("INVALID_COMMAND", "Group node has no reachable layout location", "Repair the workspace");
}

function reduceMoveGroup(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "move-group" }>,
): void {
  if (command.groupId === command.targetGroupId) {
    reject("INVALID_COMMAND", "A group cannot be moved beside itself", "Choose another group");
  }
  if (state.nodes.has(command.splitNodeId)) {
    reject(
      "DUPLICATE_ENTITY",
      `Node "${command.splitNodeId}" already exists`,
      "Supply a new split ID",
    );
  }
  if (!Number.isFinite(command.ratio) || command.ratio <= 0 || command.ratio >= 1) {
    reject(
      "INVALID_COMMAND",
      "Move-group ratio must be between 0 and 1",
      "Choose a ratio such as 0.5",
    );
  }
  const sourceGroup = requireEntity(state.groups.get(command.groupId), "Group", command.groupId);
  const targetGroup = requireEntity(
    state.groups.get(command.targetGroupId),
    "Target group",
    command.targetGroupId,
  );
  if (sourceGroup.panelIds.length === 0) {
    reject(
      "INVALID_COMMAND",
      "An empty placeholder group cannot be moved",
      "Move a populated group",
    );
  }
  const sourceNode = requireEntity(
    findNodeForGroup(state, sourceGroup.id),
    "Group node",
    sourceGroup.id,
  );
  const targetNode = requireEntity(
    findNodeForGroup(state, targetGroup.id),
    "Target group node",
    targetGroup.id,
  );
  const sourceLocation = requireEntity(
    locateNode(state, sourceNode.id),
    "Group location",
    sourceNode.id,
  );

  if (sourceLocation.parentNodeId !== undefined) {
    detachNodeReference(state, sourceNode.id);
  } else if (sourceLocation.surfaceId !== undefined) {
    const sourceSurface = requireEntity(
      state.surfaces.get(sourceLocation.surfaceId),
      "Source surface",
      sourceLocation.surfaceId,
    );
    if (sourceSurface.kind !== "floating") {
      reject(
        "CAPABILITY_DENIED",
        "Only an in-page floating root can move without an ownership recovery protocol",
        "Use redock or recover-orphaned-surface for external ownership",
      );
    }
    state.surfaces.delete(sourceSurface.id);
    state.floatingOrder = state.floatingOrder.filter((id) => id !== sourceSurface.id);
  }

  const movedFirst = command.edge.endsWith("start");
  const ratio = Math.round(command.ratio * 1_000_000);
  const split: LayoutNode = {
    kind: "split",
    id: command.splitNodeId,
    axis: edgeAxis(command.edge),
    children: movedFirst ? [sourceNode.id, targetNode.id] : [targetNode.id, sourceNode.id],
    weights: movedFirst ? [ratio, 1_000_000 - ratio] : [1_000_000 - ratio, ratio],
    collapsedChildIds: [],
  };
  replaceNodeReference(state, targetNode.id, split.id);
  state.nodes.set(split.id, split);
  activatePanel(state, sourceGroup.selectedPanelId);
}

function reduceSwapGroups(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "swap-groups" }>,
): void {
  if (command.firstGroupId === command.secondGroupId) {
    reject("INVALID_COMMAND", "A group cannot be swapped with itself", "Choose two groups");
  }
  const first = requireEntity(
    findNodeForGroup(state, command.firstGroupId),
    "First group node",
    command.firstGroupId,
  );
  const second = requireEntity(
    findNodeForGroup(state, command.secondGroupId),
    "Second group node",
    command.secondGroupId,
  );
  const firstSurface = requireEntity(
    findSurfaceForNode(state, first.id),
    "First group surface",
    first.id,
  );
  const secondSurface = requireEntity(
    findSurfaceForNode(state, second.id),
    "Second group surface",
    second.id,
  );
  if (
    firstSurface.id !== secondSurface.id &&
    (firstSurface.capabilities.crossDocument || secondSurface.capabilities.crossDocument)
  ) {
    reject(
      "CAPABILITY_DENIED",
      "Groups cannot swap across cross-document ownership boundaries",
      "Use a prepared transfer or recovery protocol",
    );
  }
  const firstLocation = requireEntity(
    locateNode(state, first.id),
    "First group location",
    first.id,
  );
  const secondLocation = requireEntity(
    locateNode(state, second.id),
    "Second group location",
    second.id,
  );

  if (
    firstLocation.parentNodeId !== undefined &&
    firstLocation.parentNodeId === secondLocation.parentNodeId &&
    firstLocation.childIndex !== undefined &&
    secondLocation.childIndex !== undefined
  ) {
    const parent = requireEntity(
      state.nodes.get(firstLocation.parentNodeId),
      "Parent split",
      firstLocation.parentNodeId,
    );
    if (parent.kind !== "split") {
      reject("INVALID_COMMAND", "Shared group parent is not a split", "Repair the workspace");
    }
    const children = [...parent.children];
    children[firstLocation.childIndex] = second.id;
    children[secondLocation.childIndex] = first.id;
    state.nodes.set(parent.id, { ...parent, children });
    return;
  }

  replaceAtLocation(state, firstLocation, first.id, second.id);
  replaceAtLocation(state, secondLocation, second.id, first.id);
}

function edgeAxis(edge: Extract<WorkspaceCommand, { type: "split-group" }>["edge"]): LogicalAxis {
  return edge.startsWith("inline") ? "inline" : "block";
}

function reduceSplitGroup(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "split-group" }>,
): void {
  const target = requireEntity(
    state.groups.get(command.targetGroupId),
    "Group",
    command.targetGroupId,
  );
  if (
    state.groups.has(command.newGroupId) ||
    state.nodes.has(command.newGroupNodeId) ||
    state.nodes.has(command.splitNodeId)
  ) {
    reject(
      "DUPLICATE_ENTITY",
      "A supplied split, node, or group ID already exists",
      "Supply new stable IDs",
    );
  }
  if (!Number.isFinite(command.ratio) || command.ratio <= 0 || command.ratio >= 1) {
    reject(
      "INVALID_COMMAND",
      "Split ratio must be greater than 0 and less than 1",
      "Choose a ratio such as 0.5",
    );
  }
  if (
    command.panelIds.length === 0 ||
    !unique(command.panelIds) ||
    command.panelIds.some((id) => !target.panelIds.includes(id)) ||
    command.panelIds.length === target.panelIds.length
  ) {
    reject(
      "INVALID_COMMAND",
      "Split panels must be a unique proper subset of the target group",
      "Leave at least one panel in both groups",
    );
  }
  const targetNode = requireEntity(
    findNodeForGroup(state, target.id),
    "Layout node for group",
    target.id,
  );
  const moved = target.panelIds.filter((id) => command.panelIds.includes(id));
  updateGroupAfterRemoval(state, target, moved);
  const newGroup: GroupRecord = {
    id: command.newGroupId,
    panelIds: moved,
    selectedPanelId: moved.includes(target.selectedPanelId)
      ? target.selectedPanelId
      : (moved[0] as PanelId),
    ...(command.region === undefined ? {} : { region: command.region }),
    persistent: false,
  };
  const newNode: LayoutNode = {
    kind: "group",
    id: command.newGroupNodeId,
    groupId: command.newGroupId,
  };
  const newFirst = command.edge.endsWith("start");
  const ratio = Math.round(command.ratio * 1_000_000);
  const split: LayoutNode = {
    kind: "split",
    id: command.splitNodeId,
    axis: edgeAxis(command.edge),
    children: newFirst
      ? [command.newGroupNodeId, targetNode.id]
      : [targetNode.id, command.newGroupNodeId],
    weights: newFirst ? [ratio, 1_000_000 - ratio] : [1_000_000 - ratio, ratio],
    collapsedChildIds: [],
  };
  state.groups.set(newGroup.id, newGroup);
  state.nodes.set(newNode.id, newNode);
  // Replace the old reference before registering the new split; otherwise a
  // parent lookup could discover the split's own child and create a cycle.
  replaceNodeReference(state, targetNode.id, split.id);
  state.nodes.set(split.id, split);
  activatePanel(state, newGroup.selectedPanelId);
}

function reduceMergeGroups(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "merge-groups" }>,
): void {
  if (command.sourceGroupId === command.target.groupId) {
    reject(
      "INVALID_COMMAND",
      "A group cannot be merged into itself",
      "Choose two different groups",
    );
  }
  const source = requireEntity(
    state.groups.get(command.sourceGroupId),
    "Source group",
    command.sourceGroupId,
  );
  const target = requireEntity(
    state.groups.get(command.target.groupId),
    "Target group",
    command.target.groupId,
  );
  const sourceNode = requireEntity(
    findNodeForGroup(state, source.id),
    "Source group node",
    source.id,
  );
  const targetNode = requireEntity(
    findNodeForGroup(state, target.id),
    "Target group node",
    target.id,
  );
  const sourceSurface = requireEntity(
    findSurfaceForNode(state, sourceNode.id),
    "Source surface",
    sourceNode.id,
  );
  const targetSurface = requireEntity(
    findSurfaceForNode(state, targetNode.id),
    "Target surface",
    targetNode.id,
  );
  if (sourceSurface.id !== targetSurface.id) {
    reject(
      "UNSUPPORTED_OPERATION",
      "Merge-groups cannot cross surface ownership boundaries",
      "Redock the source surface or move the group first",
    );
  }
  const panelIds = insertByAnchor(
    target.panelIds,
    source.panelIds,
    command.target.beforePanelId,
    command.target.afterPanelId,
  );
  if (panelIds === undefined) {
    reject(
      "INVALID_COMMAND",
      "Merge target anchor is invalid",
      "Choose one live target tab or append",
    );
  }
  state.groups.set(target.id, populatedGroup(target, panelIds));
  removeGroupAndNode(state, source.id);
  repairActiveAfterRemoval(state);
}

function reduceResizeSplit(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "resize-split" }>,
): void {
  const node = requireEntity(
    state.nodes.get(command.splitNodeId),
    "Split node",
    command.splitNodeId,
  );
  if (node.kind !== "split") {
    reject("INVALID_COMMAND", `Node "${node.id}" is not a split`, "Choose a split node");
  }
  if (
    command.weights.length !== node.children.length ||
    command.weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    reject(
      "INVALID_COMMAND",
      "Resize weights must be finite, positive, and match split children",
      "Supply one positive weight per child",
    );
  }
  state.nodes.set(node.id, { ...node, weights: [...command.weights] });
}

function reduceEqualizeSplit(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "equalize-split" }>,
): void {
  const node = requireEntity(
    state.nodes.get(command.splitNodeId),
    "Split node",
    command.splitNodeId,
  );
  if (node.kind !== "split") {
    reject("INVALID_COMMAND", `Node "${node.id}" is not a split`, "Choose a split node");
  }
  const childIds = command.childIds ?? node.children;
  if (
    childIds.length < 2 ||
    !unique(childIds) ||
    childIds.some((childId) => !node.children.includes(childId))
  ) {
    reject(
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
  state.nodes.set(node.id, {
    ...node,
    weights: node.children.map((childId, index) =>
      selected.has(childId) ? equalWeight : (node.weights[index] ?? 1),
    ),
  });
}

function panelIdsBelowNode(
  state: MutableWorkspace,
  rootNodeId: LayoutNode["id"],
): readonly PanelId[] {
  const panels: PanelId[] = [];
  const stack = [rootNodeId];
  const seen = new Set<LayoutNode["id"]>();
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (nodeId === undefined || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = state.nodes.get(nodeId);
    if (node?.kind === "group") {
      panels.push(...(state.groups.get(node.groupId)?.panelIds ?? []));
    } else if (node?.kind === "split") {
      stack.push(...node.children);
    }
  }
  return panels;
}

function requireSplitChild(
  state: MutableWorkspace,
  splitNodeId: LayoutNode["id"],
  childNodeId: LayoutNode["id"],
): Extract<LayoutNode, { readonly kind: "split" }> {
  const split = requireEntity(state.nodes.get(splitNodeId), "Split node", splitNodeId);
  if (split.kind !== "split" || !split.children.includes(childNodeId)) {
    reject(
      "INVALID_COMMAND",
      `Node "${childNodeId}" is not a child of split "${splitNodeId}"`,
      "Choose a current split child",
    );
  }
  return split;
}

function reduceCollapseChild(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "collapse-child" }>,
): void {
  const split = requireSplitChild(state, command.splitNodeId, command.childNodeId);
  if (split.collapsedChildIds.includes(command.childNodeId)) {
    reject(
      "INVALID_COMMAND",
      "Split child is already collapsed",
      "Keep it collapsed or restore it",
    );
  }
  const visibleCount = split.children.length - split.collapsedChildIds.length;
  if (visibleCount <= 1) {
    reject(
      "CAPABILITY_DENIED",
      "The final visible split child cannot be collapsed",
      "Keep one child visible",
    );
  }
  const panelIds = panelIdsBelowNode(state, command.childNodeId);
  if (
    panelIds.length === 0 ||
    panelIds.some((panelId) => state.panels.get(panelId)?.constraints.collapsible !== true)
  ) {
    reject(
      "CAPABILITY_DENIED",
      "Every panel below a child must opt into semantic collapse",
      "Keep the child visible",
    );
  }
  state.nodes.set(split.id, {
    ...split,
    collapsedChildIds: split.children.filter(
      (childId) => childId === command.childNodeId || split.collapsedChildIds.includes(childId),
    ),
  });
}

function reduceRestoreCollapsedChild(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "restore-collapsed-child" }>,
): void {
  const split = requireSplitChild(state, command.splitNodeId, command.childNodeId);
  if (!split.collapsedChildIds.includes(command.childNodeId)) {
    reject("INVALID_COMMAND", "Split child is not collapsed", "Choose a collapsed child");
  }
  state.nodes.set(split.id, {
    ...split,
    collapsedChildIds: split.collapsedChildIds.filter((childId) => childId !== command.childNodeId),
  });
}

function reduceCreateFloatingSurface(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "create-floating-surface" }>,
): void {
  if (state.surfaces.has(command.surfaceId)) {
    reject(
      "DUPLICATE_ENTITY",
      `Surface "${command.surfaceId}" already exists`,
      "Supply a new stable surface ID",
    );
  }
  if (!isFiniteRect(command.bounds)) {
    reject(
      "INVALID_COMMAND",
      "Floating bounds must be finite and non-negative",
      "Supply a valid CSS-pixel rectangle",
    );
  }
  const group = requireEntity(state.groups.get(command.groupId), "Group", command.groupId);
  if (group.panelIds.some((id) => !state.panels.get(id)?.capabilities.floatable)) {
    reject(
      "CAPABILITY_DENIED",
      "At least one panel in the group cannot float",
      "Keep the group docked",
    );
  }
  const node = requireEntity(findNodeForGroup(state, group.id), "Layout node for group", group.id);
  const sourceSurface = requireEntity(
    findSurfaceForNode(state, node.id),
    "Source surface",
    node.id,
  );
  if (sourceSurface.capabilities.crossDocument) {
    reject(
      "CAPABILITY_DENIED",
      "Cross-document content cannot become floating without an ownership protocol",
      "Redock or recover the external surface first",
    );
  }
  const parent = findNodeParent(state, node.id);
  if (parent === undefined) {
    reject(
      "INVALID_COMMAND",
      "The sole root group cannot be floated without a safe docked destination",
      "Split the workspace first",
    );
  }
  detachNodeReference(state, node.id);
  const surface: SurfaceRecord = {
    id: command.surfaceId,
    kind: "floating",
    rootNodeId: node.id,
    capabilities: FLOATING_SURFACE_CAPABILITIES,
    bounds: command.bounds,
    maximized: false,
  };
  state.surfaces.set(surface.id, surface);
  state.floatingOrder.push(surface.id);
  activatePanel(state, group.selectedPanelId);
}

function reduceTransferToBrowserWindow(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "transfer-to-browser-window" }>,
): void {
  if (state.surfaces.has(command.surfaceId)) {
    reject(
      "DUPLICATE_ENTITY",
      `Surface "${command.surfaceId}" already exists`,
      "Supply a new surface ID",
    );
  }
  if (
    !Number.isSafeInteger(command.ownerEpoch) ||
    command.ownerEpoch < 0 ||
    command.preparedSurfaceToken.trim().length === 0 ||
    (command.bounds !== undefined && !isFiniteRect(command.bounds))
  ) {
    reject(
      "INVALID_COMMAND",
      "Browser transfer requires a prepared token, valid epoch, and optional finite bounds",
      "Prepare the destination before committing transfer",
    );
  }
  const group = requireEntity(state.groups.get(command.groupId), "Group", command.groupId);
  if (group.panelIds.some((panelId) => state.panels.get(panelId)?.capabilities.popout !== true)) {
    reject(
      "CAPABILITY_DENIED",
      "Every panel in the group must allow browser-window transfer",
      "Keep the group in its current surface",
    );
  }
  const node = requireEntity(findNodeForGroup(state, group.id), "Group node", group.id);
  const sourceSurface = requireEntity(
    findSurfaceForNode(state, node.id),
    "Source surface",
    node.id,
  );
  if (sourceSurface.capabilities.crossDocument) {
    reject(
      "CAPABILITY_DENIED",
      "Browser transfer cannot originate inside another cross-document surface",
      "Redock or recover the source first",
    );
  }
  if (!detachNodeReference(state, node.id)) {
    reject(
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
  state.surfaces.set(surface.id, surface);
  activatePanel(state, group.selectedPanelId);
}

function reduceMoveToPictureInPicture(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "move-to-picture-in-picture" }>,
): void {
  if (
    state.groups.has(command.newGroupId) ||
    state.nodes.has(command.newGroupNodeId) ||
    state.surfaces.has(command.surfaceId)
  ) {
    reject("DUPLICATE_ENTITY", "Picture-in-Picture IDs must be new", "Supply new stable IDs");
  }
  if (
    command.mode !== "move" ||
    !Number.isSafeInteger(command.ownerEpoch) ||
    command.ownerEpoch < 0 ||
    command.capabilityToken.trim().length === 0 ||
    (command.bounds !== undefined && !isFiniteRect(command.bounds))
  ) {
    reject(
      "INVALID_COMMAND",
      "Picture-in-Picture move requires a capability token, valid epoch, and optional finite bounds",
      "Prepare a supported move destination before committing",
    );
  }
  const panel = requireEntity(state.panels.get(command.panelId), "Panel", command.panelId);
  if (!panel.capabilities.pictureInPicture) {
    reject(
      "CAPABILITY_DENIED",
      `Panel "${panel.id}" cannot enter Picture-in-Picture`,
      "Keep it in the workspace",
    );
  }
  const source = requireEntity(findGroupForPanel(state, panel.id), "Source group", panel.id);
  const sourceNode = requireEntity(
    findNodeForGroup(state, source.id),
    "Source group node",
    source.id,
  );
  const sourceSurface = requireEntity(
    findSurfaceForNode(state, sourceNode.id),
    "Source surface",
    sourceNode.id,
  );
  if (sourceSurface.capabilities.crossDocument) {
    reject(
      "CAPABILITY_DENIED",
      "Picture-in-Picture move cannot bypass existing cross-document ownership",
      "Redock or recover the source surface first",
    );
  }
  updateGroupAfterRemoval(state, source, [panel.id]);
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
  state.groups.set(group.id, group);
  state.nodes.set(node.id, node);
  state.surfaces.set(surface.id, surface);
  activatePanel(state, panel.id);
}

function requireFloatingSurface(state: MutableWorkspace, id: SurfaceRecord["id"]): SurfaceRecord {
  const surface = requireEntity(state.surfaces.get(id), "Surface", id);
  if (surface.kind !== "floating") {
    reject(
      "CAPABILITY_DENIED",
      `Surface "${id}" is not an in-page floating surface`,
      "Choose a floating surface",
    );
  }
  return surface;
}

function reduceRaiseSurface(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "raise-surface" }>,
): void {
  const surface = requireFloatingSurface(state, command.surfaceId);
  state.floatingOrder = [...state.floatingOrder.filter((id) => id !== surface.id), surface.id];
}

function reduceMinimizeSurface(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "minimize-surface" }>,
): void {
  const surface = requireFloatingSurface(state, command.surfaceId);
  if (surface.minimized === true) {
    reject("INVALID_COMMAND", "Surface is already minimized", "Restore it before minimizing again");
  }
  state.surfaces.set(surface.id, { ...surface, minimized: true });
  if (state.activation.activeSurfaceId === surface.id) {
    const fallback = [...state.groups.values()]
      .filter((group) => {
        if (group.panelIds.length === 0) return false;
        const node = findNodeForGroup(state, group.id);
        return node !== undefined && findSurfaceForNode(state, node.id)?.id !== surface.id;
      })
      .sort((left, right) => compareCanonicalStrings(String(left.id), String(right.id)))[0];
    if (fallback !== undefined) {
      state.activation = {};
      activatePanel(state, fallback.selectedPanelId);
    }
  }
}

function reduceRecoverOrphanedSurface(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "recover-orphaned-surface" }>,
): void {
  const surface = requireEntity(
    state.surfaces.get(command.surfaceId),
    "Surface",
    command.surfaceId,
  );
  if (surface.kind === "main" || surface.kind === "embedded") {
    reject(
      "CAPABILITY_DENIED",
      "Anchored surfaces cannot be recovered as orphans",
      "Choose an external surface",
    );
  }
  if ((surface.ownerEpoch ?? 0) !== command.expectedOwnerEpoch) {
    reject(
      "REVISION_CONFLICT",
      `Surface owner epoch is ${surface.ownerEpoch ?? 0}, not ${command.expectedOwnerEpoch}`,
      "Re-read ownership evidence before recovery",
    );
  }
  if (state.nodes.has(command.splitNodeId)) {
    reject(
      "DUPLICATE_ENTITY",
      `Node "${command.splitNodeId}" already exists`,
      "Supply a new split ID",
    );
  }
  if (!Number.isFinite(command.ratio) || command.ratio <= 0 || command.ratio >= 1) {
    reject(
      "INVALID_COMMAND",
      "Recovery ratio must be between 0 and 1",
      "Choose a ratio such as 0.5",
    );
  }
  const targetGroup = requireEntity(
    state.groups.get(command.targetGroupId),
    "Recovery target group",
    command.targetGroupId,
  );
  const targetNode = requireEntity(
    findNodeForGroup(state, targetGroup.id),
    "Recovery target node",
    targetGroup.id,
  );
  const targetSurface = requireEntity(
    findSurfaceForNode(state, targetNode.id),
    "Recovery target surface",
    targetNode.id,
  );
  if (targetSurface.id === surface.id) {
    reject(
      "INVALID_COMMAND",
      "An orphaned surface cannot recover into itself",
      "Choose a group on another surface",
    );
  }
  const recoveredFirst = command.edge.endsWith("start");
  const ratio = Math.round(command.ratio * 1_000_000);
  const split: LayoutNode = {
    kind: "split",
    id: command.splitNodeId,
    axis: edgeAxis(command.edge),
    children: recoveredFirst
      ? [surface.rootNodeId, targetNode.id]
      : [targetNode.id, surface.rootNodeId],
    weights: recoveredFirst ? [ratio, 1_000_000 - ratio] : [1_000_000 - ratio, ratio],
    collapsedChildIds: [],
  };
  state.surfaces.delete(surface.id);
  state.floatingOrder = state.floatingOrder.filter((id) => id !== surface.id);
  replaceNodeReference(state, targetNode.id, split.id);
  state.nodes.set(split.id, split);
}

function reduceRedockSurface(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "redock-surface" }>,
): void {
  const surface = requireEntity(
    state.surfaces.get(command.surfaceId),
    "Surface",
    command.surfaceId,
  );
  if (surface.kind === "main" || surface.kind === "embedded") {
    reject(
      "CAPABILITY_DENIED",
      `Surface "${surface.id}" is not detachable`,
      "Choose a floating or external surface",
    );
  }
  if (
    surface.capabilities.crossDocument &&
    command.expectedOwnerEpoch !== (surface.ownerEpoch ?? 0)
  ) {
    reject(
      "REVISION_CONFLICT",
      `Redock owner epoch ${String(command.expectedOwnerEpoch)} does not match ${surface.ownerEpoch ?? 0}`,
      "Re-read ownership evidence before redocking",
    );
  }
  const root = requireEntity(
    state.nodes.get(surface.rootNodeId),
    "Surface root node",
    surface.rootNodeId,
  );
  if (root.kind !== "group") {
    reject(
      "UNSUPPORTED_OPERATION",
      "P0 redock supports floating surfaces containing one group",
      "Merge the floating layout to one group first",
    );
  }
  const source = requireEntity(state.groups.get(root.groupId), "Floating group", root.groupId);
  const target = requireEntity(
    state.groups.get(command.target.groupId),
    "Target group",
    command.target.groupId,
  );
  if (source.id === target.id) {
    reject(
      "INVALID_COMMAND",
      "Floating surface cannot redock into itself",
      "Choose a docked target group",
    );
  }
  const panelIds = insertByAnchor(
    target.panelIds,
    source.panelIds,
    command.target.beforePanelId,
    command.target.afterPanelId,
  );
  if (panelIds === undefined) {
    reject(
      "INVALID_COMMAND",
      "Redock target anchor is invalid",
      "Choose one live target tab or append",
    );
  }
  state.groups.set(target.id, populatedGroup(target, panelIds));
  state.groups.delete(source.id);
  state.nodes.delete(root.id);
  state.surfaces.delete(surface.id);
  state.floatingOrder = state.floatingOrder.filter((id) => id !== surface.id);
  repairActiveAfterRemoval(state);
}

function replaceWorkspaceContents(state: MutableWorkspace, snapshot: WorkspaceSnapshot): void {
  const restored = toMutable(snapshot);
  state.schemaVersion = restored.schemaVersion;
  state.applicationLayoutVersion = restored.applicationLayoutVersion;
  state.panels = restored.panels;
  state.groups = restored.groups;
  state.nodes = restored.nodes;
  state.surfaces = restored.surfaces;
  state.activation = restored.activation;
  state.focusMemory = restored.focusMemory;
  state.floatingOrder = restored.floatingOrder;
  state.recoverableClosedPanels = restored.recoverableClosedPanels;
  state.appliedRemoteTransactions = restored.appliedRemoteTransactions;
  state.metadata = restored.metadata;
}

function mergeWorkspaceContents(state: MutableWorkspace, snapshot: WorkspaceSnapshot): void {
  if (
    snapshot.schemaVersion !== state.schemaVersion ||
    snapshot.applicationLayoutVersion !== state.applicationLayoutVersion
  ) {
    reject(
      "INVALID_COMMAND",
      "Merged workspaces must already use the same schema and application layout versions",
      "Migrate the imported workspace before entering the kernel",
    );
  }

  const mergeTable = <Id, Entity>(
    current: Map<Id, Entity>,
    incoming: readonly Entity[],
    idOf: (entity: Entity) => Id,
    kind: string,
  ): void => {
    for (const entity of incoming) {
      const id = idOf(entity);
      if (current.has(id)) {
        reject(
          "DUPLICATE_ENTITY",
          `${kind} "${String(id)}" exists in both workspaces`,
          "Remap IDs before merging",
        );
      }
      current.set(id, entity);
    }
  };

  mergeTable(
    state.panels,
    snapshot.panels.ids
      .map((id) => snapshot.panels.byId[String(id)])
      .filter((item) => item !== undefined),
    (panel) => panel.id,
    "Panel",
  );
  mergeTable(
    state.groups,
    snapshot.groups.ids
      .map((id) => snapshot.groups.byId[String(id)])
      .filter((item) => item !== undefined),
    (group) => group.id,
    "Group",
  );
  mergeTable(
    state.nodes,
    snapshot.nodes.ids
      .map((id) => snapshot.nodes.byId[String(id)])
      .filter((item) => item !== undefined),
    (node) => node.id,
    "Node",
  );
  mergeTable(
    state.surfaces,
    snapshot.surfaces.ids
      .map((id) => snapshot.surfaces.byId[String(id)])
      .filter((item) => item !== undefined),
    (surface) => surface.id,
    "Surface",
  );

  const closedIds = new Set(state.recoverableClosedPanels.map((record) => String(record.id)));
  const closedPanelIds = new Set(
    state.recoverableClosedPanels.map((record) => String(record.panel.id)),
  );
  for (const record of snapshot.recoverableClosedPanels) {
    if (
      closedIds.has(String(record.id)) ||
      closedPanelIds.has(String(record.panel.id)) ||
      state.panels.has(record.panel.id)
    ) {
      reject(
        "DUPLICATE_ENTITY",
        `Recoverable panel "${record.panel.id}" conflicts while merging`,
        "Remap or resolve recoverable panel identities before merging",
      );
    }
  }
  for (const panel of state.panels.values()) {
    if (snapshot.recoverableClosedPanels.some((record) => record.panel.id === panel.id)) {
      reject(
        "DUPLICATE_ENTITY",
        `Live panel "${panel.id}" conflicts with an imported recoverable panel`,
        "Resolve the panel identity before merging",
      );
    }
  }

  const remoteIds = new Set(state.appliedRemoteTransactions.map((transaction) => transaction.id));
  if (snapshot.appliedRemoteTransactions.some((transaction) => remoteIds.has(transaction.id))) {
    reject(
      "DUPLICATE_TRANSACTION",
      "The imported workspace repeats a remote transaction receipt",
      "Import a snapshot with a disjoint transaction ledger",
    );
  }

  state.floatingOrder = [...state.floatingOrder, ...snapshot.floatingOrder];
  state.recoverableClosedPanels = [
    ...state.recoverableClosedPanels,
    ...snapshot.recoverableClosedPanels,
  ];
  state.appliedRemoteTransactions = [
    ...state.appliedRemoteTransactions,
    ...snapshot.appliedRemoteTransactions,
  ].slice(-APPLIED_REMOTE_TRANSACTION_LIMIT);
  state.metadata = { ...state.metadata, ...snapshot.metadata };
  if (state.activation.activePanelId === undefined) state.activation = snapshot.activation;
  if (state.focusMemory.panelId === undefined) state.focusMemory = snapshot.focusMemory;
}

function applySnapshotCommand(
  state: MutableWorkspace,
  snapshot: WorkspaceSnapshot,
  mode: "replace" | "merge",
): void {
  if (mode === "replace") replaceWorkspaceContents(state, snapshot);
  else mergeWorkspaceContents(state, snapshot);
}

function reduceApplyRemoteTransaction(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "apply-remote-transaction" }>,
): void {
  if (
    command.transactionId.trim().length === 0 ||
    command.actorId.trim().length === 0 ||
    !Number.isSafeInteger(command.ownerEpoch) ||
    command.ownerEpoch < 0
  ) {
    reject(
      "INVALID_COMMAND",
      "Remote transaction identity, actor, and owner epoch must be valid",
      "Provide coordinator-authenticated transaction metadata",
    );
  }
  if (
    state.appliedRemoteTransactions.some((transaction) => transaction.id === command.transactionId)
  ) {
    reject(
      "DUPLICATE_TRANSACTION",
      `Remote transaction "${command.transactionId}" was already applied`,
      "Acknowledge the existing receipt without dispatching it again",
    );
  }
  const surface = requireEntity(
    state.surfaces.get(command.surfaceId),
    "Surface",
    command.surfaceId,
  );
  if ((surface.ownerEpoch ?? 0) !== command.ownerEpoch) {
    reject(
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
    reject(
      "UNSUPPORTED_OPERATION",
      "Remote snapshot replacement requires an operational reconciliation protocol",
      "Apply coordinator-approved structural commands instead",
    );
  }
  reduceKnownCommand(state, command.command);
  state.appliedRemoteTransactions = [
    ...state.appliedRemoteTransactions,
    {
      id: command.transactionId,
      actorId: command.actorId,
      surfaceId: command.surfaceId,
      ownerEpoch: command.ownerEpoch,
    },
  ].slice(-APPLIED_REMOTE_TRANSACTION_LIMIT);
}

function reduceKnownCommand(state: MutableWorkspace, command: WorkspaceCommand): void {
  switch (command.type) {
    case "batch":
      if (command.commands.length === 0 || command.commands.length > 1_000) {
        reject(
          "INVALID_COMMAND",
          "A batch must contain between 1 and 1,000 commands",
          "Split oversized work into bounded atomic transactions",
        );
      }
      for (const nested of command.commands) reduceKnownCommand(state, nested);
      return;
    case "open-panel":
      reduceOpenPanel(state, command);
      return;
    case "duplicate-panel":
      reduceDuplicatePanel(state, command);
      return;
    case "close-panels":
      reduceClosePanels(state, command);
      return;
    case "close-other-panels":
      reduceCloseOtherPanels(state, command);
      return;
    case "close-panels-to-right":
      reduceClosePanelsToRight(state, command);
      return;
    case "reopen-panel":
      reduceReopenPanel(state, command);
      return;
    case "select-panel":
      reduceSelectPanel(state, command);
      return;
    case "activate-panel":
      requireEntity(state.panels.get(command.panelId), "Panel", command.panelId);
      activatePanel(state, command.panelId);
      return;
    case "reorder-panels":
      reduceReorderPanels(state, command);
      return;
    case "move-panel":
      reduceMovePanel(state, command);
      return;
    case "move-group":
      reduceMoveGroup(state, command);
      return;
    case "swap-groups":
      reduceSwapGroups(state, command);
      return;
    case "split-group":
      reduceSplitGroup(state, command);
      return;
    case "merge-groups":
      reduceMergeGroups(state, command);
      return;
    case "resize-split":
      reduceResizeSplit(state, command);
      return;
    case "equalize-split":
      reduceEqualizeSplit(state, command);
      return;
    case "collapse-child":
      reduceCollapseChild(state, command);
      return;
    case "restore-collapsed-child":
      reduceRestoreCollapsedChild(state, command);
      return;
    case "create-floating-surface":
      reduceCreateFloatingSurface(state, command);
      return;
    case "move-floating-surface": {
      const surface = requireFloatingSurface(state, command.surfaceId);
      if (
        !Number.isFinite(command.x) ||
        !Number.isFinite(command.y) ||
        surface.bounds === undefined
      ) {
        reject(
          "INVALID_COMMAND",
          "Floating position must be finite and the surface must have bounds",
          "Supply finite x and y values",
        );
      }
      state.surfaces.set(surface.id, {
        ...surface,
        bounds: { ...surface.bounds, x: command.x, y: command.y },
      });
      return;
    }
    case "resize-floating-surface": {
      const surface = requireFloatingSurface(state, command.surfaceId);
      if (!isFiniteRect(command.bounds)) {
        reject(
          "INVALID_COMMAND",
          "Floating bounds must be finite and non-negative",
          "Supply a valid CSS-pixel rectangle",
        );
      }
      state.surfaces.set(surface.id, { ...surface, bounds: command.bounds });
      return;
    }
    case "raise-surface":
      reduceRaiseSurface(state, command);
      return;
    case "maximize-surface": {
      const surface = requireFloatingSurface(state, command.surfaceId);
      if (surface.maximized || surface.minimized === true || surface.bounds === undefined) {
        reject(
          "INVALID_COMMAND",
          "Surface is already maximized or lacks restorable bounds",
          "Choose a normal floating surface",
        );
      }
      state.surfaces.set(surface.id, {
        ...surface,
        restoreBounds: surface.bounds,
        maximized: true,
      });
      return;
    }
    case "restore-surface": {
      const surface = requireFloatingSurface(state, command.surfaceId);
      if (surface.minimized === true) {
        const { minimized: _minimized, ...rest } = surface;
        void _minimized;
        state.surfaces.set(surface.id, rest);
        return;
      }
      if (!surface.maximized || surface.restoreBounds === undefined) {
        reject(
          "INVALID_COMMAND",
          "Surface is not maximized or has no restore bounds",
          "Choose a maximized floating surface",
        );
      }
      const { restoreBounds, ...rest } = surface;
      state.surfaces.set(surface.id, {
        ...rest,
        bounds: restoreBounds,
        maximized: false,
      });
      return;
    }
    case "minimize-surface":
      reduceMinimizeSurface(state, command);
      return;
    case "transfer-to-browser-window":
      reduceTransferToBrowserWindow(state, command);
      return;
    case "redock-surface":
      reduceRedockSurface(state, command);
      return;
    case "move-to-picture-in-picture":
      reduceMoveToPictureInPicture(state, command);
      return;
    case "apply-workspace-preset":
      if (command.presetId.trim().length === 0) {
        reject("INVALID_COMMAND", "Preset ID must be non-empty", "Choose a named preset");
      }
      applySnapshotCommand(state, command.snapshot, command.mode);
      return;
    case "restore-workspace": {
      replaceWorkspaceContents(state, command.snapshot);
      return;
    }
    case "import-workspace":
      if (command.source.trim().length === 0) {
        reject("INVALID_COMMAND", "Import source must be non-empty", "Identify the decoded source");
      }
      applySnapshotCommand(state, command.snapshot, command.mode);
      return;
    case "apply-remote-transaction":
      reduceApplyRemoteTransaction(state, command);
      return;
    case "recover-orphaned-surface":
      reduceRecoverOrphanedSurface(state, command);
      return;
    case "undo-workspace-operation":
    case "redo-workspace-operation":
      return reject(
        "HISTORY_REQUIRED",
        "Undo and redo require WorkspaceKernelState",
        "Use dispatchKernelState",
      );
    default: {
      const unhandled: never = command;
      reject(
        "INVALID_COMMAND",
        `Unknown workspace command type: ${String((unhandled as { readonly type?: unknown }).type)}`,
        "Decode commands against the supported command schema",
      );
    }
  }
}

export function reduceWorkspace(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
): ReductionResult {
  try {
    if (
      command === null ||
      typeof command !== "object" ||
      typeof (command as { readonly type?: unknown }).type !== "string"
    ) {
      reject(
        "INVALID_COMMAND",
        "Workspace command must be a typed object with a command type",
        "Decode the command before entering the kernel",
      );
    }
    const state = toMutable(snapshot);
    reduceKnownCommand(state, command);
    return { ok: true, snapshot: fromMutable(state), diagnostics: [] };
  } catch (error) {
    if (error instanceof RejectedReduction) {
      return { ok: false, error: error.rejection };
    }
    throw error;
  }
}
