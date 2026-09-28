import { assertBoundedValue } from "../packages/runtime/dist/index.js";
import { baselineRef, baselineCodec } from "./benchmarks/baseline-persistence.mjs";
import { pairedBenchmark, reportBenchmarks } from "./benchmarks/paired.mjs";
import { canonicalSerialize } from "../packages/kernel/dist/index.js";
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

function fixture(count) {
  const panels = Array.from({ length: count }, (_, index) => ({
    id: panelId(`p:${index}`),
    type: "benchmark.panel",
    typeVersion: 1,
    parameters: {
      title: `Editor ${index}`,
      coordinates: [index * 1.5, index * -0.01],
      enabled: true,
    },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
    constraints: { hardMinInline: 120, hardMinBlock: 80 },
  }));
  const group = groupId("g"),
    node = nodeId("n"),
    surface = surfaceId("s");
  return JSON.parse(
    canonicalSerialize(
      createWorkspaceSnapshot({
        panels,
        groups: [
          {
            id: group,
            panelIds: panels.map((p) => p.id),
            selectedPanelId: panels[0].id,
            persistent: true,
          },
        ],
        nodes: [{ id: node, kind: "group", groupId: group }],
        surfaces: [
          {
            id: surface,
            kind: "main",
            rootNodeId: node,
            capabilities: MAIN_SURFACE_CAPABILITIES,
            maximized: false,
          },
        ],
      }),
    ),
  );
}
const workloads = [
  ["number", 1.23456789e25],
  ["empty-object", {}],
  ["null", null],
  ["numbers/1000", Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 1e10)],
  [
    "short-fields/500",
    Array.from({ length: 500 }, (_, i) => ({ name: `Panel ${i}`, title: "中文🙂", enabled: true })),
  ],
  ...[1, 24, 500].map((count) => [`workspace/${count}-panels`, fixture(count)]),
  ...[8, 127, 128, 129, 1024, 100000].flatMap((length) => [
    [`ascii/${length}`, "a".repeat(length)],
    [`unicode/${length}`, "中".repeat(length)],
  ]),
  ["escaped-short", '"\\\n\0\ud800'.repeat(16)],
];
const results = workloads.map(([name, value]) => {
  baselineCodec.assertBoundedValue(value);
  assertBoundedValue(value);
  return pairedBenchmark(
    name,
    () => {
      baselineCodec.assertBoundedValue(value);
      return true;
    },
    () => {
      assertBoundedValue(value);
      return true;
    },
  );
});
reportBenchmarks(results, {
  baseline: baselineRef,
  comparison:
    "Complete bounded-value validation; not a complete decode or UI-load timing. All security checks retained.",
});
