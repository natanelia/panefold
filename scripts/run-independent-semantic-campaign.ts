import { performance } from "node:perf_hooks";

// The evidence bundle runs after package builds and intentionally uses the
// generated model entry point. Root TypeScript uses a narrow declaration shim
// beside this runner because package dist files are excluded from its project.
import {
  createDifferentialCampaign,
  type DifferentialCampaignReport,
} from "../packages/kernel-optimized/src/differential";
import { INDEPENDENT_SEMANTIC_KERNEL } from "../packages/kernel-optimized/src/independent-reducer";
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
  type WorkspaceSnapshot,
} from "../packages/model/dist/index.js";

interface CampaignArguments {
  readonly seed: number;
  readonly steps: number;
}

interface CampaignExecution {
  readonly schemaVersion: 1;
  readonly elapsedMs: number;
  readonly report: DifferentialCampaignReport;
}

const arguments_ = parseArguments(process.argv.slice(2));
const startedAt = performance.now();
const report = createDifferentialCampaign({
  initial: campaignFixture(),
  seed: arguments_.seed,
  candidate: INDEPENDENT_SEMANTIC_KERNEL,
  projection: { historyLimit: 0 },
}).runChunk(arguments_.steps);
const execution: CampaignExecution = {
  schemaVersion: 1,
  elapsedMs: Math.round(performance.now() - startedAt),
  report,
};

process.stdout.write(`${JSON.stringify(execution, null, 2)}\n`);

function parseArguments(arguments_: readonly string[]): CampaignArguments {
  let seed = 20_260_812;
  let steps = 10_000;
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if ((flag !== "--seed" && flag !== "--steps") || value === undefined) {
      throw new TypeError(
        "Usage: run-independent-semantic-campaign [--seed <integer>] [--steps <integer>]",
      );
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RangeError(`${flag} must be a non-negative safe integer`);
    }
    if (flag === "--seed") seed = parsed;
    else steps = parsed;
    index += 1;
  }
  return { seed, steps };
}

function campaignFixture(): WorkspaceSnapshot {
  const panelIds = [panelId("panel:a"), panelId("panel:b"), panelId("panel:c")] as const;
  const groupIds = [groupId("group:a"), groupId("group:b")] as const;
  const nodeIds = [nodeId("node:a"), nodeId("node:b"), nodeId("node:root")] as const;
  const panels: readonly PanelRecord[] = panelIds.map((id) => ({
    id,
    type: `test.${id}`,
    typeVersion: 1,
    parameters: {},
    capabilities: {
      ...DEFAULT_PANEL_CAPABILITIES,
      popout: true,
      pictureInPicture: true,
    },
    constraints: { collapsible: true },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  }));
  const groups: readonly GroupRecord[] = [
    {
      id: groupIds[0],
      panelIds: [panelIds[0], panelIds[1]],
      selectedPanelId: panelIds[0],
      persistent: true,
    },
    {
      id: groupIds[1],
      panelIds: [panelIds[2]],
      selectedPanelId: panelIds[2],
      persistent: true,
    },
  ];
  const nodes: readonly LayoutNode[] = [
    { kind: "group", id: nodeIds[0], groupId: groupIds[0] },
    { kind: "group", id: nodeIds[1], groupId: groupIds[1] },
    {
      kind: "split",
      id: nodeIds[2],
      axis: "inline",
      children: [nodeIds[0], nodeIds[1]],
      weights: [500_000, 500_000],
      collapsedChildIds: [],
    },
  ];
  const mainSurfaceId = surfaceId("surface:main");
  return createWorkspaceSnapshot({
    panels,
    groups,
    nodes,
    surfaces: [
      {
        id: mainSurfaceId,
        kind: "main",
        rootNodeId: nodeIds[2],
        capabilities: MAIN_SURFACE_CAPABILITIES,
        maximized: false,
      },
    ],
    activation: { activePanelId: panelIds[0], activeSurfaceId: mainSurfaceId },
    focusMemory: {
      panelId: panelIds[0],
      groupId: groupIds[0],
      fallback: "selected-tab",
    },
  });
}
