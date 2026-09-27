import fc from "fast-check";
import {
  createWorkspaceSnapshot,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type WorkspacePatch,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";
import { planLayoutInvalidation } from "../src/index.js";
// Exact baseline blob from 81b11b4; do not share traversal helpers with the candidate.
import { planLayoutInvalidation as referenceInvalidation } from "./reference-invalidation.js";

function patchesBetween(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspacePatch[] {
  const patches: WorkspacePatch[] = [];
  for (const [kind, table] of [
    ["panel", "panels"],
    ["group", "groups"],
    ["node", "nodes"],
    ["surface", "surfaces"],
  ] as const) {
    const ids = new Set([...before[table].ids, ...after[table].ids]);
    for (const id of ids) {
      const previous = before[table].byId[id];
      const next = after[table].byId[id];
      patches.push({
        kind,
        id,
        ...(previous === undefined ? {} : { before: previous }),
        ...(next === undefined ? {} : { after: next }),
      } as WorkspacePatch);
    }
  }
  return patches;
}

const graphArbitrary = fc
  .record({
    panels: fc.array(fc.integer({ min: 0, max: 500 }), { maxLength: 12 }),
    groups: fc.array(fc.array(fc.integer({ min: -1, max: 13 }), { maxLength: 8 }), {
      maxLength: 8,
    }),
    nodes: fc.array(
      fc.record({
        split: fc.boolean(),
        block: fc.boolean(),
        links: fc.array(fc.integer({ min: -1, max: 13 }), { maxLength: 6 }),
        weight: fc.integer({ min: 1, max: 10 }),
        collapsed: fc.boolean(),
      }),
      { maxLength: 12 },
    ),
    roots: fc.array(fc.integer({ min: -1, max: 13 }), { maxLength: 4 }),
    selected: fc.integer({ min: -1, max: 13 }),
    minimized: fc.boolean(),
    maximized: fc.boolean(),
  })
  .map((input) =>
    createWorkspaceSnapshot({
      panels: input.panels.map((minimum, index) => ({
        id: panelId(`p:${index}`),
        type: "test",
        typeVersion: 1,
        parameters: null,
        capabilities: DEFAULT_PANEL_CAPABILITIES,
        lifecycle: DEFAULT_PANEL_LIFECYCLE,
        constraints: { hardMinInline: minimum },
      })),
      groups: input.groups.map((members, index) => ({
        id: groupId(`g:${index}`),
        panelIds: members.map((member) => panelId(`p:${member}`)),
        selectedPanelId: panelId(`p:${input.selected}`),
        persistent: true,
      })),
      nodes: input.nodes.map((entry, index) =>
        entry.split
          ? {
              id: nodeId(`n:${index}`),
              kind: "split" as const,
              axis: entry.block ? ("block" as const) : ("inline" as const),
              children: entry.links.map((link) => nodeId(`n:${link}`)),
              weights: entry.links.map(() => entry.weight),
              collapsedChildIds: entry.collapsed
                ? entry.links.slice(0, 1).map((link) => nodeId(`n:${link}`))
                : [],
            }
          : {
              id: nodeId(`n:${index}`),
              kind: "group" as const,
              groupId: groupId(`g:${entry.links[0] ?? index}`),
            },
      ),
      surfaces: input.roots.map((root, index) => ({
        id: surfaceId(`s:${index}`),
        kind: "main" as const,
        rootNodeId: nodeId(`n:${root}`),
        capabilities: MAIN_SURFACE_CAPABILITIES,
        minimized: input.minimized,
        maximized: input.maximized,
      })),
    }),
  );

describe("lazy and batched invalidation compatibility", () => {
  it("does not inspect topology for geometry-neutral patches", () => {
    const snapshot = createWorkspaceSnapshot();
    const guarded = Object.defineProperties(
      { ...snapshot },
      Object.fromEntries(
        ["panels", "groups", "nodes", "surfaces"].map((table) => [
          table,
          {
            get: () => {
              throw new Error(`Unexpected ${table} scan`);
            },
          },
        ]),
      ),
    );
    for (const patches of [
      [],
      [{ kind: "metadata", before: {}, after: { title: "new" } }],
      [{ kind: "activation", before: {}, after: { activePanelId: panelId("p") } }],
      [{ kind: "focus-memory", before: snapshot.focusMemory, after: snapshot.focusMemory }],
      [{ kind: "floating-order", before: [], after: [surfaceId("s")] }],
    ] satisfies WorkspacePatch[][]) {
      expect(planLayoutInvalidation(guarded, guarded, patches)).toEqual({
        constraintNodeIds: [],
        geometryNodeIds: [],
        surfaceIds: [],
        surfaceIndexIds: [],
      });
    }
  });

  it("retains independent old and new descendants when node IDs are reused", () => {
    const make = (child: string) =>
      createWorkspaceSnapshot({
        nodes: [
          {
            id: nodeId("root"),
            kind: "split",
            axis: "inline",
            children: [nodeId(child)],
            weights: [1],
            collapsedChildIds: [],
          },
          { id: nodeId(child), kind: "group", groupId: groupId("g") },
        ],
        surfaces: [
          {
            id: surfaceId("s"),
            kind: "main",
            rootNodeId: nodeId("root"),
            capabilities: MAIN_SURFACE_CAPABILITIES,
            maximized: false,
          },
        ],
      });
    const before = make("old");
    const after = make("new");
    const patches = patchesBetween(before, after);
    const result = planLayoutInvalidation(before, after, [...patches, ...patches]);
    expect(result).toEqual(referenceInvalidation(before, after, patches));
    expect(result.geometryNodeIds).toEqual(["new", "old", "root"]);
    expect(Object.isFrozen(result)).toBe(true);
    for (const list of Object.values(result)) expect(Object.isFrozen(list)).toBe(true);
  });

  it("builds constraint indexes only when a later patch needs them", () => {
    const make = (minimum: number, weight: number) =>
      createWorkspaceSnapshot({
        panels: [
          {
            id: panelId("p"),
            type: "test",
            typeVersion: 1,
            parameters: null,
            capabilities: DEFAULT_PANEL_CAPABILITIES,
            lifecycle: DEFAULT_PANEL_LIFECYCLE,
            constraints: { hardMinInline: minimum },
          },
        ],
        groups: [
          {
            id: groupId("g"),
            panelIds: [panelId("p")],
            selectedPanelId: panelId("p"),
            persistent: true,
          },
        ],
        nodes: [
          {
            id: nodeId("root"),
            kind: "split",
            axis: "inline",
            children: [nodeId("leaf")],
            weights: [weight],
            collapsedChildIds: [],
          },
          { id: nodeId("leaf"), kind: "group", groupId: groupId("g") },
        ],
        surfaces: [
          {
            id: surfaceId("s"),
            kind: "main",
            rootNodeId: nodeId("root"),
            capabilities: MAIN_SURFACE_CAPABILITIES,
            maximized: false,
          },
        ],
      });
    const before = make(10, 1);
    const after = make(20, 2);
    const weightPatch: WorkspacePatch = {
      kind: "node",
      id: nodeId("root"),
      ...(before.nodes.byId.root === undefined ? {} : { before: before.nodes.byId.root }),
      ...(after.nodes.byId.root === undefined ? {} : { after: after.nodes.byId.root }),
    };
    const panelPatch: WorkspacePatch = {
      kind: "panel",
      id: panelId("p"),
      ...(before.panels.byId.p === undefined ? {} : { before: before.panels.byId.p }),
      ...(after.panels.byId.p === undefined ? {} : { after: after.panels.byId.p }),
    };
    const guard = (snapshot: WorkspaceSnapshot) =>
      Object.defineProperties(
        { ...snapshot },
        {
          groups: {
            get: () => {
              throw new Error("Unneeded group scan");
            },
          },
          panels: {
            get: () => {
              throw new Error("Unneeded panel scan");
            },
          },
        },
      );
    expect(planLayoutInvalidation(guard(before), guard(after), [weightPatch])).toEqual(
      referenceInvalidation(before, after, [weightPatch]),
    );
    for (const patches of [
      [weightPatch, panelPatch],
      [panelPatch, weightPatch],
    ]) {
      expect(planLayoutInvalidation(before, after, patches)).toEqual(
        referenceInvalidation(before, after, patches),
      );
    }
  });

  it("preserves sparse and inherited indexed child traversal", () => {
    const children = new Array<ReturnType<typeof nodeId>>(3);
    children[2] = nodeId("own");
    const prototype = Object.create(Array.prototype) as Record<string, unknown>;
    prototype[0] = nodeId("inherited");
    Object.setPrototypeOf(children, prototype);
    const canonical = createWorkspaceSnapshot({
      nodes: [
        {
          id: nodeId("root"),
          kind: "split",
          axis: "inline",
          children,
          weights: [1, 1, 1],
          collapsedChildIds: [],
        },
      ],
      surfaces: [
        {
          id: surfaceId("s"),
          kind: "main",
          rootNodeId: nodeId("root"),
          capabilities: MAIN_SURFACE_CAPABILITIES,
          maximized: false,
        },
      ],
    });
    const canonicalRoot = canonical.nodes.byId.root;
    if (canonicalRoot?.kind !== "split") throw new Error("Missing fixture root");
    const snapshot: WorkspaceSnapshot = {
      ...canonical,
      nodes: {
        ...canonical.nodes,
        byId: { ...canonical.nodes.byId, root: { ...canonicalRoot, children } },
      },
    };
    const root = snapshot.nodes.byId.root;
    const patches: WorkspacePatch[] = [
      { kind: "node", id: nodeId("root"), ...(root === undefined ? {} : { after: root }) },
    ];
    expect(planLayoutInvalidation(snapshot, snapshot, patches)).toEqual(
      referenceInvalidation(snapshot, snapshot, patches),
    );
    expect(planLayoutInvalidation(snapshot, snapshot, patches).geometryNodeIds).toEqual([
      "inherited",
      "own",
      "root",
    ]);
  });

  it("matches the original for cyclic, missing, moved, shared and duplicate topology", () => {
    fc.assert(
      fc.property(graphArbitrary, graphArbitrary, (before, after) => {
        const patches = patchesBetween(before, after);
        const expected = referenceInvalidation(before, after, patches);
        expect(planLayoutInvalidation(before, after, patches)).toEqual(expected);
        expect(planLayoutInvalidation(before, after, [...patches].reverse())).toEqual(expected);
        expect(planLayoutInvalidation(before, after, [...patches, ...patches])).toEqual(expected);
        // No cache survives a call, including when the caller reuses snapshot identity.
        expect(planLayoutInvalidation(before, before, [])).toEqual(
          referenceInvalidation(before, before, []),
        );
      }),
      { seed: 20260927, numRuns: 2400 },
    );
  });
});
