import type {
  GroupRecord,
  LayoutNode,
  PanelRecord,
  SurfaceRecord,
  WorkspacePatch,
  WorkspaceSnapshot,
} from "@panefold/model";

/**
 * A deterministic, conservative invalidation plan for incremental geometry
 * consumers. Constraint paths and geometry subtrees are kept separate so a
 * weight-only resize does not evict unrelated branches.
 */
export interface LayoutInvalidationPlan {
  /** Nodes whose aggregated constraint memo is stale. */
  readonly constraintNodeIds: readonly string[];
  /** Nodes whose resolved rectangles or splitters may have changed. */
  readonly geometryNodeIds: readonly string[];
  /** Surfaces containing affected geometry. */
  readonly surfaceIds: readonly string[];
  /** Surfaces whose node/root lookup index must be rebuilt. */
  readonly surfaceIndexIds: readonly string[];
}

interface SnapshotIndex {
  readonly snapshot: WorkspaceSnapshot;
  readonly parentByNode: ReadonlyMap<string, string>;
  readonly nodeByGroup: ReadonlyMap<string, string>;
  readonly groupByPanel: ReadonlyMap<string, string>;
  readonly surfaceByNode: ReadonlyMap<string, string>;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: ReadonlySet<string>): readonly string[] {
  return Object.freeze([...values].sort(compare));
}

function shallowEqual(left: object | undefined, right: object | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
  );
}

function createIndex(snapshot: WorkspaceSnapshot): SnapshotIndex {
  const parentByNode = new Map<string, string>();
  const nodeByGroup = new Map<string, string>();
  const groupByPanel = new Map<string, string>();
  const surfaceByNode = new Map<string, string>();

  for (const groupId of snapshot.groups.ids) {
    const group = snapshot.groups.byId[String(groupId)];
    if (group === undefined) continue;
    for (const panelId of group.panelIds) groupByPanel.set(String(panelId), String(group.id));
  }
  for (const nodeId of snapshot.nodes.ids) {
    const node = snapshot.nodes.byId[String(nodeId)];
    if (node?.kind === "group") nodeByGroup.set(String(node.groupId), String(node.id));
    if (node?.kind === "split") {
      for (const childId of node.children) parentByNode.set(String(childId), String(node.id));
    }
  }
  for (const surfaceId of snapshot.surfaces.ids) {
    const surface = snapshot.surfaces.byId[String(surfaceId)];
    if (surface === undefined) continue;
    const stack = [String(surface.rootNodeId)];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (nodeId === undefined || seen.has(nodeId)) continue;
      seen.add(nodeId);
      surfaceByNode.set(nodeId, String(surface.id));
      const node = snapshot.nodes.byId[nodeId];
      if (node?.kind === "split") stack.push(...node.children.map(String));
    }
  }

  return { snapshot, parentByNode, nodeByGroup, groupByPanel, surfaceByNode };
}

function addAncestors(index: SnapshotIndex, nodeId: string, output: Set<string>): void {
  let current: string | undefined = nodeId;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    output.add(current);
    current = index.parentByNode.get(current);
  }
}

function addDescendants(index: SnapshotIndex, nodeId: string, output: Set<string>): void {
  const stack = [nodeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    output.add(current);
    const node = index.snapshot.nodes.byId[current];
    if (node?.kind === "split") stack.push(...node.children.map(String));
  }
}

function addContainingSurface(
  index: SnapshotIndex,
  nodeId: string,
  surfaces: Set<string>,
): string | undefined {
  const surfaceId = index.surfaceByNode.get(nodeId);
  if (surfaceId !== undefined) surfaces.add(surfaceId);
  return surfaceId;
}

function addSurfaceGeometry(
  index: SnapshotIndex,
  nodeId: string,
  geometry: Set<string>,
  surfaces: Set<string>,
): void {
  const surfaceId = addContainingSurface(index, nodeId, surfaces);
  const surface =
    surfaceId === undefined ? undefined : index.snapshot.surfaces.byId[String(surfaceId)];
  if (surface !== undefined) addDescendants(index, String(surface.rootNodeId), geometry);
}

function panelAffectsConstraints(
  before: PanelRecord | undefined,
  after: PanelRecord | undefined,
): boolean {
  if (before === undefined || after === undefined) return true;
  return !shallowEqual(before.constraints, after.constraints);
}

function groupAffectsConstraints(
  before: GroupRecord | undefined,
  after: GroupRecord | undefined,
): boolean {
  if (before === undefined || after === undefined) return true;
  return (
    before.selectedPanelId !== after.selectedPanelId ||
    before.panelIds.length !== after.panelIds.length ||
    before.panelIds.some((panelId, index) => panelId !== after.panelIds[index])
  );
}

function nodeTopologyChanged(
  before: LayoutNode | undefined,
  after: LayoutNode | undefined,
): boolean {
  if (before === undefined || after === undefined || before.kind !== after.kind) return true;
  if (before.kind === "group" && after.kind === "group") return before.groupId !== after.groupId;
  if (before.kind !== "split" || after.kind !== "split") return true;
  return (
    before.axis !== after.axis ||
    before.children.length !== after.children.length ||
    before.children.some((childId, index) => childId !== after.children[index])
  );
}

function nodeAllocationChanged(
  before: LayoutNode | undefined,
  after: LayoutNode | undefined,
): boolean {
  if (before?.kind !== "split" || after?.kind !== "split") return false;
  return (
    before.weights.length !== after.weights.length ||
    before.weights.some((weight, index) => weight !== after.weights[index]) ||
    before.collapsedChildIds.length !== after.collapsedChildIds.length ||
    before.collapsedChildIds.some((childId, index) => childId !== after.collapsedChildIds[index])
  );
}

function surfaceGeometryChanged(
  before: SurfaceRecord | undefined,
  after: SurfaceRecord | undefined,
): boolean {
  if (before === undefined || after === undefined) return true;
  return (
    before.rootNodeId !== after.rootNodeId ||
    !shallowEqual(before.bounds, after.bounds) ||
    before.maximized !== after.maximized ||
    before.minimized !== after.minimized
  );
}

function nodesForPanel(index: SnapshotIndex, panelId: string): readonly string[] {
  const groupId = index.groupByPanel.get(panelId);
  const nodeId = groupId === undefined ? undefined : index.nodeByGroup.get(groupId);
  return nodeId === undefined ? [] : [nodeId];
}

function nodesForGroup(index: SnapshotIndex, groupId: string): readonly string[] {
  const nodeId = index.nodeByGroup.get(groupId);
  return nodeId === undefined ? [] : [nodeId];
}

/**
 * Calculates geometry invalidation directly from canonical patches. The plan
 * is safe to use before publishing `after`: removed topology is discovered
 * through `before`, while inserted topology is discovered through `after`.
 */
export function planLayoutInvalidation(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  patches: readonly WorkspacePatch[],
): LayoutInvalidationPlan {
  const beforeIndex = createIndex(before);
  const afterIndex = createIndex(after);
  const constraints = new Set<string>();
  const geometry = new Set<string>();
  const surfaces = new Set<string>();
  const surfaceIndexes = new Set<string>();

  const invalidateConstraintPath = (index: SnapshotIndex, nodeId: string): void => {
    addAncestors(index, nodeId, constraints);
    addSurfaceGeometry(index, nodeId, geometry, surfaces);
  };
  const invalidateSubtree = (index: SnapshotIndex, nodeId: string): void => {
    addDescendants(index, nodeId, geometry);
    addContainingSurface(index, nodeId, surfaces);
  };
  const invalidateSurfaceIndex = (index: SnapshotIndex, nodeId: string): void => {
    const surfaceId = addContainingSurface(index, nodeId, surfaces);
    if (surfaceId !== undefined) surfaceIndexes.add(surfaceId);
  };

  for (const patch of patches) {
    if (patch.kind === "panel" && panelAffectsConstraints(patch.before, patch.after)) {
      for (const nodeId of nodesForPanel(beforeIndex, String(patch.id))) {
        invalidateConstraintPath(beforeIndex, nodeId);
      }
      for (const nodeId of nodesForPanel(afterIndex, String(patch.id))) {
        invalidateConstraintPath(afterIndex, nodeId);
      }
      continue;
    }
    if (patch.kind === "group" && groupAffectsConstraints(patch.before, patch.after)) {
      for (const nodeId of nodesForGroup(beforeIndex, String(patch.id))) {
        invalidateConstraintPath(beforeIndex, nodeId);
      }
      for (const nodeId of nodesForGroup(afterIndex, String(patch.id))) {
        invalidateConstraintPath(afterIndex, nodeId);
      }
      continue;
    }
    if (patch.kind === "node") {
      const nodeId = String(patch.id);
      if (nodeTopologyChanged(patch.before, patch.after)) {
        invalidateConstraintPath(beforeIndex, nodeId);
        invalidateConstraintPath(afterIndex, nodeId);
        invalidateSurfaceIndex(beforeIndex, nodeId);
        invalidateSurfaceIndex(afterIndex, nodeId);
      } else if (nodeAllocationChanged(patch.before, patch.after)) {
        invalidateSubtree(beforeIndex, nodeId);
        invalidateSubtree(afterIndex, nodeId);
      }
      continue;
    }
    if (patch.kind === "surface" && surfaceGeometryChanged(patch.before, patch.after)) {
      if (patch.before !== undefined) {
        addDescendants(beforeIndex, String(patch.before.rootNodeId), geometry);
        surfaces.add(String(patch.before.id));
      }
      if (patch.after !== undefined) {
        addDescendants(afterIndex, String(patch.after.rootNodeId), geometry);
        surfaces.add(String(patch.after.id));
      }
      if (patch.before?.rootNodeId !== patch.after?.rootNodeId) {
        if (patch.before !== undefined) surfaceIndexes.add(String(patch.before.id));
        if (patch.after !== undefined) surfaceIndexes.add(String(patch.after.id));
      }
    }
  }

  return Object.freeze({
    constraintNodeIds: sorted(constraints),
    geometryNodeIds: sorted(geometry),
    surfaceIds: sorted(surfaces),
    surfaceIndexIds: sorted(surfaceIndexes),
  });
}
