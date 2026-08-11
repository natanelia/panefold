import {
  type Diagnostic,
  type LayoutNode,
  type NodeId,
  type PanelId,
  type SurfaceId,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  NORMALIZED_WEIGHT_TOTAL,
  compareCanonicalStrings,
  findGroupForPanel,
  findNodeForGroup,
  findSurfaceForNode,
  fromMutable,
  toMutable,
  type MutableWorkspace,
} from "./internal";

export interface CanonicalizationResult {
  readonly snapshot: WorkspaceSnapshot;
  readonly diagnostics: readonly Diagnostic[];
}

/** Deterministic largest-remainder normalization with child order as tie-breaker. */
export function normalizeWeights(
  weights: readonly number[],
  total = NORMALIZED_WEIGHT_TOTAL,
): readonly number[] {
  if (
    weights.length === 0 ||
    !Number.isSafeInteger(total) ||
    total < weights.length ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    return [...weights];
  }

  if (
    weights.every((weight) => Number.isSafeInteger(weight)) &&
    weights.reduce((sum, weight) => sum + weight, 0) === total
  ) {
    return [...weights];
  }

  const sum = weights.reduce((value, weight) => value + weight, 0);
  if (!Number.isFinite(sum) || sum <= 0) return [...weights];

  const exact = weights.map((weight) => (weight / sum) * total);
  const result = exact.map((value) => Math.max(1, Math.floor(value)));
  let remainder = total - result.reduce((value, item) => value + item, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const item of order) {
    if (remainder <= 0) break;
    result[item.index] = (result[item.index] ?? 0) + 1;
    remainder -= 1;
  }

  // Extremely small proportions can be rounded up from zero, making the
  // provisional sum exceed the total. Take those units from the largest
  // allocations while preserving the positive-weight invariant.
  if (remainder < 0) {
    const donors = result
      .map((value, index) => ({ index, value }))
      .sort((left, right) => right.value - left.value || left.index - right.index);
    let excess = -remainder;
    for (const donor of donors) {
      if (excess === 0) break;
      const available = Math.max(0, (result[donor.index] ?? 1) - 1);
      const taken = Math.min(available, excess);
      result[donor.index] = (result[donor.index] ?? 1) - taken;
      excess -= taken;
    }
  }
  return result;
}

function canonicalizeGroupSelection(state: MutableWorkspace): void {
  for (const group of state.groups.values()) {
    if (group.panelIds.length === 0 || group.panelIds.includes(group.selectedPanelId)) {
      continue;
    }
    state.groups.set(group.id, {
      ...group,
      selectedPanelId: group.panelIds[0] as PanelId,
    });
  }
}

function canonicalizeNode(
  state: MutableWorkspace,
  nodeId: NodeId,
  path: Set<NodeId>,
  diagnostics: Diagnostic[],
): NodeId | null {
  const node = state.nodes.get(nodeId);
  if (node === undefined || path.has(nodeId)) return nodeId;

  if (node.kind === "group") {
    const group = state.groups.get(node.groupId);
    if (group !== undefined && group.panelIds.length === 0 && !group.persistent) {
      state.groups.delete(group.id);
      state.nodes.delete(node.id);
      diagnostics.push({
        code: "EMPTY_GROUP_REMOVED",
        severity: "info",
        message: `Removed empty transient group "${group.id}"`,
      });
      return null;
    }
    return node.id;
  }

  const nextPath = new Set(path);
  nextPath.add(nodeId);
  const flattenedChildren: NodeId[] = [];
  const flattenedWeights: number[] = [];
  const collapsed = new Set<NodeId>();

  node.children.forEach((childId, index) => {
    const canonicalChildId = canonicalizeNode(state, childId, nextPath, diagnostics);
    if (canonicalChildId === null) return;
    const child = state.nodes.get(canonicalChildId);
    const parentWeight = node.weights[index] ?? 1;
    if (child?.kind === "split" && child.axis === node.axis) {
      const childWeightSum = child.weights.reduce((sum, value) => sum + value, 0);
      child.children.forEach((grandchildId, grandchildIndex) => {
        flattenedChildren.push(grandchildId);
        const childWeight = child.weights[grandchildIndex] ?? 1;
        flattenedWeights.push(
          childWeightSum > 0 ? parentWeight * (childWeight / childWeightSum) : parentWeight,
        );
        if (
          node.collapsedChildIds.includes(childId) ||
          child.collapsedChildIds.includes(grandchildId)
        ) {
          collapsed.add(grandchildId);
        }
      });
      state.nodes.delete(child.id);
      diagnostics.push({
        code: "SAME_AXIS_SPLIT_FLATTENED",
        severity: "info",
        message: `Flattened split "${child.id}" into "${node.id}"`,
      });
      return;
    }

    flattenedChildren.push(canonicalChildId);
    flattenedWeights.push(parentWeight);
    if (node.collapsedChildIds.includes(childId)) collapsed.add(canonicalChildId);
  });

  if (flattenedChildren.length === 0) {
    state.nodes.delete(node.id);
    return null;
  }
  if (flattenedChildren.length === 1) {
    state.nodes.delete(node.id);
    diagnostics.push({
      code: "SINGLE_CHILD_SPLIT_REMOVED",
      severity: "info",
      message: `Removed single-child split "${node.id}"`,
    });
    return flattenedChildren[0] as NodeId;
  }

  const canonical: LayoutNode = {
    kind: "split",
    id: node.id,
    axis: node.axis,
    children: flattenedChildren,
    weights: normalizeWeights(flattenedWeights),
    collapsedChildIds: flattenedChildren.filter((child) => collapsed.has(child)),
  };
  state.nodes.set(node.id, canonical);
  return node.id;
}

function canonicalizeSurfaces(state: MutableWorkspace, diagnostics: Diagnostic[]): void {
  for (const surface of [...state.surfaces.values()].sort((left, right) =>
    compareCanonicalStrings(String(left.id), String(right.id)),
  )) {
    const rootNodeId = canonicalizeNode(state, surface.rootNodeId, new Set(), diagnostics);
    if (rootNodeId === null) {
      state.surfaces.delete(surface.id);
      diagnostics.push({
        code: "EMPTY_SURFACE_REMOVED",
        severity: "info",
        message: `Removed empty surface "${surface.id}"`,
      });
    } else if (rootNodeId !== surface.rootNodeId) {
      state.surfaces.set(surface.id, { ...surface, rootNodeId });
    }
  }

  const floatingIds = [...state.surfaces.values()]
    .filter((surface) => surface.kind === "floating")
    .map((surface) => surface.id)
    .sort((left, right) => compareCanonicalStrings(String(left), String(right)));
  const valid = new Set(floatingIds);
  const seen = new Set<SurfaceId>();
  const retained = state.floatingOrder.filter((id) => {
    if (!valid.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  state.floatingOrder = [...retained, ...floatingIds.filter((id) => !seen.has(id))];
}

function canonicalizeActivation(state: MutableWorkspace): void {
  const livePanel = state.activation.activePanelId;
  if (livePanel !== undefined && state.panels.has(livePanel)) {
    const group = findGroupForPanel(state, livePanel);
    const node = group === undefined ? undefined : findNodeForGroup(state, group.id);
    const surface = node === undefined ? undefined : findSurfaceForNode(state, node.id);
    state.activation = {
      activePanelId: livePanel,
      ...(surface === undefined ? {} : { activeSurfaceId: surface.id }),
    };
    if (
      state.focusMemory.panelId === undefined ||
      !state.panels.has(state.focusMemory.panelId) ||
      state.focusMemory.groupId === undefined ||
      !state.groups.has(state.focusMemory.groupId)
    ) {
      state.focusMemory = {
        panelId: livePanel,
        ...(group === undefined ? {} : { groupId: group.id }),
        fallback: "selected-tab",
      };
    }
    return;
  }

  const group = [...state.groups.values()]
    .filter((candidate) => candidate.panelIds.length > 0)
    .sort((left, right) => compareCanonicalStrings(String(left.id), String(right.id)))[0];
  if (group === undefined) {
    state.activation = {};
    state.focusMemory = { fallback: "workspace-root" };
    return;
  }
  state.activation = { activePanelId: group.selectedPanelId };
  state.focusMemory = {
    panelId: group.selectedPanelId,
    groupId: group.id,
    fallback: "selected-tab",
  };
}

export function canonicalizeWorkspace(snapshot: WorkspaceSnapshot): CanonicalizationResult {
  const state = toMutable(snapshot);
  const diagnostics: Diagnostic[] = [];
  canonicalizeGroupSelection(state);
  canonicalizeSurfaces(state, diagnostics);
  canonicalizeActivation(state);
  return { snapshot: fromMutable(state), diagnostics };
}
