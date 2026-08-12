import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
} from "@panefold/model";
import { bench, describe } from "vitest";

import { benchmarkPanelGroupLookups } from "../src/index";

const panelIds = Array.from({ length: 256 }, (_, index) => panelId(`bench:panel:${index}`));
const groups: GroupRecord[] = panelIds.map((id, index) => ({
  id: groupId(`bench:group:${index}`),
  panelIds: [id],
  selectedPanelId: id,
  persistent: false,
}));
const panels: PanelRecord[] = panelIds.map((id) => ({
  id,
  type: "benchmark.panel",
  typeVersion: 1,
  title: String(id),
  parameters: {},
  capabilities: DEFAULT_PANEL_CAPABILITIES,
  constraints: {
    hardMinInline: 1,
    hardMinBlock: 1,
    preferredInline: 100,
    preferredBlock: 100,
  },
  lifecycle: DEFAULT_PANEL_LIFECYCLE,
}));
const groupNodes: LayoutNode[] = groups.map((group, index) => ({
  kind: "group",
  id: nodeId(`bench:node:${index}`),
  groupId: group.id,
}));
const rootNodeId = nodeId("bench:node:root");
const snapshot = createWorkspaceSnapshot({
  panels,
  groups,
  nodes: [
    ...groupNodes,
    {
      kind: "split",
      id: rootNodeId,
      axis: "inline",
      children: groupNodes.map((node) => node.id),
      weights: groupNodes.map(() => 1),
      collapsedChildIds: [],
    },
  ],
  surfaces: [
    {
      id: surfaceId("bench:surface"),
      kind: "main",
      rootNodeId,
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    },
  ],
});

describe("panel-to-group projection lookup", () => {
  bench("canonical table scan and indexed projection", () => {
    benchmarkPanelGroupLookups(snapshot, panelIds, 10);
  });
});
