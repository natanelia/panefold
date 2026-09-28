import assert from "node:assert/strict";
import { defaultGroupConstraints, solveLayout } from "../packages/geometry/dist/index.js";
import {
  createWorkspaceSnapshot,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  groupId,
  nodeId,
  panelId,
} from "../packages/model/dist/index.js";
import { baselineRef, loadBaselineGeometry } from "./benchmarks/baseline-geometry.mjs";
import { pairedBenchmark, reportBenchmarks } from "./benchmarks/paired.mjs";
const original = await loadBaselineGeometry("solve-layout");

function fixture(groupCount, tabs) {
  const panels = [],
    groups = [],
    nodes = [];
  for (let g = 0; g < groupCount; g += 1) {
    const ids = [];
    for (let p = 0; p < tabs; p += 1) {
      const id = panelId(`p:${g}:${p}`);
      ids.push(id);
      panels.push({
        id,
        type: "benchmark",
        typeVersion: 1,
        parameters: null,
        capabilities: DEFAULT_PANEL_CAPABILITIES,
        lifecycle: DEFAULT_PANEL_LIFECYCLE,
        constraints: {
          hardMinInline: 20 + (p % 5),
          hardMinBlock: 15 + (p % 7),
          preferredInline: 60,
          preferredBlock: 40,
          collapsible: p % 3 === 0,
        },
      });
    }
    const id = groupId(`g:${g}`);
    groups.push({ id, panelIds: ids, selectedPanelId: ids[0], persistent: true });
    nodes.push({ id: nodeId(`n:${g}`), kind: "group", groupId: id });
  }
  if (groupCount > 1)
    nodes.push({
      id: nodeId("root"),
      kind: "split",
      axis: "inline",
      children: nodes.map((node) => node.id),
      weights: nodes.map(() => 1),
      collapsedChildIds: [],
    });
  return {
    snapshot: createWorkspaceSnapshot({ panels, groups, nodes }),
    group: groups[0],
    root: groupCount > 1 ? nodeId("root") : nodeId("n:0"),
  };
}
const results = [];
for (const tabs of [1, 8, 50, 500]) {
  const { snapshot, group } = fixture(1, tabs);
  assert.deepEqual(
    defaultGroupConstraints(group, snapshot),
    original.defaultGroupConstraints(group, snapshot),
  );
  results.push(
    pairedBenchmark(
      `constraints/${tabs}-tabs`,
      () => original.defaultGroupConstraints(group, snapshot),
      () => defaultGroupConstraints(group, snapshot),
    ),
  );
}
const rect = { inlineStart: 0, blockStart: 0, inlineSize: 1920, blockSize: 1080 };
for (const [groupCount, tabs] of [
  [1, 1],
  [8, 1],
  [8, 8],
  [16, 50],
]) {
  const { snapshot, root } = fixture(groupCount, tabs);
  assert.deepEqual(solveLayout(snapshot, root, rect), original.solveLayout(snapshot, root, rect));
  results.push(
    pairedBenchmark(
      `solve/${groupCount}-groups/${tabs}-tabs`,
      () => original.solveLayout(snapshot, root, rect),
      () => solveLayout(snapshot, root, rect),
    ),
  );
}
reportBenchmarks(results, {
  baseline: baselineRef,
  comparison: "Actual original geometry sources versus built candidate",
});
