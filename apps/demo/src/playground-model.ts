import {
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceSnapshot,
  type WorkspaceCommand,
} from "@panefold/model";
import { canonicalizeWorkspace, reduceWorkspace, validateWorkspace } from "@panefold/kernel";
import { resolveFloatingSurfaceBounds, floatingSurfaceContentBounds } from "@panefold/react";
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
export const PLAYGROUND_TITLEBAR = 52;

export function playgroundSurfaceForGroup(snapshot: WorkspaceSnapshot, id: string) {
  return snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .find((surface) => surface && containsGroup(snapshot, surface.rootNodeId, id));
}

function containsGroup(snapshot: WorkspaceSnapshot, root: string, id: string) {
  const pending = [root];
  const seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const node = getEntity(snapshot.nodes, nodeId(current));
    if (node?.kind === "group" && String(node.groupId) === id) return true;
    if (node?.kind === "split") pending.push(...node.children);
  }
  return false;
}

/** Match the renderer's clamped frame and titlebar, including floating destinations. */
export function playgroundSurfaceBounds(
  snapshot: WorkspaceSnapshot,
  surface: SurfaceRecord,
  viewport: LogicalRect,
) {
  if (surface.kind !== "floating") return playgroundBounds(snapshot, surface.rootNodeId, viewport);
  const view = projectPlayground(snapshot).floatingSurfaces?.find((item) => item.id === surface.id);
  if (!view) return viewport;
  return floatingSurfaceContentBounds(
    resolveFloatingSurfaceBounds(view, viewport.inlineSize, viewport.blockSize),
    viewport,
    "ltr",
    PLAYGROUND_TITLEBAR,
  );
}
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
  const mainRoot = projection.nodes[projection.rootNodeId];
  const mainGroup = mainRoot?.kind === "group" ? projection.groups[mainRoot.groupId] : undefined;
  const lastDockedPanel = mainGroup?.panelIds.length === 1 ? mainGroup.panelIds[0] : undefined;
  const lastDockedView =
    lastDockedPanel === undefined ? undefined : projection.panels[lastDockedPanel];
  return {
    ...projection,
    // The kernel must retain a docked destination. Do not offer an action that
    // cannot float the sole remaining root panel; reopening a second enables it.
    panels: lastDockedView
      ? {
          ...projection.panels,
          [lastDockedView.id]: { ...lastDockedView, floatable: false },
        }
      : projection.panels,
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

function allocatePlaygroundDropIds(snapshot: WorkspaceSnapshot, panel: string) {
  for (let candidate = 1; candidate < Number.MAX_SAFE_INTEGER; candidate += 1) {
    const suffix = `playground-drop:${panel}:${String(candidate)}`;
    const group = groupId(`${suffix}:group`);
    const groupNode = nodeId(`${suffix}:node`);
    const splitNode = nodeId(`${suffix}:split`);
    if (
      getEntity(snapshot.groups, group) === undefined &&
      getEntity(snapshot.nodes, groupNode) === undefined &&
      getEntity(snapshot.nodes, splitNode) === undefined
    ) return { group, groupNode, splitNode };
  }
  throw new Error(`No playground drop identity remains for panel ${panel}`);
}

/**
 * Cross-surface edge moves are expressed as move-then-split. This keeps the
 * destination floating surface authoritative for every logical edge instead of
 * relying on topology cleanup to preserve a foreign surface root.
 */
function floatingEdgeMoveCommand(
  snapshot: WorkspaceSnapshot,
  panel: string,
  targetGroup: string,
  edge: Exclude<Placement, "center">,
  ratio: number,
): WorkspaceCommand | undefined {
  const surface = playgroundSurfaceForGroup(snapshot, targetGroup);
  if (surface?.kind !== "floating") return undefined;
  const ids = allocatePlaygroundDropIds(snapshot, panel);
  return {
    type: "batch",
    commands: [
      ...(surface.minimized ? [{ type: "restore-surface" as const, surfaceId: surface.id }] : []),
      {
        type: "move-panel",
        panelId: panelId(panel),
        target: { groupId: groupId(targetGroup) },
        select: true,
        activate: true,
      },
      {
        type: "split-group",
        targetGroupId: groupId(targetGroup),
        panelIds: [panelId(panel)],
        newGroupId: ids.group,
        newGroupNodeId: ids.groupNode,
        splitNodeId: ids.splitNode,
        edge,
        ratio,
      },
      { type: "raise-surface", surfaceId: surface.id },
    ],
  };
}

export function previewPlaygroundCommand(snapshot: WorkspaceSnapshot, command: WorkspaceCommand) {
  const result = reduceWorkspace(snapshot, command);
  if (!result.ok) return undefined;
  const next = canonicalizeWorkspace(result.snapshot).snapshot;
  return validateWorkspace(next).length === 0 ? next : undefined;
}

export function createPlaygroundCommands(
  getSnapshot: () => WorkspaceSnapshot,
  getViewport?: () => LogicalRect,
): WorkspaceCommandAdapter<WorkspaceCommand> {
  const base = createDemoCommands(getSnapshot);
  const revealDestination = (command: WorkspaceCommand, targetGroup: string): WorkspaceCommand => {
    const target = playgroundSurfaceForGroup(getSnapshot(), targetGroup);
    if (target?.kind !== "floating") return command;
    // A destination selected from a sheet may be minimized or behind another float.
    // Keep restoration, placement, and activation in the same undoable transaction.
    if (
      command.type === "undo-workspace-operation" ||
      command.type === "redo-workspace-operation" ||
      command.type === "apply-remote-transaction"
    )
      return command;
    return {
      type: "batch",
      commands: [
        ...(target.minimized ? [{ type: "restore-surface" as const, surfaceId: target.id }] : []),
        ...(command.type === "batch" ? command.commands : [command]),
        { type: "raise-surface", surfaceId: target.id },
      ],
    };
  };
  const preview = (
    next: WorkspaceSnapshot,
    groupId: string,
    context: WorkspacePanelDropPlanContext,
  ) => {
    const projection = projectPlayground(next);
    for (const surfaceId of next.surfaces.ids) {
      const surface = getEntity(next.surfaces, surfaceId);
      if (!surface || !containsGroup(next, surface.rootNodeId, groupId)) continue;
      const viewport = getViewport?.();
      const layout = solvePlayground(next, {
        ...context,
        bounds: viewport ? playgroundSurfaceBounds(next, surface, viewport) : context.bounds,
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
    const planned =
      request.target.kind === "edge"
        ? floatingEdgeMoveCommand(
            snapshot,
            request.panel.id,
            request.targetGroup.id,
            request.target.edge,
            request.target.ratio,
          )
        : undefined;
    const plan = planned === undefined ? base.planPanelDrop?.(request, context) : { command: planned };
    if (!plan) return undefined;
    const command = planned === undefined ? revealDestination(plan.command, request.targetGroup.id) : planned;
    const next = previewPlaygroundCommand(snapshot, command);
    if (!next) return undefined;
    const projection = projectPlayground(next);
    const group = Object.values(projection.groups).find((group) =>
      group.panelIds.includes(request.panel.id),
    );
    if (!group) return undefined;
    const rect = preview(next, group.id, context);
    return rect ? { command, previewRect: rect } : undefined;
  };
  return {
    ...base,
    movePanel: (id, target) =>
      revealDestination(
        base.movePanel?.(id, target) ?? {
          type: "move-panel",
          panelId: panelId(id),
          target: { groupId: groupId(target) },
          select: true,
          activate: true,
        },
        target,
      ),
    redockFloatingSurface: (id) => {
      const snapshot = getSnapshot();
      const surface = getEntity(snapshot.surfaces, surfaceId(id));
      const root = surface && getEntity(snapshot.nodes, surface.rootNodeId);
      if (surface?.kind === "floating" && root?.kind === "split") {
        const main = snapshot.surfaces.ids
          .map((id) => getEntity(snapshot.surfaces, id))
          .find((item) => item?.kind === "main");
        const target =
          main && snapshot.groups.ids.find((id) => containsGroup(snapshot, main.rootNodeId, id));
        if (target) {
          let index = 1;
          while (getEntity(snapshot.nodes, nodeId(`playground-redock:${id}:${index}`))) index++;
          // This existing semantic operation rehomes the entire root without flattening nested panes.
          return {
            type: "recover-orphaned-surface",
            surfaceId: surface.id,
            expectedOwnerEpoch: surface.ownerEpoch ?? 0,
            targetGroupId: target,
            edge: "block-end",
            splitNodeId: nodeId(`playground-redock:${id}:${index}`),
            ratio: 0.5,
          };
        }
      }
      const redock = base.redockFloatingSurface?.(id) ?? {
        type: "redock-surface" as const,
        surfaceId: surfaceId(id),
        target: { groupId: groupId("primary") },
      };
      if (redock.type !== "redock-surface") return redock;
      const group = root?.kind === "group" ? getEntity(snapshot.groups, root.groupId) : undefined;
      // Commit docking and the focus destination together, not as a second history entry.
      return group
        ? {
            type: "batch",
            commands: [
              redock,
              { type: "select-panel", panelId: group.selectedPanelId, activate: true },
            ],
          }
        : redock;
    },
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
  // The sheet chooses a pane, not a tab index. Dropping into the current pane
  // must not silently reorder its tabs or create a redundant history entry.
  if (placement === "center" && sourceGroup.id === targetId) return undefined;
  const surface = playgroundSurfaceForGroup(snapshot, targetId);
  if (!surface) return undefined;
  const surfaceBounds = playgroundSurfaceBounds(snapshot, surface, bounds);
  const targetRect = solvePlayground(snapshot, {
    projection,
    rootNodeId: surface.rootNodeId,
    bounds: surfaceBounds,
    splitterSize: PLAYGROUND_SPLITTER,
    splitOverrides: {},
  }).groupRects[targetId];
  if (!targetRect) return undefined;
  return createPlaygroundCommands(
    () => snapshot,
    () => bounds,
  ).planPanelDrop?.(
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
    { bounds: surfaceBounds, targetRect, splitterSize: PLAYGROUND_SPLITTER },
  );
}
