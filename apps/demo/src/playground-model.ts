import {
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type PanelRecord,
  type WorkspaceSnapshot,
  type WorkspaceCommand,
} from "@panefold/model";
import { canonicalizeWorkspace, reduceWorkspace, validateWorkspace } from "@panefold/kernel";
import { solveLayout, type LogicalRect } from "@panefold/geometry";
import type {
  WorkspaceCommandAdapter,
  WorkspaceLayoutSolver,
  WorkspacePanelDropRequest,
  WorkspacePanelDropPlanContext,
} from "@panefold/react";
import { createDemoCommands, projectWorkspace } from "./workspace-config";

export const PANE_MIN_WIDTH = 176;
export const PANE_MIN_HEIGHT = 208;
export const PLAYGROUND_SPLITTER = 16;
export const playgroundPanelNames = {
  notes: "Notes",
  checklist: "Checklist",
  preview: "Preview",
  activity: "Activity",
} as const;

function panel(id: keyof typeof playgroundPanelNames): PanelRecord {
  return {
    id: panelId(id),
    type: `playground.${id}`,
    typeVersion: 1,
    title: playgroundPanelNames[id],
    parameters: {},
    capabilities: {
      closable: true,
      floatable: true,
      popout: false,
      pictureInPicture: false,
      singleton: true,
    },
    constraints: { hardMinInline: PANE_MIN_WIDTH, hardMinBlock: PANE_MIN_HEIGHT },
    lifecycle: {
      hidden: "suspend",
      sameDocumentMove: "preserve-host",
      crossDocumentMove: "portal-coupled",
    },
  };
}

/** A separate example and storage namespace, never a replacement for a saved Code workspace. */
export const playgroundSnapshot = createWorkspaceSnapshot({
  applicationLayoutVersion: 1,
  panels: Object.keys(playgroundPanelNames).map((id) =>
    panel(id as keyof typeof playgroundPanelNames),
  ),
  groups: [
    {
      id: groupId("primary"),
      panelIds: [panelId("notes"), panelId("checklist")],
      selectedPanelId: panelId("notes"),
      persistent: false,
    },
    {
      id: groupId("secondary"),
      panelIds: [panelId("preview"), panelId("activity")],
      selectedPanelId: panelId("preview"),
      persistent: false,
    },
  ],
  nodes: [
    {
      kind: "split",
      id: nodeId("root"),
      axis: "block",
      children: [nodeId("primary-node"), nodeId("secondary-node")],
      weights: [500_000, 500_000],
      collapsedChildIds: [],
    },
    { kind: "group", id: nodeId("primary-node"), groupId: groupId("primary") },
    { kind: "group", id: nodeId("secondary-node"), groupId: groupId("secondary") },
  ],
  surfaces: [
    {
      id: surfaceId("main"),
      kind: "main",
      rootNodeId: nodeId("root"),
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    },
  ],
  activation: { activePanelId: panelId("notes"), activeSurfaceId: surfaceId("main") },
  focusMemory: { panelId: panelId("notes"), groupId: groupId("primary"), fallback: "selected-tab" },
});

export function projectPlayground(snapshot: WorkspaceSnapshot) {
  const projection = projectWorkspace(snapshot);
  return {
    ...projection,
    groups: Object.fromEntries(
      Object.entries(projection.groups).map(([id, group]) => [
        id,
        {
          ...group,
          label:
            group.panelIds.map((id) => projection.panels[id]?.title ?? id).join(" + ") ||
            "Empty pane",
        },
      ]),
    ),
  };
}

/** Unscaled canvas bounds. Nested splits grow the canvas instead of shrinking readable content. */
export function playgroundBounds(
  snapshot: WorkspaceSnapshot,
  root: string,
  viewport: LogicalRect,
): LogicalRect {
  const seen = new Set<string>();
  function size(id: string): { width: number; height: number } {
    if (seen.has(id)) return { width: 0, height: 0 };
    seen.add(id);
    const node = getEntity(snapshot.nodes, nodeId(id));
    if (node === undefined) return { width: 0, height: 0 };
    if (node.kind === "group") return { width: PANE_MIN_WIDTH, height: PANE_MIN_HEIGHT };
    const children = node.children
      .filter((child) => !node.collapsedChildIds.includes(child))
      .map(size);
    const gaps = Math.max(0, children.length - 1) * PLAYGROUND_SPLITTER;
    return node.axis === "inline"
      ? {
          width: children.reduce((sum, item) => sum + item.width, gaps),
          height: Math.max(0, ...children.map((item) => item.height)),
        }
      : {
          width: Math.max(0, ...children.map((item) => item.width)),
          height: children.reduce((sum, item) => sum + item.height, gaps),
        };
  }
  const minimum = size(root);
  return {
    ...viewport,
    inlineSize: Math.max(viewport.inlineSize, minimum.width),
    blockSize: Math.max(viewport.blockSize, minimum.height),
  };
}

export const solvePlayground: WorkspaceLayoutSolver<WorkspaceSnapshot> = (snapshot, request) =>
  solveLayout(
    snapshot,
    nodeId(request.rootNodeId),
    playgroundBounds(snapshot, request.rootNodeId, request.bounds),
    {
      splitterSize: PLAYGROUND_SPLITTER,
      splitOverrides: request.splitOverrides,
      resolveGroupConstraints: () => ({
        inline: { min: PANE_MIN_WIDTH },
        block: { min: PANE_MIN_HEIGHT },
      }),
    },
  );

export function previewPlaygroundCommand(snapshot: WorkspaceSnapshot, command: WorkspaceCommand) {
  const result = reduceWorkspace(snapshot, command);
  if (!result.ok) return undefined;
  const next = canonicalizeWorkspace(result.snapshot).snapshot;
  return validateWorkspace(next).length === 0 ? next : undefined;
}

export function createPlaygroundCommands(
  getSnapshot: () => WorkspaceSnapshot,
): WorkspaceCommandAdapter<WorkspaceCommand> {
  const base = createDemoCommands(getSnapshot);
  const preview = (
    next: WorkspaceSnapshot,
    groupId: string,
    context: WorkspacePanelDropPlanContext,
  ) => {
    const projection = projectPlayground(next);
    for (const surfaceId of next.surfaces.ids) {
      const surface = getEntity(next.surfaces, surfaceId);
      if (!surface) continue;
      const layout = solvePlayground(next, {
        ...context,
        projection,
        rootNodeId: surface.rootNodeId,
        splitOverrides: {},
      });
      if (layout.groupRects[groupId]) return layout.groupRects[groupId];
    }
    return undefined;
  };
  const panelPlan = (
    request: WorkspacePanelDropRequest,
    context: WorkspacePanelDropPlanContext,
  ) => {
    const snapshot = getSnapshot();
    const plan = base.planPanelDrop?.(request, context);
    if (!plan) return undefined;
    const next = previewPlaygroundCommand(snapshot, plan.command);
    if (!next) return undefined;
    const projection = projectPlayground(next);
    const group = Object.values(projection.groups).find((group) =>
      group.panelIds.includes(request.panel.id),
    );
    if (!group) return undefined;
    const rect = preview(next, group.id, context);
    return rect ? { command: plan.command, previewRect: rect } : undefined;
  };
  return {
    ...base,
    planPanelDrop: panelPlan,
    planPanelTabDrop: panelPlan,
    planGroupDrop: (request, context) => {
      const plan = base.planGroupDrop?.(request, context);
      if (!plan) return undefined;
      const next = previewPlaygroundCommand(getSnapshot(), plan.command);
      if (!next) return undefined;
      const id = request.target.kind === "merge" ? request.targetGroup.id : request.sourceGroup.id;
      const rect = preview(next, id, context);
      return rect ? { command: plan.command, previewRect: rect } : undefined;
    },
  };
}

export type Placement = "center" | "inline-start" | "inline-end" | "block-start" | "block-end";

/** Both the touch sheet and pointer gestures retain the same kernel-planned command. */
export function planPlaygroundMove(
  snapshot: WorkspaceSnapshot,
  sourceId: string,
  targetId: string,
  placement: Placement,
  bounds: LogicalRect,
) {
  const projection = projectPlayground(snapshot);
  const sourceGroup = Object.values(projection.groups).find((group) =>
    group.panelIds.includes(sourceId),
  );
  const targetGroup = projection.groups[targetId];
  const source = projection.panels[sourceId];
  const targetNode = Object.values(projection.nodes).find(
    (node) => node.kind === "group" && node.groupId === targetId,
  );
  if (!sourceGroup || !targetGroup || !source || !targetNode) return undefined;
  const targetRect = solvePlayground(snapshot, {
    projection,
    rootNodeId: projection.rootNodeId,
    bounds,
    splitterSize: PLAYGROUND_SPLITTER,
    splitOverrides: {},
  }).groupRects[targetId];
  if (!targetRect) return undefined;
  return createPlaygroundCommands(() => snapshot).planPanelDrop?.(
    {
      revision: projection.revision,
      panel: source,
      sourceGroup,
      targetGroup,
      sourcePanels: sourceGroup.panelIds.flatMap((id) =>
        projection.panels[id] ? [projection.panels[id]] : [],
      ),
      targetPanels: targetGroup.panelIds.flatMap((id) =>
        projection.panels[id] ? [projection.panels[id]] : [],
      ),
      targetNodeId: targetNode.id,
      target:
        placement === "center"
          ? { kind: "center", ratio: 1 }
          : { kind: "edge", edge: placement, ratio: 0.5 },
    },
    { bounds, targetRect, splitterSize: PLAYGROUND_SPLITTER },
  );
}
