import { performance } from "node:perf_hooks";
import process from "node:process";

import { allocateAxis } from "../packages/geometry/dist/index.js";
import { executeCommand, validateWorkspace } from "../packages/kernel/dist/index.js";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  commandId,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
} from "../packages/model/dist/index.js";

const panels = Array.from({ length: 24 }, (_, index) => ({
  id: panelId(`benchmark:panel:${String(index).padStart(2, "0")}`),
  type: "benchmark.panel",
  typeVersion: 1,
  parameters: { index },
  capabilities: DEFAULT_PANEL_CAPABILITIES,
  constraints: { hardMinInline: 80, hardMinBlock: 60 },
  lifecycle: DEFAULT_PANEL_LIFECYCLE,
}));
const benchmarkGroupId = groupId("benchmark:group");
const benchmarkNodeId = nodeId("benchmark:node");
const benchmarkSurfaceId = surfaceId("benchmark:surface");
let snapshot = createWorkspaceSnapshot({
  panels,
  groups: [
    {
      id: benchmarkGroupId,
      panelIds: panels.map((panel) => panel.id),
      selectedPanelId: panels[0].id,
      persistent: true,
    },
  ],
  nodes: [{ kind: "group", id: benchmarkNodeId, groupId: benchmarkGroupId }],
  surfaces: [
    {
      id: benchmarkSurfaceId,
      kind: "main",
      rootNodeId: benchmarkNodeId,
      capabilities: MAIN_SURFACE_CAPABILITIES,
      maximized: false,
    },
  ],
  activation: { activePanelId: panels[0].id, activeSurfaceId: benchmarkSurfaceId },
  focusMemory: {
    panelId: panels[0].id,
    groupId: benchmarkGroupId,
    fallback: "selected-tab",
  },
});

const kernelIterations = 10_000;
const kernelStart = performance.now();
for (let index = 0; index < kernelIterations; index += 1) {
  const target = panels[index % panels.length];
  const result = executeCommand(snapshot, {
    id: commandId(`benchmark:command:${String(index)}`),
    origin: "application",
    label: "Benchmark selection",
    baseRevision: snapshot.revision,
    command: { type: "select-panel", panelId: target.id },
  });
  if (!result.ok) throw new Error(`Kernel benchmark rejected: ${result.error.code}`);
  snapshot = result.next;
}
const kernelMs = performance.now() - kernelStart;

const geometryIterations = 100_000;
const geometryStart = performance.now();
for (let index = 0; index < geometryIterations; index += 1) {
  const allocation = allocateAxis(
    [
      { key: "a", weight: 220_000, constraints: { min: 120 } },
      { key: "b", weight: 550_000, constraints: { min: 240 } },
      { key: "c", weight: 230_000, constraints: { min: 96 } },
    ],
    1_200 + (index % 20),
  );
  if (allocation.sizes.reduce((sum, value) => sum + value, 0) !== 1_200 + (index % 20)) {
    throw new Error("Geometry benchmark violated exact conservation");
  }
}
const geometryMs = performance.now() - geometryStart;

const violations = validateWorkspace(snapshot);
if (violations.length > 0) throw new Error(`Benchmark ended with ${violations.length} violations`);
const totalMs = kernelMs + geometryMs;
if (totalMs > 30_000) {
  throw new Error(`Performance smoke exceeded its 30s safety budget: ${totalMs.toFixed(1)}ms`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      kernel: { iterations: kernelIterations, elapsedMs: Number(kernelMs.toFixed(2)) },
      geometry: { iterations: geometryIterations, elapsedMs: Number(geometryMs.toFixed(2)) },
      finalRevision: snapshot.revision.toString(),
      invariantViolations: violations.length,
    },
    null,
    2,
  )}\n`,
);
