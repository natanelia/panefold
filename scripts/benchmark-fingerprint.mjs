import assert from "node:assert/strict";
import { canonicalHash, canonicalSerialize, semanticHash } from "../packages/kernel/dist/index.js";
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
import { pairedBenchmark, reportBenchmarks } from "./benchmarks/paired.mjs";

// Exact pre-change arithmetic from main 81b11b4. Serialization is unchanged.
function referenceHash(snapshot, semantic = false) {
  let value = snapshot;
  if (semantic) {
    const { revision, ...state } = snapshot;
    void revision;
    value = state;
  }
  const text = canonicalSerialize(value);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv1a64-v1:${hash.toString(16).padStart(16, "0")}`;
}

function fixture(count, unicode = false) {
  if (count === 0) return createWorkspaceSnapshot();
  const panels = Array.from({ length: count }, (_, index) => ({
    id: panelId(`panel:${index}`),
    type: "benchmark.panel",
    typeVersion: 1,
    parameters: { index, text: unicode ? "中文🙂é\\\ud800".repeat(32) : "editor" },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: {},
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  }));
  const group = groupId("group:main");
  const node = nodeId("node:main");
  const surface = surfaceId("surface:main");
  return createWorkspaceSnapshot({
    panels,
    groups: [
      {
        id: group,
        panelIds: panels.map((panel) => panel.id),
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
  });
}

const results = [];
for (const [count, unicode] of [
  [0, false],
  [24, false],
  [500, false],
  [24, true],
]) {
  const snapshot = fixture(count, unicode);
  for (const [name, candidate, semantic] of [
    ["canonical", canonicalHash, false],
    ["semantic", semanticHash, true],
  ]) {
    const expected = referenceHash(snapshot, semantic);
    assert.equal(candidate(snapshot), expected);
    results.push(
      pairedBenchmark(
        `${name}/${count}-panels/${unicode ? "unicode" : "ascii"}`,
        () => referenceHash(snapshot, semantic),
        () => candidate(snapshot),
      ),
    );
  }
}
reportBenchmarks(results, { baseline: "81b11b4 BigInt FNV-1a; identical canonical serialization" });
