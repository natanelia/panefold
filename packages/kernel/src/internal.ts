import {
  type ClosedPanelRecord,
  type EntityTable,
  type GroupId,
  type GroupRecord,
  type LayoutNode,
  type NodeId,
  type PanelId,
  type PanelRecord,
  type SurfaceId,
  type SurfaceRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";

export const NORMALIZED_WEIGHT_TOTAL = 1_000_000;

/** Stable UTF-16 code-unit ordering; independent of host locale and ICU data. */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createCanonicalEntityTable<Id extends string, Entity extends { readonly id: Id }>(
  entities: readonly Entity[],
): EntityTable<Id, Entity> {
  const sorted = [...entities].sort((left, right) =>
    compareCanonicalStrings(String(left.id), String(right.id)),
  );
  const byId: Record<string, Entity> = Object.create(null) as Record<string, Entity>;
  for (const entity of sorted) byId[String(entity.id)] = entity;
  return Object.freeze({
    ids: Object.freeze(sorted.map((entity) => entity.id)),
    byId: Object.freeze(byId),
  });
}

export interface MutableWorkspace {
  schemaVersion: number;
  applicationLayoutVersion: number;
  revision: WorkspaceSnapshot["revision"];
  panels: Map<PanelId, PanelRecord>;
  groups: Map<GroupId, GroupRecord>;
  nodes: Map<NodeId, LayoutNode>;
  surfaces: Map<SurfaceId, SurfaceRecord>;
  activation: WorkspaceSnapshot["activation"];
  focusMemory: WorkspaceSnapshot["focusMemory"];
  floatingOrder: SurfaceId[];
  recoverableClosedPanels: ClosedPanelRecord[];
  metadata: WorkspaceSnapshot["metadata"];
}

function tableToMap<Id extends string, Entity extends { readonly id: Id }>(
  ids: readonly Id[],
  byId: Readonly<Record<string, Entity>>,
): Map<Id, Entity> {
  return new Map(ids.map((id) => [id, byId[String(id)] as Entity]));
}

export function toMutable(snapshot: WorkspaceSnapshot): MutableWorkspace {
  return {
    schemaVersion: snapshot.schemaVersion,
    applicationLayoutVersion: snapshot.applicationLayoutVersion,
    revision: snapshot.revision,
    panels: tableToMap(snapshot.panels.ids, snapshot.panels.byId),
    groups: tableToMap(snapshot.groups.ids, snapshot.groups.byId),
    nodes: tableToMap(snapshot.nodes.ids, snapshot.nodes.byId),
    surfaces: tableToMap(snapshot.surfaces.ids, snapshot.surfaces.byId),
    activation: snapshot.activation,
    focusMemory: snapshot.focusMemory,
    floatingOrder: [...snapshot.floatingOrder],
    recoverableClosedPanels: [...snapshot.recoverableClosedPanels],
    metadata: snapshot.metadata,
  };
}

export function fromMutable(state: MutableWorkspace): WorkspaceSnapshot {
  return Object.freeze({
    schemaVersion: state.schemaVersion,
    applicationLayoutVersion: state.applicationLayoutVersion,
    revision: state.revision,
    panels: createCanonicalEntityTable<PanelId, PanelRecord>([...state.panels.values()]),
    groups: createCanonicalEntityTable<GroupId, GroupRecord>([...state.groups.values()]),
    nodes: createCanonicalEntityTable<NodeId, LayoutNode>([...state.nodes.values()]),
    surfaces: createCanonicalEntityTable<SurfaceId, SurfaceRecord>([...state.surfaces.values()]),
    activation: Object.freeze(state.activation),
    focusMemory: Object.freeze(state.focusMemory),
    floatingOrder: Object.freeze([...state.floatingOrder]),
    recoverableClosedPanels: Object.freeze([...state.recoverableClosedPanels]),
    metadata: Object.freeze({ ...state.metadata }),
  });
}

export function findGroupForPanel(
  state: MutableWorkspace,
  panelId: PanelId,
): GroupRecord | undefined {
  for (const group of state.groups.values()) {
    if (group.panelIds.includes(panelId)) {
      return group;
    }
  }
  return undefined;
}

export function findNodeForGroup(
  state: MutableWorkspace,
  groupId: GroupId,
): LayoutNode | undefined {
  for (const node of state.nodes.values()) {
    if (node.kind === "group" && node.groupId === groupId) {
      return node;
    }
  }
  return undefined;
}

export interface NodeParent {
  readonly kind: "split";
  readonly node: Extract<LayoutNode, { readonly kind: "split" }>;
  readonly childIndex: number;
}

export function findNodeParent(state: MutableWorkspace, nodeId: NodeId): NodeParent | undefined {
  for (const node of state.nodes.values()) {
    if (node.kind !== "split") continue;
    const childIndex = node.children.indexOf(nodeId);
    if (childIndex >= 0) {
      return { kind: "split", node, childIndex };
    }
  }
  return undefined;
}

export function findSurfaceForNode(
  state: MutableWorkspace,
  nodeId: NodeId,
): SurfaceRecord | undefined {
  for (const surface of state.surfaces.values()) {
    const stack: NodeId[] = [surface.rootNodeId];
    const seen = new Set<NodeId>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      if (current === nodeId) return surface;
      seen.add(current);
      const node = state.nodes.get(current);
      if (node?.kind === "split") stack.push(...node.children);
    }
  }
  return undefined;
}

export function replaceNodeReference(
  state: MutableWorkspace,
  previousId: NodeId,
  nextId: NodeId,
): void {
  const parent = findNodeParent(state, previousId);
  if (parent !== undefined) {
    const children = [...parent.node.children];
    children[parent.childIndex] = nextId;
    state.nodes.set(parent.node.id, { ...parent.node, children });
    return;
  }

  const surface = [...state.surfaces.values()].find(
    (candidate) => candidate.rootNodeId === previousId,
  );
  if (surface !== undefined) {
    state.surfaces.set(surface.id, { ...surface, rootNodeId: nextId });
  }
}

export function detachNodeReference(state: MutableWorkspace, nodeId: NodeId): boolean {
  const parent = findNodeParent(state, nodeId);
  if (parent !== undefined) {
    const children = parent.node.children.filter((child) => child !== nodeId);
    const weights = parent.node.weights.filter((_weight, index) => index !== parent.childIndex);
    state.nodes.set(parent.node.id, {
      ...parent.node,
      children,
      weights,
      collapsedChildIds: parent.node.collapsedChildIds.filter((child) => child !== nodeId),
    });
    return true;
  }

  return false;
}

export function insertByAnchor(
  current: readonly PanelId[],
  inserted: readonly PanelId[],
  beforePanelId?: PanelId,
  afterPanelId?: PanelId,
): readonly PanelId[] | undefined {
  if (beforePanelId !== undefined && afterPanelId !== undefined) {
    return undefined;
  }

  const withoutInserted = current.filter((id) => !inserted.includes(id));
  let index = withoutInserted.length;
  if (beforePanelId !== undefined) {
    index = withoutInserted.indexOf(beforePanelId);
    if (index < 0) return undefined;
  } else if (afterPanelId !== undefined) {
    const anchorIndex = withoutInserted.indexOf(afterPanelId);
    if (anchorIndex < 0) return undefined;
    index = anchorIndex + 1;
  }

  return [...withoutInserted.slice(0, index), ...inserted, ...withoutInserted.slice(index)];
}

export function isFiniteRect(rect: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

export function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}
