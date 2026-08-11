import {
  FLOATING_SURFACE_CAPABILITIES,
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
    | "ENTITY_NOT_FOUND"
    | "DUPLICATE_ENTITY"
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
    ...group,
    panelIds,
    selectedPanelId: command.select === false ? group.selectedPanelId : command.panel.id,
  });
  if (command.activate !== false) activatePanel(state, command.panel.id);
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
      .filter((group) => group.panelIds.length > 0 || group.persistent)
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
    ...group,
    panelIds,
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
    ...target,
    panelIds: nextTargetIds,
    selectedPanelId: command.select === false ? target.selectedPanelId : command.panelId,
  });
  if (command.activate !== false) activatePanel(state, command.panelId);
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
  state.groups.set(target.id, { ...target, panelIds });
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
  state.nodes.set(node.id, {
    ...node,
    weights: node.children.map(() => 1),
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

function reduceRedockSurface(
  state: MutableWorkspace,
  command: Extract<WorkspaceCommand, { readonly type: "redock-surface" }>,
): void {
  const surface = requireFloatingSurface(state, command.surfaceId);
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
  state.groups.set(target.id, { ...target, panelIds });
  state.groups.delete(source.id);
  state.nodes.delete(root.id);
  state.surfaces.delete(surface.id);
  state.floatingOrder = state.floatingOrder.filter((id) => id !== surface.id);
  repairActiveAfterRemoval(state);
}

function reduceKnownCommand(state: MutableWorkspace, command: WorkspaceCommand): void {
  switch (command.type) {
    case "open-panel":
      reduceOpenPanel(state, command);
      return;
    case "close-panels":
      reduceClosePanels(state, command);
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
    case "maximize-surface": {
      const surface = requireFloatingSurface(state, command.surfaceId);
      if (surface.maximized || surface.bounds === undefined) {
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
    case "redock-surface":
      reduceRedockSurface(state, command);
      return;
    case "restore-workspace": {
      const restored = toMutable(command.snapshot);
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
      state.metadata = restored.metadata;
      return;
    }
    case "undo-workspace-operation":
    case "redo-workspace-operation":
      reject(
        "HISTORY_REQUIRED",
        "Undo and redo require WorkspaceKernelState",
        "Use dispatchKernelState",
      );
  }
}

export function reduceWorkspace(
  snapshot: WorkspaceSnapshot,
  command: WorkspaceCommand,
): ReductionResult {
  try {
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
