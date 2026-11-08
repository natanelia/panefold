import {
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelCapabilities,
  type PanelLifecyclePolicy,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import type { WorkspaceCommandAdapter, WorkspaceProjection } from "@panefold/react";
import { createModelWorkspaceCommands, projectModelWorkspace } from "@panefold/react/model";
import { solveDemoLayout } from "./responsive-layout";

const capabilities: PanelCapabilities = {
  closable: true,
  floatable: true,
  popout: true,
  pictureInPicture: false,
  singleton: true,
};

const lifecycle: PanelLifecyclePolicy = {
  hidden: "suspend",
  sameDocumentMove: "preserve-host",
  crossDocumentMove: "portal-coupled",
};

function panel(
  id: string,
  type: string,
  title: string,
  constraints: PanelRecord["constraints"] = {},
): PanelRecord {
  return {
    id: panelId(id),
    type,
    typeVersion: 1,
    title,
    parameters: {},
    capabilities,
    constraints,
    lifecycle,
  };
}

const panelRecords = [
  panel("route-explorer", "map.route-explorer", "Explorer", {
    hardMinInline: 180,
    preferredInline: 250,
  }),
  panel("layers", "map.layers", "Search", {
    hardMinInline: 180,
    preferredInline: 250,
  }),
  panel("map-canvas", "map.canvas", "App.tsx", {
    hardMinInline: 320,
    hardMinBlock: 220,
    preferredInline: 900,
    preferredBlock: 650,
    resizeDelivery: "adaptive",
  }),
  panel("notes", "map.notes", "workspace.ts", {
    hardMinInline: 240,
    hardMinBlock: 160,
  }),
  panel("feature-inspector", "map.inspector", "Outline", {
    hardMinInline: 230,
    preferredInline: 310,
  }),
  panel("validation", "map.validation", "Source Control", {
    hardMinInline: 230,
    preferredInline: 310,
  }),
  panel("problems", "map.problems", "Terminal", {
    hardMinBlock: 130,
    preferredBlock: 220,
    resizeDelivery: "throttled",
  }),
  panel("timeline", "map.timeline", "Problems", {
    hardMinBlock: 130,
    preferredBlock: 220,
  }),
] as const;

const groups: readonly GroupRecord[] = [
  {
    id: groupId("navigation"),
    panelIds: [panelId("route-explorer"), panelId("layers")],
    selectedPanelId: panelId("route-explorer"),
    region: "navigation",
    persistent: true,
  },
  {
    id: groupId("primary"),
    panelIds: [panelId("map-canvas"), panelId("notes")],
    selectedPanelId: panelId("map-canvas"),
    region: "primary",
    persistent: true,
  },
  {
    id: groupId("inspector"),
    panelIds: [panelId("feature-inspector"), panelId("validation")],
    selectedPanelId: panelId("feature-inspector"),
    region: "inspector",
    persistent: true,
  },
  {
    id: groupId("output"),
    panelIds: [panelId("problems"), panelId("timeline")],
    selectedPanelId: panelId("problems"),
    region: "output",
    persistent: true,
  },
];

const nodes: readonly LayoutNode[] = [
  {
    kind: "split",
    id: nodeId("root"),
    axis: "inline",
    children: [nodeId("navigation-node"), nodeId("center-stack"), nodeId("inspector-node")],
    weights: [220_000, 550_000, 230_000],
    collapsedChildIds: [],
  },
  {
    kind: "group",
    id: nodeId("navigation-node"),
    groupId: groupId("navigation"),
  },
  {
    kind: "split",
    id: nodeId("center-stack"),
    axis: "block",
    children: [nodeId("primary-node"), nodeId("output-node")],
    weights: [720_000, 280_000],
    collapsedChildIds: [],
  },
  {
    kind: "group",
    id: nodeId("primary-node"),
    groupId: groupId("primary"),
  },
  {
    kind: "group",
    id: nodeId("output-node"),
    groupId: groupId("output"),
  },
  {
    kind: "group",
    id: nodeId("inspector-node"),
    groupId: groupId("inspector"),
  },
];

const surfaces: readonly SurfaceRecord[] = [
  {
    id: surfaceId("main"),
    kind: "main",
    rootNodeId: nodeId("root"),
    capabilities: MAIN_SURFACE_CAPABILITIES,
    maximized: false,
  },
];

export const initialWorkspaceSnapshot = createWorkspaceSnapshot({
  applicationLayoutVersion: 2,
  panels: panelRecords,
  groups,
  nodes,
  surfaces,
  activation: {
    activePanelId: panelId("map-canvas"),
    activeSurfaceId: surfaceId("main"),
  },
  focusMemory: {
    panelId: panelId("map-canvas"),
    groupId: groupId("primary"),
    fallback: "selected-tab",
  },
  metadata: {
    name: "panefold-demo",
    locale: "en-US",
    product: "Panefold Code",
  },
});

const groupLabels: Readonly<Record<string, string>> = {
  navigation: "Primary Side Bar",
  primary: "Editor Group",
  inspector: "Secondary Side Bar",
  output: "Panel",
};

/** Workbench labels are application policy; the model bridge stays product-neutral. */
export function projectWorkspace(snapshot: WorkspaceSnapshot): WorkspaceProjection {
  return projectModelWorkspace(snapshot, {
    groupLabel: (group) => groupLabels[String(group.id)] ?? group.region ?? "Panel group",
  });
}

export function createDemoCommands(
  getSnapshot: () => WorkspaceSnapshot,
): WorkspaceCommandAdapter<WorkspaceCommand> {
  return createModelWorkspaceCommands(getSnapshot, {
    solveLayout: solveDemoLayout,
    floatingBounds: (_panelId, snapshot) => {
      const offset = snapshot.floatingOrder.length * 28;
      return {
        x: 48 + (offset % 224),
        y: 42 + (offset % 168),
        width: 480,
        height: 340,
      };
    },
    redockTarget: (_surfaceId, snapshot) => ({ groupId: demoRedockTarget(snapshot) }),
  });
}

function demoRedockTarget(snapshot: WorkspaceSnapshot) {
  const mainSurface = snapshot.surfaces.ids
    .map((id) => getEntity(snapshot.surfaces, id))
    .find((surface) => surface?.kind === "main");
  if (mainSurface === undefined) return groupId("primary");
  const groups = collectReachableNodeIds(snapshot, mainSurface.rootNodeId).flatMap((id) => {
    const node = getEntity(snapshot.nodes, id);
    return node?.kind === "group" ? [node.groupId] : [];
  });
  return groups.find((id) => String(id) === "primary") ?? groups[0] ?? groupId("primary");
}

function collectReachableNodeIds(
  snapshot: WorkspaceSnapshot,
  rootNodeId: LayoutNode["id"],
): readonly LayoutNode["id"][] {
  const result: LayoutNode["id"][] = [];
  const pending = [rootNodeId];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(String(current))) continue;
    seen.add(String(current));
    const node = getEntity(snapshot.nodes, current);
    if (node === undefined) continue;
    result.push(node.id);
    if (node.kind === "split") pending.push(...node.children);
  }
  return result;
}
