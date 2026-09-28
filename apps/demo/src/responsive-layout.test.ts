import { describe, expect, it } from "vitest";
import { solveLayout } from "@panefold/geometry";
import { canonicalizeWorkspace, reduceWorkspace, validateWorkspace } from "@panefold/kernel";
import { nodeId, type WorkspaceCommand } from "@panefold/model";
import { initialWorkspaceSnapshot, createDemoCommands, projectWorkspace } from "./workspace-config";
import { solveDemoLayout } from "./responsive-layout";

const root = nodeId("root");
const phone = { inlineStart: 0, blockStart: 0, inlineSize: 390, blockSize: 650 };

describe("mobile workspace layout policy", () => {
  it("keeps desktop constraints unchanged", () => {
    const desktop = { ...phone, inlineSize: 1200, blockSize: 800 };
    expect(solveDemoLayout(initialWorkspaceSnapshot, root, desktop)).toEqual(
      solveLayout(initialWorkspaceSnapshot, root, desktop),
    );
  });

  it("preserves all groups and snapshot data while allowing phone splitter weights to change", () => {
    const original = structuredClone(initialWorkspaceSnapshot);
    const before = solveDemoLayout(initialWorkspaceSnapshot, root, phone, { splitterSize: 16 });
    const after = solveDemoLayout(initialWorkspaceSnapshot, root, phone, {
      splitterSize: 16,
      splitOverrides: { root: { weights: [0.32, 0.45, 0.23] } },
    });
    expect(Object.keys(before.groupRects).sort()).toEqual(
      ["navigation", "primary", "inspector", "output"].sort(),
    );
    expect(
      Math.abs(
        required(after.groupRects.navigation).inlineSize -
          required(before.groupRects.navigation).inlineSize,
      ),
    ).toBeGreaterThan(10);
    for (const rect of Object.values(after.groupRects)) {
      expect(rect.inlineSize).toBeGreaterThanOrEqual(44);
      expect(rect.blockSize).toBeGreaterThanOrEqual(96);
      expect(rect.inlineStart + rect.inlineSize).toBeLessThanOrEqual(phone.inlineSize);
    }
    expect(initialWorkspaceSnapshot).toEqual(original);
  });

  it.each(["inline-end", "block-end"] as const)(
    "matches the committed small-screen %s split to its preview",
    (edge) => {
      const snapshot = initialWorkspaceSnapshot;
      const projection = projectWorkspace(snapshot);
      const sourceGroup = required(projection.groups.primary);
      const panel = required(projection.panels.notes);
      const bounds = phone;
      const targetRect = required(
        solveDemoLayout(snapshot, root, bounds, { splitterSize: 16 }).groupRects.primary,
      );
      const plan = createDemoCommands(() => snapshot).planPanelDrop?.(
        {
          revision: projection.revision,
          panel,
          sourceGroup,
          sourcePanels: sourceGroup.panelIds.map((id) => required(projection.panels[id])),
          targetPanels: sourceGroup.panelIds.map((id) => required(projection.panels[id])),
          targetGroup: sourceGroup,
          targetNodeId: "primary-node",
          target: { kind: "edge", edge, ratio: 0.5 },
        },
        { bounds, targetRect, splitterSize: 16 },
      );
      if (plan === undefined) throw new Error("Expected a valid split plan");
      const reduced = reduceWorkspace(snapshot, plan.command as WorkspaceCommand);
      if (!reduced.ok) throw new Error(reduced.error.message);
      const next = canonicalizeWorkspace(reduced.snapshot).snapshot;
      const nextProjection = projectWorkspace(next);
      const newGroup = Object.values(nextProjection.groups).find((group) =>
        group.panelIds.includes("notes"),
      );
      if (newGroup === undefined) throw new Error("Expected a new group");
      expect(newGroup.id).not.toBe("primary");
      expect(plan.previewRect).toEqual(
        solveDemoLayout(next, root, bounds, { splitterSize: 16 }).groupRects[newGroup.id],
      );
      expect(validateWorkspace(next)).toEqual([]);
    },
  );
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing layout test fixture");
  return value;
}
