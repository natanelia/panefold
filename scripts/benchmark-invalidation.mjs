import assert from "node:assert/strict";
import { planLayoutInvalidation } from "../packages/geometry/dist/index.js";
import {
  createWorkspaceSnapshot,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  panelId,
  groupId,
  nodeId,
  surfaceId,
} from "../packages/model/dist/index.js";
import { baselineRef, loadBaselineGeometry } from "./benchmarks/baseline-geometry.mjs";
import { pairedBenchmark, reportBenchmarks } from "./benchmarks/paired.mjs";
const original = await loadBaselineGeometry("invalidation");
const results = [];
function fixture(count) {
  const panels = Array.from({ length: count * 4 }, (_, index) => ({
    id: panelId(`p:${index}`),
    type: "benchmark",
    typeVersion: 1,
    parameters: { value: index },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
    constraints: { preferredInline: 200 },
  }));
  const groups = Array.from({ length: count }, (_, index) => ({
    id: groupId(`g:${index}`),
    panelIds: panels.slice(index * 4, index * 4 + 4).map((panel) => panel.id),
    selectedPanelId: panels[index * 4].id,
    persistent: true,
  }));
  const nodes = groups.map((group, index) => ({
    id: nodeId(`n:${index}`),
    kind: "group",
    groupId: group.id,
  }));
  const root = {
    id: nodeId("root"),
    kind: "split",
    axis: "inline",
    children: nodes.map((node) => node.id),
    weights: nodes.map(() => 1),
    collapsedChildIds: [],
  };
  nodes.push(root);
  const surfaces = [
    {
      id: surfaceId("main"),
      kind: "main",
      rootNodeId: root.id,
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    },
  ];
  const input = { panels, groups, nodes, surfaces };
  return { input, before: createWorkspaceSnapshot(input), root };
}
for (const count of [2, 16, 128]) {
  const { input, before, root } = fixture(count);
  const scenarios = [{ name: "empty", after: before, patches: [] }];
  for (const [name, table, kind, oldRecord, newRecord] of [
    [
      "panel-parameters",
      "panels",
      "panel",
      input.panels[0],
      { ...input.panels[0], parameters: { value: 999 } },
    ],
    [
      "tab-reorder",
      "groups",
      "group",
      input.groups[0],
      { ...input.groups[0], panelIds: [...input.groups[0].panelIds].reverse() },
    ],
    [
      "constraint-control",
      "panels",
      "panel",
      input.panels[0],
      { ...input.panels[0], constraints: { preferredInline: 300 } },
    ],
    [
      "weights-control",
      "nodes",
      "node",
      root,
      { ...root, weights: root.weights.map((_, index) => index + 1) },
    ],
  ]) {
    scenarios.push({
      name,
      after: createWorkspaceSnapshot({
        ...input,
        [table]: input[table].map((record) => (record.id === oldRecord.id ? newRecord : record)),
      }),
      patches: [{ kind, id: oldRecord.id, before: oldRecord, after: newRecord }],
    });
  }
  for (const scenario of scenarios) {
    const { name, after, patches } = scenario;
    assert.deepEqual(
      planLayoutInvalidation(before, after, patches),
      original.planLayoutInvalidation(before, after, patches),
    );
    results.push(
      pairedBenchmark(
        `${name}/${count}-groups`,
        () => original.planLayoutInvalidation(before, after, patches),
        () => planLayoutInvalidation(before, after, patches),
      ),
    );
  }
  // A declared synthetic 50/50 mix, not an estimate of application traffic.
  const mixed = [scenarios[1], scenarios[3]];
  results.push(
    pairedBenchmark(
      `mixed-50-percent-geometry/${count}-groups`,
      (index) => {
        const scenario = mixed[index % mixed.length];
        return original.planLayoutInvalidation(before, scenario.after, scenario.patches);
      },
      (index) => {
        const scenario = mixed[index % mixed.length];
        return planLayoutInvalidation(before, scenario.after, scenario.patches);
      },
    ),
  );
}
reportBenchmarks(results, {
  baseline: baselineRef,
  scope: "Public invalidation planner only; not an end-to-end render or command benchmark",
});
