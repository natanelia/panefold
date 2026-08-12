import type {
  EntityTable,
  GroupId,
  GroupRecord,
  LayoutNode,
  NodeId,
  PanelId,
  PanelRecord,
  SurfaceId,
  SurfaceRecord,
  WorkspacePatch,
  WorkspaceSnapshot,
} from "@panefold/model";

import { PersistentBucketMap, type PersistentMapChange } from "./persistent-bucket-map";

interface EntityTables {
  readonly panels: PersistentBucketMap<PanelRecord>;
  readonly groups: PersistentBucketMap<GroupRecord>;
  readonly nodes: PersistentBucketMap<LayoutNode>;
  readonly surfaces: PersistentBucketMap<SurfaceRecord>;
}

function tableEntries<Id extends string, Entity extends { readonly id: Id }>(
  table: EntityTable<Id, Entity>,
): readonly (readonly [string, Entity])[] {
  return table.ids.map((id) => {
    const entity = table.byId[String(id)];
    if (entity === undefined) throw new RangeError(`Missing canonical entity ${String(id)}`);
    return [String(id), entity] as const;
  });
}

function entityChanges<Id extends string, Entity extends { readonly id: Id }>(
  patches: readonly WorkspacePatch[],
  kind: "panel" | "group" | "node" | "surface",
  table: EntityTable<Id, Entity>,
): readonly PersistentMapChange<Entity>[] {
  const ids = new Set<string>();
  for (const patch of patches) if (patch.kind === kind) ids.add(String(patch.id));
  return [...ids].map((id): PersistentMapChange<Entity> => {
    const entity = table.byId[id];
    return entity === undefined
      ? { type: "delete", key: id }
      : { type: "set", key: id, value: entity };
  });
}

function indexSet<Value>(key: string, value: Value | undefined): PersistentMapChange<Value> {
  return value === undefined ? { type: "delete", key } : { type: "set", key, value };
}

function changedGroups(patches: readonly WorkspacePatch[]): readonly GroupRecord[] {
  const final = new Map<string, GroupRecord>();
  for (const patch of patches) {
    if (patch.kind !== "group") continue;
    if (patch.after === undefined) final.delete(String(patch.id));
    else final.set(String(patch.id), patch.after);
  }
  return [...final.values()];
}

function changedNodes(patches: readonly WorkspacePatch[]): readonly LayoutNode[] {
  const final = new Map<string, LayoutNode>();
  for (const patch of patches) {
    if (patch.kind !== "node") continue;
    if (patch.after === undefined) final.delete(String(patch.id));
    else final.set(String(patch.id), patch.after);
  }
  return [...final.values()];
}

function changedSurfaces(patches: readonly WorkspacePatch[]): readonly SurfaceRecord[] {
  const final = new Map<string, SurfaceRecord>();
  for (const patch of patches) {
    if (patch.kind !== "surface") continue;
    if (patch.after === undefined) final.delete(String(patch.id));
    else final.set(String(patch.id), patch.after);
  }
  return [...final.values()];
}

/** Incremental secondary indexes over the authoritative canonical snapshot. */
export class ProjectionIndexes {
  readonly #panelGroup: PersistentBucketMap<GroupId>;
  readonly #groupNode: PersistentBucketMap<NodeId>;
  readonly #nodeParent: PersistentBucketMap<NodeId>;
  readonly #surfaceByRoot: PersistentBucketMap<SurfaceId>;
  readonly #floatingRank: PersistentBucketMap<number>;

  private constructor(
    panelGroup: PersistentBucketMap<GroupId>,
    groupNode: PersistentBucketMap<NodeId>,
    nodeParent: PersistentBucketMap<NodeId>,
    surfaceByRoot: PersistentBucketMap<SurfaceId>,
    floatingRank: PersistentBucketMap<number>,
  ) {
    this.#panelGroup = panelGroup;
    this.#groupNode = groupNode;
    this.#nodeParent = nodeParent;
    this.#surfaceByRoot = surfaceByRoot;
    this.#floatingRank = floatingRank;
    Object.freeze(this);
  }

  static create(snapshot: WorkspaceSnapshot, bucketCount: number): ProjectionIndexes {
    const panelGroup: (readonly [string, GroupId])[] = [];
    for (const groupId of snapshot.groups.ids) {
      const group = snapshot.groups.byId[String(groupId)];
      if (group === undefined) continue;
      for (const panelId of group.panelIds) panelGroup.push([String(panelId), group.id]);
    }
    const groupNode: (readonly [string, NodeId])[] = [];
    const nodeParent: (readonly [string, NodeId])[] = [];
    for (const nodeId of snapshot.nodes.ids) {
      const node = snapshot.nodes.byId[String(nodeId)];
      if (node?.kind === "group") groupNode.push([String(node.groupId), node.id]);
      if (node?.kind === "split") {
        for (const childId of node.children) nodeParent.push([String(childId), node.id]);
      }
    }
    const surfaceByRoot = snapshot.surfaces.ids.flatMap((surfaceId) => {
      const surface = snapshot.surfaces.byId[String(surfaceId)];
      return surface === undefined ? [] : [[String(surface.rootNodeId), surface.id] as const];
    });
    const floatingRank = snapshot.floatingOrder.map(
      (surfaceId, index) => [String(surfaceId), index] as const,
    );
    return new ProjectionIndexes(
      PersistentBucketMap.from(panelGroup, bucketCount),
      PersistentBucketMap.from(groupNode, bucketCount),
      PersistentBucketMap.from(nodeParent, bucketCount),
      PersistentBucketMap.from(surfaceByRoot, bucketCount),
      PersistentBucketMap.from(floatingRank, bucketCount),
    );
  }

  update(patches: readonly WorkspacePatch[], next: WorkspaceSnapshot): ProjectionIndexes {
    const affectedPanels = new Set<string>();
    const affectedGroups = new Set<string>();
    const affectedChildren = new Set<string>();
    const affectedRoots = new Set<string>();
    const affectedFloatingSurfaces = new Set<string>();

    for (const patch of patches) {
      if (patch.kind === "group") {
        for (const panelId of patch.before?.panelIds ?? []) affectedPanels.add(String(panelId));
        for (const panelId of patch.after?.panelIds ?? []) affectedPanels.add(String(panelId));
      }
      if (patch.kind === "node") {
        if (patch.before?.kind === "group") affectedGroups.add(String(patch.before.groupId));
        if (patch.after?.kind === "group") affectedGroups.add(String(patch.after.groupId));
        if (patch.before?.kind === "split") {
          for (const childId of patch.before.children) affectedChildren.add(String(childId));
        }
        if (patch.after?.kind === "split") {
          for (const childId of patch.after.children) affectedChildren.add(String(childId));
        }
      }
      if (patch.kind === "surface") {
        if (patch.before !== undefined) affectedRoots.add(String(patch.before.rootNodeId));
        if (patch.after !== undefined) affectedRoots.add(String(patch.after.rootNodeId));
      }
      if (patch.kind === "floating-order") {
        for (const surfaceId of patch.before) affectedFloatingSurfaces.add(String(surfaceId));
        for (const surfaceId of patch.after) affectedFloatingSurfaces.add(String(surfaceId));
      }
    }

    const floatingChanges = [...affectedFloatingSurfaces].map((id) => {
      const rank = next.floatingOrder.findIndex((surfaceId) => String(surfaceId) === id);
      return indexSet(id, rank < 0 ? undefined : rank);
    });

    const afterGroups = changedGroups(patches);
    const panelGroupChanges = [...affectedPanels].map((id) => {
      const group = afterGroups.find((candidate) =>
        candidate.panelIds.some((panelId) => String(panelId) === id),
      );
      return indexSet(id, group?.id);
    });

    const afterNodes = changedNodes(patches);
    const groupNodeChanges = [...affectedGroups].map((id) => {
      const node = afterNodes.find(
        (candidate) => candidate.kind === "group" && String(candidate.groupId) === id,
      );
      return indexSet(id, node?.id);
    });
    const nodeParentChanges = [...affectedChildren].map((id) => {
      const parent = afterNodes.find(
        (candidate) =>
          candidate.kind === "split" &&
          candidate.children.some((childId) => String(childId) === id),
      );
      return indexSet(id, parent?.id);
    });

    const afterSurfaces = changedSurfaces(patches);
    const rootSurfaceChanges = [...affectedRoots].map((id) => {
      const surface = afterSurfaces.find((candidate) => String(candidate.rootNodeId) === id);
      return indexSet(id, surface?.id);
    });

    return new ProjectionIndexes(
      this.#panelGroup.withChanges(panelGroupChanges),
      this.#groupNode.withChanges(groupNodeChanges),
      this.#nodeParent.withChanges(nodeParentChanges),
      this.#surfaceByRoot.withChanges(rootSurfaceChanges),
      this.#floatingRank.withChanges(floatingChanges),
    );
  }

  groupForPanel(panelId: PanelId): GroupId | undefined {
    return this.#panelGroup.get(String(panelId));
  }

  nodeForGroup(groupId: GroupId): NodeId | undefined {
    return this.#groupNode.get(String(groupId));
  }

  parentForNode(nodeId: NodeId): NodeId | undefined {
    return this.#nodeParent.get(String(nodeId));
  }

  surfaceForRoot(nodeId: NodeId): SurfaceId | undefined {
    return this.#surfaceByRoot.get(String(nodeId));
  }

  floatingRank(surfaceId: SurfaceId): number | undefined {
    return this.#floatingRank.get(String(surfaceId));
  }

  sharingFrom(previous: ProjectionIndexes): ProjectionIndexSharing {
    return Object.freeze({
      panelGroup: this.#panelGroup.sharedBucketCount(previous.#panelGroup),
      groupNode: this.#groupNode.sharedBucketCount(previous.#groupNode),
      nodeParent: this.#nodeParent.sharedBucketCount(previous.#nodeParent),
      surfaceByRoot: this.#surfaceByRoot.sharedBucketCount(previous.#surfaceByRoot),
      floatingRank: this.#floatingRank.sharedBucketCount(previous.#floatingRank),
      bucketCount: this.#panelGroup.bucketCount,
    });
  }
}

export interface ProjectionIndexSharing {
  readonly panelGroup: number;
  readonly groupNode: number;
  readonly nodeParent: number;
  readonly surfaceByRoot: number;
  readonly floatingRank: number;
  readonly bucketCount: number;
}

export class ProjectionEntityTables {
  readonly #tables: EntityTables;

  private constructor(tables: EntityTables) {
    this.#tables = tables;
    Object.freeze(this);
  }

  static create(snapshot: WorkspaceSnapshot, bucketCount: number): ProjectionEntityTables {
    return new ProjectionEntityTables({
      panels: PersistentBucketMap.from(tableEntries(snapshot.panels), bucketCount),
      groups: PersistentBucketMap.from(tableEntries(snapshot.groups), bucketCount),
      nodes: PersistentBucketMap.from(tableEntries(snapshot.nodes), bucketCount),
      surfaces: PersistentBucketMap.from(tableEntries(snapshot.surfaces), bucketCount),
    });
  }

  update(patches: readonly WorkspacePatch[], next: WorkspaceSnapshot): ProjectionEntityTables {
    return new ProjectionEntityTables({
      panels: this.#tables.panels.withChanges(entityChanges(patches, "panel", next.panels)),
      groups: this.#tables.groups.withChanges(entityChanges(patches, "group", next.groups)),
      nodes: this.#tables.nodes.withChanges(entityChanges(patches, "node", next.nodes)),
      surfaces: this.#tables.surfaces.withChanges(entityChanges(patches, "surface", next.surfaces)),
    });
  }

  panel(id: PanelId): PanelRecord | undefined {
    return this.#tables.panels.get(String(id));
  }

  group(id: GroupId): GroupRecord | undefined {
    return this.#tables.groups.get(String(id));
  }

  node(id: NodeId): LayoutNode | undefined {
    return this.#tables.nodes.get(String(id));
  }

  surface(id: SurfaceId): SurfaceRecord | undefined {
    return this.#tables.surfaces.get(String(id));
  }

  sharingFrom(previous: ProjectionEntityTables): ProjectionEntitySharing {
    return Object.freeze({
      panels: this.#tables.panels.sharedBucketCount(previous.#tables.panels),
      groups: this.#tables.groups.sharedBucketCount(previous.#tables.groups),
      nodes: this.#tables.nodes.sharedBucketCount(previous.#tables.nodes),
      surfaces: this.#tables.surfaces.sharedBucketCount(previous.#tables.surfaces),
      bucketCount: this.#tables.panels.bucketCount,
    });
  }
}

export interface ProjectionEntitySharing {
  readonly panels: number;
  readonly groups: number;
  readonly nodes: number;
  readonly surfaces: number;
  readonly bucketCount: number;
}
