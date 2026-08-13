import { performance } from "node:perf_hooks";
import process from "node:process";
import { cpus } from "node:os";

import { allocateAxis, hitTestNodes } from "../packages/geometry/dist/index.js";
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

const smokeStartedAt = performance.now();

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

const reorderProfiles = [benchmarkReorder(50, 250, 2_000), benchmarkReorder(500, 100, 1_000)];
const hitTestProfiles = [100, 500, 1_000].map((nodeCount) => benchmarkHitTest(nodeCount, 10_000));

const violations = validateWorkspace(snapshot);
if (violations.length > 0) throw new Error(`Benchmark ended with ${violations.length} violations`);
const totalMs = performance.now() - smokeStartedAt;
if (totalMs > 30_000) {
  throw new Error(`Performance smoke exceeded its 30s safety budget: ${totalMs.toFixed(1)}ms`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      environment: {
        node: process.version,
        v8: process.versions.v8,
        platform: process.platform,
        architecture: process.arch,
        cpu: cpus()[0]?.model ?? "unknown",
      },
      kernel: { iterations: kernelIterations, elapsedMs: Number(kernelMs.toFixed(2)) },
      geometry: { iterations: geometryIterations, elapsedMs: Number(geometryMs.toFixed(2)) },
      reorderProfiles,
      hitTestProfiles,
      totalElapsedMs: Number(totalMs.toFixed(2)),
      finalRevision: snapshot.revision.toString(),
      invariantViolations: violations.length,
    },
    null,
    2,
  )}\n`,
);

function benchmarkReorder(panelCount, warmupCount, sampleCount) {
  const fixture = createBenchmarkSnapshot(panelCount);
  let current = fixture.snapshot;
  const samples = [];
  for (let index = 0; index < warmupCount + sampleCount; index += 1) {
    const group = current.groups.byId[String(fixture.groupId)];
    if (group === undefined) throw new Error("Reorder benchmark group disappeared");
    const movingPanelId = group.panelIds.at(-1);
    const beforePanelId = group.panelIds[0];
    if (movingPanelId === undefined || beforePanelId === undefined) {
      throw new Error("Reorder benchmark requires at least two panels");
    }
    const envelope = {
      id: commandId(`benchmark:reorder:${String(panelCount)}:${String(index)}`),
      origin: "application",
      label: "Benchmark relational tab reorder",
      baseRevision: current.revision,
      command: {
        type: "reorder-panels",
        groupId: fixture.groupId,
        panelIds: [movingPanelId],
        beforePanelId,
      },
    };
    const startedAt = performance.now();
    const result = executeCommand(current, envelope);
    const elapsedMs = performance.now() - startedAt;
    if (!result.ok) throw new Error(`Reorder benchmark rejected: ${result.error.code}`);
    current = result.next;
    if (index >= warmupCount) samples.push(elapsedMs);
  }
  const p95Ms = percentile(samples, 0.95);
  const targetMs = panelCount === 50 ? 1 : 5;
  return {
    panelCount,
    warmupCount,
    sampleCount,
    medianMs: rounded(percentile(samples, 0.5), 4),
    p95Ms: rounded(p95Ms, 4),
    p99Ms: rounded(percentile(samples, 0.99), 4),
    designTargetMs: targetMs,
    withinDesignTargetOnThisMachine: p95Ms <= targetMs,
    invariantViolations: validateWorkspace(current).length,
  };
}

function createBenchmarkSnapshot(panelCount) {
  const fixturePanels = Array.from({ length: panelCount }, (_, index) => ({
    id: panelId(`reorder:panel:${String(index).padStart(4, "0")}`),
    type: "benchmark.panel",
    typeVersion: 1,
    parameters: { index },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: {},
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  }));
  const fixtureGroupId = groupId(`reorder:group:${String(panelCount)}`);
  const fixtureNodeId = nodeId(`reorder:node:${String(panelCount)}`);
  const fixtureSurfaceId = surfaceId(`reorder:surface:${String(panelCount)}`);
  return {
    groupId: fixtureGroupId,
    snapshot: createWorkspaceSnapshot({
      panels: fixturePanels,
      groups: [
        {
          id: fixtureGroupId,
          panelIds: fixturePanels.map((panel) => panel.id),
          selectedPanelId: fixturePanels[0].id,
          persistent: true,
        },
      ],
      nodes: [{ kind: "group", id: fixtureNodeId, groupId: fixtureGroupId }],
      surfaces: [
        {
          id: fixtureSurfaceId,
          kind: "main",
          rootNodeId: fixtureNodeId,
          capabilities: MAIN_SURFACE_CAPABILITIES,
          maximized: false,
        },
      ],
      activation: {
        activePanelId: fixturePanels[0].id,
        activeSurfaceId: fixtureSurfaceId,
      },
      focusMemory: {
        panelId: fixturePanels[0].id,
        groupId: fixtureGroupId,
        fallback: "selected-tab",
      },
    }),
  };
}

function benchmarkHitTest(nodeCount, sampleCount) {
  const nodeRects = Object.create(null);
  for (let index = 0; index < nodeCount; index += 1) {
    const inset = index * 0.01;
    nodeRects[`node:${String(index).padStart(4, "0")}`] = {
      inlineStart: inset,
      blockStart: inset,
      inlineSize: 1_000 - inset * 2,
      blockSize: 800 - inset * 2,
    };
  }
  const layout = {
    rootNodeId: "node:0000",
    nodeRects,
    groupRects: Object.create(null),
    splitters: [],
    collapsedNodeIds: [],
    diagnostics: [],
  };
  for (let index = 0; index < 250; index += 1) {
    hitTestNodes(layout, { inline: 500, block: 400 });
  }
  const startedAt = performance.now();
  for (let index = 0; index < sampleCount; index += 1) {
    if (hitTestNodes(layout, { inline: 500, block: 400 }) === undefined) {
      throw new Error("Hit-test benchmark did not find a node");
    }
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    nodeCount,
    sampleCount,
    elapsedMs: rounded(elapsedMs, 2),
    meanMicroseconds: rounded((elapsedMs * 1_000) / sampleCount, 3),
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function rounded(value, digits) {
  return Number(value.toFixed(digits));
}
