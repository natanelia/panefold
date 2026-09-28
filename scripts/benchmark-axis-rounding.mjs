import assert from "node:assert/strict";
import {
  allocateAxis,
  defaultGroupConstraints,
  solveLayout,
} from "../packages/geometry/dist/index.js";
import { createWorkspaceSnapshot, groupId, nodeId } from "../packages/model/dist/index.js";
import { baselineRef, loadBaselineGeometry } from "./benchmarks/baseline-geometry.mjs";
import { pairedBenchmark, reportBenchmarks } from "./benchmarks/paired.mjs";

const original = await loadBaselineGeometry("allocate-axis");
const originalLayout = await loadBaselineGeometry("solve-layout");
const results = [];
function measure(name, items, sizes, splitter = 0) {
  for (const size of sizes)
    assert.deepEqual(
      allocateAxis(items, size, splitter),
      original.allocateAxis(items, size, splitter),
    );
  results.push(
    pairedBenchmark(
      name,
      (index) => original.allocateAxis(items, sizes[index % sizes.length], splitter),
      (index) => allocateAxis(items, sizes[index % sizes.length], splitter),
    ),
  );
}
for (const count of [2, 8, 64]) {
  measure(
    `axis/integral/${count}`,
    Array.from({ length: count }, (_, index) => ({ key: `${index}` })),
    [count * 100],
  );
  measure(
    `axis/weighted/${count}`,
    Array.from({ length: count }, (_, index) => ({ key: `${index}`, weight: (index % 5) + 1 })),
    [997, 998, 999, 1000],
    4,
  );
}
measure(
  "axis/fractional-bounds",
  Array.from({ length: 8 }, (_, index) => ({
    key: `${index}`,
    constraints: { min: index + 0.2, max: index + 40.8 },
  })),
  [120, 121, 250, 251],
);
measure(
  "axis/emergency-shrink",
  Array.from({ length: 8 }, (_, index) => ({ key: `${index}`, constraints: { min: 50 + index } })),
  [10, 21, 22, 100],
);
measure(
  "axis/emergency-grow",
  Array.from({ length: 8 }, (_, index) => ({ key: `${index}`, constraints: { max: 10 + index } })),
  [200, 201, 202],
);
measure(
  "axis/collapse",
  Array.from({ length: 8 }, (_, index) => ({
    key: `${index}`,
    constraints: { min: 100, collapsible: true, collapsePriority: index % 3 },
  })),
  [100, 201, 303, 801],
  4,
);
// Both solvers use the same current group constraint callback, isolating the
// allocator change from the independently benchmarked group-scan improvement.
for (const count of [2, 8, 32]) {
  const groups = Array.from({ length: count }, (_, index) => ({
    id: groupId(`g:${index}`),
    panelIds: [],
    persistent: true,
  }));
  const nodes = groups.map((group, index) => ({
    id: nodeId(`n:${index}`),
    kind: "group",
    groupId: group.id,
  }));
  nodes.push({
    id: nodeId("root"),
    kind: "split",
    axis: "inline",
    children: nodes.map((node) => node.id),
    weights: nodes.map(() => 1),
    collapsedChildIds: [],
  });
  const snapshot = createWorkspaceSnapshot({ groups, nodes });
  const rects = [1920, 1921, 1922].map((inlineSize) => ({
    inlineStart: 0,
    blockStart: 0,
    inlineSize,
    blockSize: 1080,
  }));
  const options = { resolveGroupConstraints: defaultGroupConstraints };
  for (const rect of rects)
    assert.deepEqual(
      solveLayout(snapshot, nodeId("root"), rect, options),
      originalLayout.solveLayout(snapshot, nodeId("root"), rect, options),
    );
  results.push(
    pairedBenchmark(
      `solve/${count}-groups`,
      (index) =>
        originalLayout.solveLayout(snapshot, nodeId("root"), rects[index % rects.length], options),
      (index) => solveLayout(snapshot, nodeId("root"), rects[index % rects.length], options),
    ),
  );
}
reportBenchmarks(results, {
  baseline: baselineRef,
  comparison: "Pinned baseline allocation, identical group constraint callback in both full solves",
});
