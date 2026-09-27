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
  readonly parentByNode: Map<string, string>;
  readonly nodeByGroup: Map<string, string>;
  readonly groupByPanel: Map<string, string>;
  readonly surfaceByNode: ReadonlyMap<string, string>;
  constraintsIndexed: boolean;
  // These visits belong to one snapshot and one plan, never to shared output.
  visitedConstraints: Set<string> | undefined;
  visitedGeometry: Set<string> | undefined;
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
      if (node?.kind === "split") {
        // Native bulk push is faster for wide splits; avoid its array for small splits.
        if (node.children.length > 16) {
          stack.push(...node.children.map(String));
        } else {
          for (let child = 0; child < node.children.length; child += 1) {
            if (child in node.children) stack.push(String(node.children[child]));
          }
        }
      }
    }
  }

  return {
    snapshot,
    parentByNode,
    nodeByGroup,
    groupByPanel,
    surfaceByNode,
    constraintsIndexed: false,
    visitedConstraints: undefined,
    visitedGeometry: undefined,
  };
}

function indexConstraints(index: SnapshotIndex): void {
  if (index.constraintsIndexed) return;
  const { snapshot, parentByNode, nodeByGroup, groupByPanel } = index;
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
  index.constraintsIndexed = true;
}

function addAncestors(index: SnapshotIndex, nodeId: string, output: Set<string>): void {
  let current: string | undefined = nodeId;
  const seen = (index.visitedConstraints ??= new Set<string>());
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    output.add(current);
    current = index.parentByNode.get(current);
  }
}

function addDescendants(index: SnapshotIndex, nodeId: string, output: Set<string>): void {
  const stack = [nodeId];
  const seen = (index.visitedGeometry ??= new Set<string>());
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    output.add(current);
    const node = index.snapshot.nodes.byId[current];
    if (node?.kind === "split") {
      // Native bulk push is faster for wide splits; avoid its array for small splits.
      if (node.children.length > 16) {
        stack.push(...node.children.map(String));
      } else {
        for (let child = 0; child < node.children.length; child += 1) {
          if (child in node.children) stack.push(String(node.children[child]));
        }
      }
    }
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
  // Tab order is semantic chrome, not a layout constraint. A pure reorder
  // therefore keeps the resolved panel geometry and cached drop targets valid.
  // Selection and membership can change the selected/all-panel constraints.
  if (before.selectedPanelId !== after.selectedPanelId) return true;
  if (before.panelIds.length !== after.panelIds.length) return true;
  const previousMembers = new Set(before.panelIds);
  return after.panelIds.some((panelId) => !previousMembers.has(panelId));
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

function nodeForPanel(index: SnapshotIndex, panelId: string): string | undefined {
  const groupId = index.groupByPanel.get(panelId);
  const nodeId = groupId === undefined ? undefined : index.nodeByGroup.get(groupId);
  return nodeId;
}

function nodeForGroup(index: SnapshotIndex, groupId: string): string | undefined {
  const nodeId = index.nodeByGroup.get(groupId);
  return nodeId;
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
  // Metadata, focus and tab-order-only patches need no topology lookup.
  // Build each index only when a patch actually invalidates geometry.
  let beforeIndex: SnapshotIndex | undefined;
  let afterIndex: SnapshotIndex | undefined;
  const previous = (needsConstraints = false): SnapshotIndex => {
    const index = (beforeIndex ??= createIndex(before));
    if (needsConstraints) indexConstraints(index);
    return index;
  };
  const next = (needsConstraints = false): SnapshotIndex => {
    if (after === before) return previous(needsConstraints);
    const index = (afterIndex ??= createIndex(after));
    if (needsConstraints) indexConstraints(index);
    return index;
  };
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
      const beforeIndex = previous(true);
      const afterIndex = next(true);
      const beforeNode = nodeForPanel(beforeIndex, String(patch.id));
      const afterNode = nodeForPanel(afterIndex, String(patch.id));
      if (beforeNode !== undefined) invalidateConstraintPath(beforeIndex, beforeNode);
      if (afterNode !== undefined) invalidateConstraintPath(afterIndex, afterNode);
      continue;
    }
    if (patch.kind === "group" && groupAffectsConstraints(patch.before, patch.after)) {
      const beforeIndex = previous(true);
      const afterIndex = next(true);
      const beforeNode = nodeForGroup(beforeIndex, String(patch.id));
      const afterNode = nodeForGroup(afterIndex, String(patch.id));
      if (beforeNode !== undefined) invalidateConstraintPath(beforeIndex, beforeNode);
      if (afterNode !== undefined) invalidateConstraintPath(afterIndex, afterNode);
      continue;
    }
    if (patch.kind === "node") {
      const nodeId = String(patch.id);
      if (nodeTopologyChanged(patch.before, patch.after)) {
        invalidateConstraintPath(previous(true), nodeId);
        invalidateConstraintPath(next(true), nodeId);
        invalidateSurfaceIndex(previous(), nodeId);
        invalidateSurfaceIndex(next(), nodeId);
      } else if (nodeAllocationChanged(patch.before, patch.after)) {
        invalidateSubtree(previous(), nodeId);
        invalidateSubtree(next(), nodeId);
      }
      continue;
    }
    if (patch.kind === "surface" && surfaceGeometryChanged(patch.before, patch.after)) {
      if (patch.before !== undefined) {
        addDescendants(previous(), String(patch.before.rootNodeId), geometry);
        surfaces.add(String(patch.before.id));
      }
      if (patch.after !== undefined) {
        addDescendants(next(), String(patch.after.rootNodeId), geometry);
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
