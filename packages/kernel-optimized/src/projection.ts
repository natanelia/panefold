import { applyPatches, applyTransaction } from "@panefold/kernel";
import type {
  CommittedTransaction,
  GroupId,
  GroupRecord,
  LayoutNode,
  NodeId,
  PanelId,
  PanelRecord,
  Revision,
  SurfaceId,
  SurfaceRecord,
  WorkspacePatch,
  WorkspaceSnapshot,
} from "@panefold/model";

import { CompactHistory, compactTransaction } from "./history";
import {
  ProjectionEntityTables,
  ProjectionIndexes,
  type ProjectionEntitySharing,
  type ProjectionIndexSharing,
} from "./indexes";

export interface OptimizedProjectionOptions {
  readonly bucketCount?: number;
  readonly historyLimit?: number;
  readonly historyChunkSize?: number;
}

/**
 * Experimental read projection for the reference `@panefold/kernel`.
 *
 * Semantic decisions and validation always come from the reference kernel's
 * `applyTransaction`/`applyPatches`. This class adds copy-on-write entity
 * buckets, incremental lookup indexes, and a compact audit history. It is not
 * an independent reducer and cannot replace `executeCommand`.
 */
export class OptimizedKernelProjection {
  readonly snapshot: WorkspaceSnapshot;
  readonly history: CompactHistory;
  readonly #entities: ProjectionEntityTables;
  readonly #indexes: ProjectionIndexes;

  private constructor(
    snapshot: WorkspaceSnapshot,
    entities: ProjectionEntityTables,
    indexes: ProjectionIndexes,
    history: CompactHistory,
  ) {
    this.snapshot = snapshot;
    this.#entities = entities;
    this.#indexes = indexes;
    this.history = history;
    Object.freeze(this);
  }

  static create(
    snapshot: WorkspaceSnapshot,
    options: OptimizedProjectionOptions = {},
  ): OptimizedKernelProjection {
    const bucketCount = options.bucketCount ?? 64;
    return new OptimizedKernelProjection(
      snapshot,
      ProjectionEntityTables.create(snapshot, bucketCount),
      ProjectionIndexes.create(snapshot, bucketCount),
      CompactHistory.empty(options.historyLimit ?? 512, options.historyChunkSize ?? 32),
    );
  }

  applyTransaction(transaction: CommittedTransaction): OptimizedKernelProjection {
    const next = applyTransaction(this.snapshot, transaction);
    return this.#transition(
      next,
      transaction.patches,
      this.history.append(compactTransaction(transaction)),
    );
  }

  applyPatches(patches: readonly WorkspacePatch[], revision: Revision): OptimizedKernelProjection {
    const next = applyPatches(this.snapshot, patches, revision);
    return this.#transition(next, patches, this.history);
  }

  panel(id: PanelId): PanelRecord | undefined {
    return this.#entities.panel(id);
  }

  group(id: GroupId): GroupRecord | undefined {
    return this.#entities.group(id);
  }

  node(id: NodeId): LayoutNode | undefined {
    return this.#entities.node(id);
  }

  groupForPanel(id: PanelId): GroupId | undefined {
    return this.#indexes.groupForPanel(id);
  }

  nodeForGroup(id: GroupId): NodeId | undefined {
    return this.#indexes.nodeForGroup(id);
  }

  parentForNode(id: NodeId): NodeId | undefined {
    return this.#indexes.parentForNode(id);
  }

  surface(id: SurfaceId): SurfaceRecord | undefined {
    return this.#entities.surface(id);
  }

  surfaceForRoot(id: NodeId): SurfaceId | undefined {
    return this.#indexes.surfaceForRoot(id);
  }

  floatingRank(id: SurfaceId): number | undefined {
    return this.#indexes.floatingRank(id);
  }

  sharingFrom(previous: OptimizedKernelProjection): ProjectionSharing {
    return Object.freeze({
      entities: this.#entities.sharingFrom(previous.#entities),
      indexes: this.#indexes.sharingFrom(previous.#indexes),
      snapshotTables: Object.freeze({
        panels: this.snapshot.panels === previous.snapshot.panels,
        groups: this.snapshot.groups === previous.snapshot.groups,
        nodes: this.snapshot.nodes === previous.snapshot.nodes,
        surfaces: this.snapshot.surfaces === previous.snapshot.surfaces,
      }),
    });
  }

  #transition(
    next: WorkspaceSnapshot,
    patches: readonly WorkspacePatch[],
    history: CompactHistory,
  ): OptimizedKernelProjection {
    return new OptimizedKernelProjection(
      next,
      this.#entities.update(patches, next),
      this.#indexes.update(patches, next),
      history,
    );
  }
}

export interface ProjectionSharing {
  readonly entities: ProjectionEntitySharing;
  readonly indexes: ProjectionIndexSharing;
  readonly snapshotTables: {
    readonly panels: boolean;
    readonly groups: boolean;
    readonly nodes: boolean;
    readonly surfaces: boolean;
  };
}
