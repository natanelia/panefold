import assert from "node:assert/strict";
import { planLayoutInvalidation } from "../packages/geometry/dist/index.js";
import {
  createWorkspaceSnapshot,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  groupId,
  nodeId,
  panelId,
  surfaceId,
} from "../packages/model/dist/index.js";
import { baselineRef, loadBaselineGeometry } from "./benchmarks/baseline-geometry.mjs";
import { pairedBenchmark, reportBenchmarks } from "./benchmarks/paired.mjs";
const { planLayoutInvalidation: original } = await loadBaselineGeometry("invalidation");

function fixture(count) {
  const panels = [],
    groups = [],
    nodes = [];
  for (let index = 0; index < count; index += 1) {
    const id = panelId(`p:${index}`),
      group = groupId(`g:${index}`),
      node = nodeId(`n:${index}`);
    panels.push({
      id,
      type: "bench",
      typeVersion: 1,
      parameters: null,
      capabilities: DEFAULT_PANEL_CAPABILITIES,
      lifecycle: DEFAULT_PANEL_LIFECYCLE,
      constraints: { hardMinInline: 10 },
    });
    groups.push({ id: group, panelIds: [id], selectedPanelId: id, persistent: true });
    nodes.push({ id: node, kind: "group", groupId: group });
  }
  const root = nodeId("root"),
    surface = surfaceId("s");
  nodes.push({
    id: root,
    kind: "split",
    axis: "inline",
    children: nodes.map((node) => node.id),
    weights: nodes.map(() => 1),
    collapsedChildIds: [],
  });
  const snapshot = createWorkspaceSnapshot({
    panels,
    groups,
    nodes,
    surfaces: [
      {
        id: surface,
        kind: "main",
        rootNodeId: root,
        capabilities: MAIN_SURFACE_CAPABILITIES,
        maximized: false,
      },
    ],
  });
  const changedPanels = panels.map((panel) => ({ ...panel, constraints: { hardMinInline: 20 } }));
  const after = createWorkspaceSnapshot({
    panels: changedPanels,
    groups,
    nodes,
    surfaces: Object.values(snapshot.surfaces.byId),
  });
  const changedRoot = { ...nodes.at(-1), weights: nodes.at(-1).weights.map(() => 2) };
  const resized = createWorkspaceSnapshot({
    panels,
    groups,
    nodes: [...nodes.slice(0, -1), changedRoot],
    surfaces: Object.values(snapshot.surfaces.byId),
  });
  const oneChanged = createWorkspaceSnapshot({
    panels: [changedPanels[0], ...panels.slice(1)],
    groups,
    nodes,
    surfaces: Object.values(snapshot.surfaces.byId),
  });
  return {
    before: snapshot,
    after,
    oneChanged,
    resized,
    panels,
    changedPanels,
    groups,
    root: nodes.at(-1),
    changedRoot,
  };
}
const results = [];
for (const count of [1, 8, 50, 500]) {
  const { before, after, oneChanged, resized, panels, changedPanels, groups, root, changedRoot } =
    fixture(count);
  const constraintPatches = panels.map((panel, index) => ({
    kind: "panel",
    id: panel.id,
    before: panel,
    after: changedPanels[index],
  }));
  for (const [name, next, patches] of [
    ["empty", before, []],
    ["metadata", before, [{ kind: "metadata", before: {}, after: { title: "renamed" } }]],
    [
      "panel-title",
      before,
      [
        {
          kind: "panel",
          id: panels[0].id,
          before: panels[0],
          after: { ...panels[0], title: "renamed" },
        },
      ],
    ],
    [
      "group-chrome",
      before,
      [
        {
          kind: "group",
          id: groups[0].id,
          before: groups[0],
          after: { ...groups[0], persistent: false },
        },
      ],
    ],
    ["one-constraint", oneChanged, constraintPatches.slice(0, 1)],
    ["all-constraints", after, constraintPatches],
    [
      "weights",
      resized,
      [
        {
          kind: "node",
          id: root.id,
          before: root,
          after: changedRoot,
        },
      ],
    ],
  ]) {
    const expected = original(before, next, patches);
    assert.deepEqual(planLayoutInvalidation(before, next, patches), expected);
    results.push(
      pairedBenchmark(
        `${name}/${count}-groups`,
        () => original(before, next, patches),
        () => planLayoutInvalidation(before, next, patches),
      ),
    );
  }
}
reportBenchmarks(results, {
  baseline: baselineRef,
  comparison:
    "Original eager per-patch walks versus per-call lazy indexes and snapshot-local visits",
});
