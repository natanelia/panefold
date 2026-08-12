import type {
  ActivationState,
  EntityTable,
  FocusMemoryDescriptor,
  GroupRecord,
  LayoutNode,
  PanelRecord,
  SurfaceRecord,
  WorkspaceSnapshot,
} from "./entities";
import { cloneAndFreeze, createEntityTable } from "./entities";
import {
  INITIAL_REVISION,
  type GroupId,
  type NodeId,
  type PanelId,
  type Revision,
  type SurfaceId,
} from "./ids";
import type { JsonObject } from "./json";
import type { WorkspaceKernelState } from "./results";

export const CURRENT_WORKSPACE_SCHEMA_VERSION = 2;

export interface WorkspaceSnapshotInput {
  readonly schemaVersion?: number;
  readonly applicationLayoutVersion?: number;
  readonly revision?: Revision;
  readonly panels?: readonly PanelRecord[];
  readonly groups?: readonly GroupRecord[];
  readonly nodes?: readonly LayoutNode[];
  readonly surfaces?: readonly SurfaceRecord[];
  readonly activation?: ActivationState;
  readonly focusMemory?: FocusMemoryDescriptor;
  readonly floatingOrder?: WorkspaceSnapshot["floatingOrder"];
  readonly recoverableClosedPanels?: WorkspaceSnapshot["recoverableClosedPanels"];
  readonly appliedRemoteTransactions?: WorkspaceSnapshot["appliedRemoteTransactions"];
  readonly metadata?: JsonObject;
}

export function createWorkspaceSnapshot(input: WorkspaceSnapshotInput = {}): WorkspaceSnapshot {
  const focusMemory: FocusMemoryDescriptor = input.focusMemory ?? {
    fallback: "workspace-root",
  };
  return Object.freeze({
    schemaVersion: input.schemaVersion ?? CURRENT_WORKSPACE_SCHEMA_VERSION,
    applicationLayoutVersion: input.applicationLayoutVersion ?? 1,
    revision: input.revision ?? INITIAL_REVISION,
    panels: createEntityTable<PanelId, PanelRecord>(input.panels),
    groups: createEntityTable<GroupId, GroupRecord>(input.groups),
    nodes: createEntityTable<NodeId, LayoutNode>(input.nodes),
    surfaces: createEntityTable<SurfaceId, SurfaceRecord>(input.surfaces),
    activation: cloneAndFreeze(input.activation ?? {}),
    focusMemory: cloneAndFreeze(focusMemory),
    floatingOrder: cloneAndFreeze([...(input.floatingOrder ?? [])]),
    recoverableClosedPanels: cloneAndFreeze([...(input.recoverableClosedPanels ?? [])]),
    appliedRemoteTransactions: cloneAndFreeze([...(input.appliedRemoteTransactions ?? [])]),
    metadata: cloneAndFreeze(input.metadata ?? {}),
  });
}

function tableValues<Id extends string, Entity extends { readonly id: Id }>(
  table: EntityTable<Id, Entity>,
): readonly Entity[] {
  return table.ids.map((id) => {
    const entity = table.byId[String(id)];
    if (entity === undefined) {
      throw new TypeError(`Entity table is missing ${String(id)}`);
    }
    return entity;
  });
}

export function createKernelState(
  snapshot?: WorkspaceSnapshot,
  historyLimit = 200,
): WorkspaceKernelState {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) {
    throw new RangeError("historyLimit must be a non-negative safe integer");
  }
  const immutableSnapshot =
    snapshot === undefined
      ? createWorkspaceSnapshot()
      : createWorkspaceSnapshot({
          schemaVersion: snapshot.schemaVersion,
          applicationLayoutVersion: snapshot.applicationLayoutVersion,
          revision: snapshot.revision,
          panels: tableValues(snapshot.panels),
          groups: tableValues(snapshot.groups),
          nodes: tableValues(snapshot.nodes),
          surfaces: tableValues(snapshot.surfaces),
          activation: snapshot.activation,
          focusMemory: snapshot.focusMemory,
          floatingOrder: snapshot.floatingOrder,
          recoverableClosedPanels: snapshot.recoverableClosedPanels,
          appliedRemoteTransactions: snapshot.appliedRemoteTransactions,
          metadata: snapshot.metadata,
        });
  return Object.freeze({
    snapshot: immutableSnapshot,
    undoStack: Object.freeze([]),
    redoStack: Object.freeze([]),
    historyLimit,
  });
}
