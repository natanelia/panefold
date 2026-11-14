import { describe, expect, it } from "vitest";
import { validateWorkspace } from "../../kernel/src/index";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  NORMALIZED_SPLIT_WEIGHT_TOTAL,
  createPanel,
  createWorkspaceLayout,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type PanelInput,
  type PanelRecord,
  type WorkspaceLayoutInput,
  type WorkspaceLayoutNode,
} from "@panefold/model";

describe("createPanel", () => {
  it("fills defaults and accepts an existing complete PanelRecord", () => {
    const panel = createPanel({ id: "notes", type: "app.notes", title: "Notes" });
    expect(panel).toEqual({
      id: panelId("notes"),
      type: "app.notes",
      title: "Notes",
      typeVersion: 1,
      parameters: {},
      capabilities: DEFAULT_PANEL_CAPABILITIES,
      constraints: {},
      lifecycle: DEFAULT_PANEL_LIFECYCLE,
    });
    const existing: PanelRecord = {
      ...panel,
      typeVersion: 3,
      parameters: null,
      checkpointRef: "checkpoint:notes",
    };
    expect(createPanel(existing)).toEqual(existing);
    expect(Object.isFrozen(panel)).toBe(true);
  });

  it("merges partial policy overrides and severs mutable caller references", () => {
    const parameters = { document: { lines: ["before"] } };
    const capabilities = { closable: false };
    const constraints = { hardMinInline: 120, resizeDelivery: "deferred" as const };
    const lifecycle = { hidden: "suspend" as const };
    const panel = createPanel({
      id: "map",
      type: "app.map",
      parameters,
      capabilities,
      constraints,
      lifecycle,
    });
    parameters.document.lines.push("after");
    capabilities.closable = true;
    constraints.hardMinInline = 500;
    expect(panel.parameters).toEqual({ document: { lines: ["before"] } });
    expect(panel.capabilities).toEqual({ ...DEFAULT_PANEL_CAPABILITIES, closable: false });
    expect(panel.lifecycle).toEqual({ ...DEFAULT_PANEL_LIFECYCLE, hidden: "suspend" });
    expect(panel.constraints.hardMinInline).toBe(120);
    expect(Object.isFrozen(panel.parameters)).toBe(true);
    expect(Object.isFrozen(panel.capabilities)).toBe(true);
    expect(Object.isFrozen(panel.constraints)).toBe(true);
    expect(Object.isFrozen(parameters)).toBe(false);
    expect(Object.isFrozen(lifecycle)).toBe(false);
  });

  it.each<readonly [Partial<PanelInput>, RegExp]>([
    [{ id: " " }, /Panel id.*non-empty/],
    [{ type: "" }, /type.*non-empty/],
    [{ typeVersion: 0 }, /typeVersion.*positive safe integer/],
    [{ parameters: { bad: Number.NaN } }, /finite JSON/],
    [{ constraints: { hardMinInline: Number.POSITIVE_INFINITY } }, /hardMinInline.*finite/],
    [{ constraints: { preferredAspectRatio: 0 } }, /preferredAspectRatio.*positive/],
    [{ constraints: { hardMinInline: 120, maxInline: 100 } }, /maximum.*hard minimum/],
  ])("rejects invalid panel input %j", (overrides, message) => {
    expect(() => createPanel({ id: "panel", type: "app.panel", ...overrides })).toThrow(message);
  });
});

const declaredPanels = [
  { id: "notes", type: "app.editor" },
  { id: "preview", type: "app.preview" },
  { id: "inspector", type: "app.inspector" },
];

function twoGroups(overrides: Partial<WorkspaceLayoutInput> = {}): WorkspaceLayoutInput {
  return {
    panels: declaredPanels,
    layout: {
      id: "root",
      axis: "inline",
      weights: [3, 1],
      children: [
        { id: "editor", nodeId: "editor-node", panels: ["notes", "preview"] },
        { id: "inspector", nodeId: "inspector-node", panels: ["inspector"] },
      ],
    },
    ...overrides,
  };
}

describe("createWorkspaceLayout", () => {
  it("builds a kernel-valid tree, preserves explicit identities, and normalizes proportions", () => {
    const snapshot = createWorkspaceLayout(
      twoGroups({
        activePanelId: "preview",
        surfaceId: "workspace",
        applicationLayoutVersion: 3,
        metadata: { layout: "default" },
      }),
    );
    expect(validateWorkspace(snapshot)).toEqual([]);
    expect(getEntity(snapshot.groups, groupId("editor"))).toMatchObject({
      panelIds: ["notes", "preview"],
      selectedPanelId: "preview",
      persistent: true,
    });
    expect(getEntity(snapshot.nodes, nodeId("root"))).toMatchObject({
      children: ["editor-node", "inspector-node"],
      weights: [750_000, 250_000],
      collapsedChildIds: [],
    });
    expect(getEntity(snapshot.surfaces, surfaceId("workspace"))).toMatchObject({
      kind: "main",
      rootNodeId: "root",
      maximized: false,
    });
    expect(snapshot.activation).toEqual({ activePanelId: "preview", activeSurfaceId: "workspace" });
    expect(snapshot.focusMemory).toEqual({
      panelId: "preview",
      groupId: "editor",
      fallback: "selected-tab",
    });
    expect(snapshot.applicationLayoutVersion).toBe(3);
    expect(snapshot.metadata).toEqual({ layout: "default" });
  });

  it("generates deterministic path identities and follows visual order for default activation", () => {
    const input: WorkspaceLayoutInput = {
      panels: declaredPanels,
      layout: {
        axis: "inline",
        children: [
          { panels: ["preview"] },
          { axis: "block", children: [{ panels: ["notes"] }, { panels: ["inspector"] }] },
        ],
      },
    };
    const snapshot = createWorkspaceLayout(input);
    expect(validateWorkspace(snapshot)).toEqual([]);
    expect(createWorkspaceLayout(structuredClone(input))).toEqual(snapshot);
    expect(createWorkspaceLayout({ ...input, panels: [...input.panels].reverse() })).toEqual(
      snapshot,
    );
    expect(snapshot.activation.activePanelId).toBe("preview");
    expect(snapshot.activation.activeSurfaceId).toBe("main");
    expect(snapshot.groups.ids).toEqual([
      "panefold:group:root.0",
      "panefold:group:root.1.0",
      "panefold:group:root.1.1",
    ]);
    expect(getEntity(snapshot.nodes, nodeId("panefold:split:root"))).toMatchObject({
      children: ["panefold:node:root.0", "panefold:split:root.1"],
      weights: [500_000, 500_000],
    });
  });

  it("retains explicit selection and supports empty persistent destinations", () => {
    const selected = createWorkspaceLayout({
      panels: declaredPanels,
      layout: { panels: ["notes", "preview", "inspector"], selectedPanelId: "inspector" },
    });
    expect(selected.activation.activePanelId).toBe("inspector");
    const empty = createWorkspaceLayout({ panels: [], layout: { id: "empty", panels: [] } });
    expect(validateWorkspace(empty)).toEqual([]);
    expect(empty.activation).toEqual({});
    expect(empty.focusMemory).toEqual({ fallback: "workspace-root" });
    expect(getEntity(empty.groups, groupId("empty"))?.persistent).toBe(true);
  });

  it("owns a frozen snapshot without freezing or retaining the caller's layout", () => {
    const panelOrder = ["notes", "preview", "inspector"];
    const metadata = { preferences: { compact: false } };
    const input: WorkspaceLayoutInput = {
      panels: declaredPanels,
      metadata,
      layout: { id: "all", panels: panelOrder },
    };
    const snapshot = createWorkspaceLayout(input);
    panelOrder.reverse();
    metadata.preferences.compact = true;
    expect(getEntity(snapshot.groups, groupId("all"))?.panelIds).toEqual([
      "notes",
      "preview",
      "inspector",
    ]);
    expect(snapshot.metadata).toEqual({ preferences: { compact: false } });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes.byId)).toBe(true);
    expect(Object.isFrozen(input.layout)).toBe(false);
  });

  it.each([
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [Number.MIN_VALUE, Number.MAX_VALUE],
    [0.1, 0.2],
  ])("normalizes finite extreme and fractional weights %j", (...weights) => {
    const snapshot = createWorkspaceLayout({
      panels: [],
      layout: { id: "root", axis: "inline", children: [{ panels: [] }, { panels: [] }], weights },
    });
    const split = getEntity(snapshot.nodes, nodeId("root"));
    expect(split?.kind).toBe("split");
    if (split?.kind !== "split") throw new Error("Expected split");
    expect(split.weights.every((weight) => Number.isSafeInteger(weight) && weight > 0)).toBe(true);
    expect(split.weights.reduce((sum, weight) => sum + weight, 0)).toBe(
      NORMALIZED_SPLIT_WEIGHT_TOTAL,
    );
    expect(validateWorkspace(snapshot)).toEqual([]);
  });

  const invalidLayouts: readonly (readonly [string, WorkspaceLayoutInput, RegExp])[] = [
    [
      "duplicate panel declarations",
      {
        panels: [
          { id: "notes", type: "app.notes" },
          { id: "notes", type: "app.notes" },
        ],
        layout: { panels: ["notes"] },
      },
      /Duplicate panel id notes/,
    ],
    ["unassigned panels", twoGroups({ layout: { panels: ["notes"] } }), /preview.*not assigned/],
    ["missing panels", { panels: [], layout: { panels: ["missing"] } }, /undeclared panel missing/],
    [
      "duplicate membership",
      {
        panels: [{ id: "notes", type: "app.notes" }],
        layout: {
          axis: "inline",
          children: [
            { id: "a", panels: ["notes"] },
            { id: "b", panels: ["notes"] },
          ],
        },
      },
      /notes.*more than once.*a and b/,
    ],
    [
      "invalid selection",
      {
        panels: [{ id: "notes", type: "app.notes" }],
        layout: { panels: ["notes"], selectedPanelId: "missing" },
      },
      /selectedPanelId missing.*belong/,
    ],
    [
      "conflicting selection and activation",
      {
        panels: declaredPanels,
        activePanelId: "preview",
        layout: { panels: ["notes", "preview", "inspector"], selectedPanelId: "notes" },
      },
      /must select activePanelId preview/,
    ],
    [
      "missing active panel",
      twoGroups({ activePanelId: "missing" }),
      /activePanelId missing.*declared/,
    ],
    [
      "empty transient group",
      { panels: [], layout: { panels: [], persistent: false } },
      /Empty group.*persistent/,
    ],
    [
      "duplicate group ids",
      {
        panels: [],
        layout: {
          axis: "inline",
          children: [
            { id: "same", panels: [] },
            { id: "same", panels: [] },
          ],
        },
      },
      /Duplicate group id same/,
    ],
    [
      "duplicate node ids",
      {
        panels: [],
        layout: {
          id: "same",
          axis: "inline",
          children: [{ nodeId: "same", panels: [] }, { panels: [] }],
        },
      },
      /Duplicate layout node id same/,
    ],
    [
      "unary split",
      { panels: [], layout: { axis: "inline", children: [{ panels: [] }] } },
      /requires between 2/,
    ],
    [
      "mismatched weights",
      {
        panels: [],
        layout: { axis: "inline", children: [{ panels: [] }, { panels: [] }], weights: [1] },
      },
      /one value per child/,
    ],
    [
      "non-positive weights",
      {
        panels: [],
        layout: { axis: "inline", children: [{ panels: [] }, { panels: [] }], weights: [1, 0] },
      },
      /finite positive/,
    ],
    [
      "non-finite weights",
      {
        panels: [],
        layout: {
          axis: "inline",
          children: [{ panels: [] }, { panels: [] }],
          weights: [Infinity, 1],
        },
      },
      /finite positive/,
    ],
    [
      "duplicate singletons",
      {
        panels: [
          { id: "one", type: "map", capabilities: { singleton: true } },
          { id: "two", type: "map" },
        ],
        layout: { panels: ["one", "two"] },
      },
      /Singleton panel type map/,
    ],
  ];
  it.each(invalidLayouts)("rejects %s with actionable errors", (_name, input, message) => {
    expect(() => createWorkspaceLayout(input)).toThrow(message);
  });

  it("rejects cyclic and shared layout objects without recursive traversal", () => {
    const children: WorkspaceLayoutNode[] = [];
    const cycle: WorkspaceLayoutNode = { axis: "inline", children };
    children.push({ panels: [] }, cycle);
    expect(() => createWorkspaceLayout({ panels: [], layout: cycle })).toThrow(/cycle or reuses/);
    const shared: WorkspaceLayoutNode = { panels: [] };
    expect(() =>
      createWorkspaceLayout({
        panels: [],
        layout: { axis: "inline", children: [shared, shared] },
      }),
    ).toThrow(/cycle or reuses/);
  });

  it("rejects excessive depth before recursive kernel consumers receive it", () => {
    let layout: WorkspaceLayoutNode = { panels: [] };
    for (let index = 0; index < 130; index += 1) {
      layout = { axis: index % 2 === 0 ? "inline" : "block", children: [{ panels: [] }, layout] };
    }
    expect(() => createWorkspaceLayout({ panels: [], layout })).toThrow(
      /maximum nesting depth of 128/,
    );
  });
});
