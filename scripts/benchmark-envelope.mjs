import assert from "node:assert/strict";
import { createWorkspaceEnvelope } from "../packages/runtime/dist/index.js";
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
import { baselineRef, baselineCodec } from "./benchmarks/baseline-persistence.mjs";
import { pairedAsyncBenchmark } from "./benchmarks/paired-async.mjs";
import { reportBenchmarks } from "./benchmarks/paired.mjs";
const results = [];
for (const count of [0, 1, 24, 500]) {
  const panels = Array.from({ length: count }, (_, index) => ({
    id: panelId(`p:${index}`),
    type: "bench",
    typeVersion: 1,
    parameters: { index, text: "中文🙂editor" },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
    constraints: {},
  }));
  const group = groupId("g"),
    node = nodeId("n"),
    surface = surfaceId("s");
  const snapshot =
    count === 0
      ? createWorkspaceSnapshot()
      : createWorkspaceSnapshot({
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
        });
  for (const realHash of [false, true]) {
    // Injected digest isolates preparation cost. Default uses actual Web Crypto SHA-256.
    const options = realHash
      ? {}
      : {
          checksum: {
            async digest(text) {
              return `test-only:${text.length}`;
            },
          },
        };
    const before = await baselineCodec.createWorkspaceEnvelope(snapshot, options);
    const after = await createWorkspaceEnvelope(snapshot, options);
    assert.deepEqual(after, before);
    assert.equal(canonicalSerialize(after.workspace), canonicalSerialize(snapshot));
    results.push(
      await pairedAsyncBenchmark(
        `${realHash ? "sha256" : "preparation"}/${count}-panels`,
        () => baselineCodec.createWorkspaceEnvelope(snapshot, options),
        () => createWorkspaceEnvelope(snapshot, options),
      ),
    );
  }
}
reportBenchmarks(results, {
  baseline: baselineRef,
  comparison:
    "Complete awaited createWorkspaceEnvelope, including unchanged validation, JSON parsing, type-version collection and, for sha256 cases, actual Web Crypto hashing. No storage I/O.",
});
