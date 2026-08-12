import {
  cloneAndFreeze,
  type BatchWorkspaceCommand,
  type GroupId,
  type LogicalEdge,
  type MoveGroupCommand,
  type MovePanelCommand,
  type NodeId,
  type PanelId,
  type SplitGroupCommand,
  type SurfaceRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";

const NORMALIZED_WEIGHT_TOTAL = 1_000_000;

export type PanelDropTarget =
  | {
      readonly kind: "center";
      readonly groupId: GroupId;
      readonly beforePanelId?: PanelId;
      readonly afterPanelId?: PanelId;
    }
  | {
      readonly kind: "edge";
      readonly groupId: GroupId;
      readonly edge: LogicalEdge;
      readonly ratio: number;
    };

export interface PanelDropIntent {
  readonly panelId: PanelId;
  readonly target: PanelDropTarget;
}

/** Caller-owned identities keep planning pure, deterministic, and replayable. */
export interface PanelDropIds {
  readonly newGroupId: GroupId;
  readonly newGroupNodeId: NodeId;
  readonly splitNodeId: NodeId;
}

export type PanelDropPlannedCommand =
  MovePanelCommand | MoveGroupCommand | SplitGroupCommand | BatchWorkspaceCommand;

export type PanelDropPlanRejectionCode =
  "PANEL_NOT_FOUND" | "SOURCE_GROUP_NOT_FOUND" | "TARGET_GROUP_NOT_FOUND" | "INVALID_DROP";

export type PanelDropPlanResult =
  | { readonly ok: true; readonly command: PanelDropPlannedCommand }
  | {
      readonly ok: false;
      readonly code: PanelDropPlanRejectionCode;
      readonly message: string;
    };

function rejected(code: PanelDropPlanRejectionCode, message: string): PanelDropPlanResult {
  return Object.freeze({ ok: false, code, message });
}

function accepted(command: PanelDropPlannedCommand): PanelDropPlanResult {
  return Object.freeze({ ok: true, command: cloneAndFreeze(command) });
}

function surfaceForGroup(snapshot: WorkspaceSnapshot, groupId: GroupId): SurfaceRecord | undefined {
  const groupNode = snapshot.nodes.ids
    .map((id) => snapshot.nodes.byId[String(id)])
    .find((node) => node?.kind === "group" && node.groupId === groupId);
  if (groupNode === undefined) return undefined;

  const owners = snapshot.surfaces.ids
    .map((id) => snapshot.surfaces.byId[String(id)])
    .filter((surface): surface is SurfaceRecord => {
      if (surface === undefined) return false;
      const pending = [surface.rootNodeId];
      const visited = new Set<NodeId>();
      while (pending.length > 0) {
        const nodeId = pending.pop();
        if (nodeId === undefined || visited.has(nodeId)) continue;
        if (nodeId === groupNode.id) return true;
        visited.add(nodeId);
        const node = snapshot.nodes.byId[String(nodeId)];
        if (node?.kind === "split") pending.push(...node.children);
      }
      return false;
    });
  return owners.length === 1 ? owners[0] : undefined;
}

function crossesDocumentBoundary(
  snapshot: WorkspaceSnapshot,
  sourceGroupId: GroupId,
  targetGroupId: GroupId,
): boolean | undefined {
  const source = surfaceForGroup(snapshot, sourceGroupId);
  const target = surfaceForGroup(snapshot, targetGroupId);
  if (source === undefined || target === undefined) return undefined;
  return (
    source.id !== target.id &&
    (source.capabilities.crossDocument || target.capabilities.crossDocument)
  );
}

function hasRepresentableRatio(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const weight = Math.round(value * NORMALIZED_WEIGHT_TOTAL);
  return weight > 0 && weight < NORMALIZED_WEIGHT_TOTAL;
}

function validNewSplitIds(snapshot: WorkspaceSnapshot, ids: PanelDropIds): boolean {
  return (
    String(ids.newGroupId).trim().length > 0 &&
    String(ids.newGroupNodeId).trim().length > 0 &&
    String(ids.splitNodeId).trim().length > 0 &&
    ids.newGroupNodeId !== ids.splitNodeId &&
    snapshot.groups.byId[String(ids.newGroupId)] === undefined &&
    snapshot.nodes.byId[String(ids.newGroupNodeId)] === undefined &&
    snapshot.nodes.byId[String(ids.splitNodeId)] === undefined
  );
}

function validNewMoveGroupSplitId(snapshot: WorkspaceSnapshot, splitNodeId: NodeId): boolean {
  return (
    String(splitNodeId).trim().length > 0 && snapshot.nodes.byId[String(splitNodeId)] === undefined
  );
}

/**
 * Converts one view-independent panel drop into the smallest existing semantic
 * command. The planner performs no allocation, dispatch, or state mutation.
 */
export function planPanelDropCommand(
  snapshot: WorkspaceSnapshot,
  intent: PanelDropIntent,
  ids: PanelDropIds,
): PanelDropPlanResult {
  if (snapshot.panels.byId[String(intent.panelId)] === undefined) {
    return rejected("PANEL_NOT_FOUND", `Panel "${String(intent.panelId)}" does not exist.`);
  }

  const sourceGroups = snapshot.groups.ids
    .map((id) => snapshot.groups.byId[String(id)])
    .filter((group) => group?.panelIds.includes(intent.panelId));
  if (sourceGroups.length !== 1 || sourceGroups[0] === undefined) {
    return rejected(
      "SOURCE_GROUP_NOT_FOUND",
      `Panel "${String(intent.panelId)}" does not have one authoritative source group.`,
    );
  }
  const source = sourceGroups[0];
  const target = snapshot.groups.byId[String(intent.target.groupId)];
  if (target === undefined) {
    return rejected(
      "TARGET_GROUP_NOT_FOUND",
      `Target group "${String(intent.target.groupId)}" does not exist.`,
    );
  }

  const crossesDocument = crossesDocumentBoundary(snapshot, source.id, target.id);
  if (crossesDocument === undefined) {
    return rejected("INVALID_DROP", "The source or target group has no authoritative surface.");
  }
  if (crossesDocument) {
    return rejected(
      "INVALID_DROP",
      "A panel drop cannot cross a document ownership boundary without a prepared transfer.",
    );
  }

  if (intent.target.kind === "center") {
    const { beforePanelId, afterPanelId } = intent.target;
    if (
      (beforePanelId !== undefined && afterPanelId !== undefined) ||
      (beforePanelId !== undefined && !target.panelIds.includes(beforePanelId)) ||
      (afterPanelId !== undefined && !target.panelIds.includes(afterPanelId)) ||
      beforePanelId === intent.panelId ||
      afterPanelId === intent.panelId
    ) {
      return rejected("INVALID_DROP", "The center drop uses an invalid relational tab anchor.");
    }
    return accepted({
      type: "move-panel",
      panelId: intent.panelId,
      target: {
        groupId: target.id,
        ...(beforePanelId === undefined ? {} : { beforePanelId }),
        ...(afterPanelId === undefined ? {} : { afterPanelId }),
      },
      select: true,
      activate: true,
    });
  }

  if (!hasRepresentableRatio(intent.target.ratio)) {
    return rejected(
      "INVALID_DROP",
      "The edge drop ratio cannot be represented by positive canonical split weights.",
    );
  }
  if (source.id === target.id) {
    if (source.panelIds.length < 2) {
      return rejected("INVALID_DROP", "A sole-panel group cannot be split beside itself.");
    }
    if (!validNewSplitIds(snapshot, ids)) {
      return rejected(
        "INVALID_DROP",
        "The edge drop requires distinct, unused group and node IDs.",
      );
    }
    return accepted({
      type: "split-group",
      targetGroupId: target.id,
      panelIds: [intent.panelId],
      newGroupId: ids.newGroupId,
      newGroupNodeId: ids.newGroupNodeId,
      splitNodeId: ids.splitNodeId,
      edge: intent.target.edge,
      ratio: intent.target.ratio,
    });
  }

  if (source.panelIds.length === 1) {
    if (!validNewMoveGroupSplitId(snapshot, ids.splitNodeId)) {
      return rejected("INVALID_DROP", "The edge drop requires an unused split node ID.");
    }
    return accepted({
      type: "move-group",
      groupId: source.id,
      targetGroupId: target.id,
      edge: intent.target.edge,
      splitNodeId: ids.splitNodeId,
      ratio: intent.target.ratio,
    });
  }

  if (target.panelIds.length === 0) {
    return rejected(
      "INVALID_DROP",
      "A panel cannot create an adjacent group through an empty target group.",
    );
  }
  if (!validNewSplitIds(snapshot, ids)) {
    return rejected("INVALID_DROP", "The edge drop requires distinct, unused group and node IDs.");
  }
  return accepted({
    type: "batch",
    commands: [
      {
        type: "move-panel",
        panelId: intent.panelId,
        target: { groupId: target.id },
        select: true,
        activate: true,
      },
      {
        type: "split-group",
        targetGroupId: target.id,
        panelIds: [intent.panelId],
        newGroupId: ids.newGroupId,
        newGroupNodeId: ids.newGroupNodeId,
        splitNodeId: ids.splitNodeId,
        edge: intent.target.edge,
        ratio: intent.target.ratio,
      },
    ],
  });
}
