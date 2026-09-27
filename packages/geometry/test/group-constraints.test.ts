import fc from "fast-check";
import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  type GroupRecord,
  type PanelConstraints,
} from "@panefold/model";
import { describe, expect, it } from "vitest";
import { defaultGroupConstraints, solveLayout } from "../src/index.js";
import { referenceGroupConstraints } from "./reference-group-constraints.js";

function fixture(
  constraints: readonly PanelConstraints[],
  members: readonly number[],
  selected: number,
) {
  const panels = constraints.map((entry, index) => ({
    id: panelId(`p:${index}`),
    type: "test",
    typeVersion: 1,
    parameters: null,
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
    constraints: entry,
  }));
  const group: GroupRecord = {
    id: groupId("g"),
    panelIds: members.map((index) => panelId(`p:${index}`)),
    selectedPanelId: panelId(`p:${selected}`),
    persistent: true,
  };
  return {
    group,
    snapshot: createWorkspaceSnapshot({
      panels,
      groups: [group],
      nodes: [{ id: nodeId("n"), kind: "group", groupId: group.id }],
    }),
  };
}

describe("single-pass group constraint compatibility", () => {
  it("preserves missing members, duplicate members, external selections and aspect fallback", () => {
    for (const [members, selected] of [
      [[], 0],
      [[-1], 0],
      [[0, 0, 1], 0],
      [[0], 1],
      [[0, 1], -1],
      [[1, 0], -1],
    ] as const) {
      const { group, snapshot } = fixture(
        [
          { hardMinInline: 20, hardMinBlock: 40, preferredAspectRatio: 2, collapsible: true },
          { hardMinInline: 80, hardMinBlock: 10, maxInline: 12, preferredBlock: 100 },
        ],
        members,
        selected,
      );
      expect(defaultGroupConstraints(group, snapshot)).toEqual(
        referenceGroupConstraints(group, snapshot),
      );
    }
  });

  it("matches both constraints and solved geometry for 5000 seeded cases", () => {
    const dimension = fc.oneof(
      fc.integer({ min: -10, max: 2000 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0),
    );
    const constraints = fc.oneof(
      fc.constant({}),
      fc.record({
        hardMinInline: dimension,
        hardMinBlock: dimension,
        preferredMinInline: dimension,
        preferredMinBlock: dimension,
        preferredInline: dimension,
        preferredBlock: dimension,
        maxInline: dimension,
        maxBlock: dimension,
        grow: dimension,
        shrink: dimension,
        collapsePriority: dimension,
        collapsible: fc.boolean(),
        preferredAspectRatio: dimension,
      }),
    );
    fc.assert(
      fc.property(
        fc.array(constraints, { maxLength: 64 }),
        fc.array(fc.integer({ min: -2, max: 70 }), { maxLength: 80 }),
        fc.integer({ min: -2, max: 70 }),
        (records, members, selected) => {
          const { group, snapshot } = fixture(records, members, selected);
          expect(defaultGroupConstraints(group, snapshot)).toEqual(
            referenceGroupConstraints(group, snapshot),
          );
          const rect = { inlineStart: 0, blockStart: 0, inlineSize: 1000, blockSize: 700 };
          expect(solveLayout(snapshot, nodeId("n"), rect)).toEqual(
            solveLayout(snapshot, nodeId("n"), rect, {
              resolveGroupConstraints: referenceGroupConstraints,
            }),
          );
        },
      ),
      { seed: 20260927, numRuns: 5000 },
    );
  });
});
