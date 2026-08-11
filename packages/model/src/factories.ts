import type {
  ActivationState,
  FocusMemoryDescriptor,
  GroupRecord,
  LayoutNode,
  PanelRecord,
  SurfaceRecord,
  WorkspaceSnapshot,
} from "./entities";
import { createEntityTable } from "./entities";
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
  readonly metadata?: JsonObject;
}

export function createWorkspaceSnapshot(input: WorkspaceSnapshotInput = {}): WorkspaceSnapshot {
  const focusMemory: FocusMemoryDescriptor = input.focusMemory ?? {
    fallback: "workspace-root",
  };
  return Object.freeze({
    schemaVersion: input.schemaVersion ?? 1,
    applicationLayoutVersion: input.applicationLayoutVersion ?? 1,
    revision: input.revision ?? INITIAL_REVISION,
    panels: createEntityTable<PanelId, PanelRecord>(input.panels),
    groups: createEntityTable<GroupId, GroupRecord>(input.groups),
    nodes: createEntityTable<NodeId, LayoutNode>(input.nodes),
    surfaces: createEntityTable<SurfaceId, SurfaceRecord>(input.surfaces),
    activation: Object.freeze(input.activation ?? {}),
    focusMemory: Object.freeze(focusMemory),
    floatingOrder: Object.freeze([...(input.floatingOrder ?? [])]),
    recoverableClosedPanels: Object.freeze([...(input.recoverableClosedPanels ?? [])]),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

export function createKernelState(
  snapshot: WorkspaceSnapshot = createWorkspaceSnapshot(),
  historyLimit = 200,
): WorkspaceKernelState {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) {
    throw new RangeError("historyLimit must be a non-negative safe integer");
  }
  return Object.freeze({
    snapshot,
    undoStack: Object.freeze([]),
    redoStack: Object.freeze([]),
    historyLimit,
  });
}
