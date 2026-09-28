import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@panefold/kernel";
import { createWorkspaceRuntime } from "@panefold/runtime";
import {
  playgroundSnapshot,
  projectPlayground,
  playgroundBounds,
  planPlaygroundMove,
  previewPlaygroundCommand,
  solvePlayground,
  PANE_MIN_WIDTH,
  PANE_MIN_HEIGHT,
  PLAYGROUND_SPLITTER,
  type Placement,
} from "./playground-model";

const phone = { inlineStart: 0, blockStart: 0, inlineSize: 374, blockSize: 600 };
describe("readable touch playground", () => {
  it("starts with two full-width panes and keeps the model unchanged on rotation", () => {
    const original = structuredClone(playgroundSnapshot);
    expect(validateWorkspace(original)).toEqual([]);
    for (const bounds of [phone, { ...phone, inlineSize: 800, blockSize: 210 }]) {
      const projection = projectPlayground(original);
      const canvas = playgroundBounds(original, projection.rootNodeId, bounds);
      const layout = solvePlayground(original, {
        projection,
        rootNodeId: projection.rootNodeId,
        bounds: canvas,
        splitterSize: PLAYGROUND_SPLITTER,
        splitOverrides: {},
      });
      expect(Object.keys(layout.groupRects)).toHaveLength(2);
      for (const rect of Object.values(layout.groupRects)) {
        expect(rect.inlineSize).toBe(canvas.inlineSize);
        expect(rect.blockSize).toBeGreaterThanOrEqual(PANE_MIN_HEIGHT);
      }
    }
    expect(original).toEqual(playgroundSnapshot);
  });
  it("uses exact commands for nested splits, preserves minimums, and supports undo", () => {
    const runtime = createWorkspaceRuntime({ initialSnapshot: playgroundSnapshot });
    try {
      const steps: readonly [string, string, Placement][] = [
        ["checklist", "secondary", "inline-end"],
        ["activity", "secondary", "block-end"],
        ["notes", "secondary", "inline-start"],
      ];
      for (const [source, target, placement] of steps) {
        const snapshot = runtime.getSnapshot();
        const plan = planPlaygroundMove(snapshot, source, target, placement, phone);
        expect(plan).toBeDefined();
        if (!plan) throw new Error("Expected move");
        const next = previewPlaygroundCommand(snapshot, plan.command);
        if (!next) throw new Error("Expected valid preview");
        const projection = projectPlayground(next);
        const group = Object.values(projection.groups).find((group) =>
          group.panelIds.includes(source),
        );
        if (!group) throw new Error("Expected destination group");
        const layout = solvePlayground(next, {
          projection,
          rootNodeId: projection.rootNodeId,
          bounds: phone,
          splitterSize: PLAYGROUND_SPLITTER,
          splitOverrides: {},
        });
        expect(plan.previewRect).toEqual(layout.groupRects[group.id]);
        for (const rect of Object.values(layout.groupRects)) {
          expect(rect.inlineSize).toBeGreaterThanOrEqual(PANE_MIN_WIDTH);
          expect(rect.blockSize).toBeGreaterThanOrEqual(PANE_MIN_HEIGHT);
        }
        expect(runtime.dispatch(plan.command).status).toBe("committed");
        expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
      }
      const projection = projectPlayground(runtime.getSnapshot());
      expect(
        playgroundBounds(runtime.getSnapshot(), projection.rootNodeId, phone).inlineSize,
      ).toBeGreaterThan(phone.inlineSize);
      for (let i = 0; i < steps.length; i++) expect(runtime.undo().status).toBe("committed");
      expect(runtime.getSnapshot().groups.ids).toEqual(playgroundSnapshot.groups.ids);
    } finally {
      runtime.dispose();
    }
  });
  it("rejects missing panels and destinations without mutating the workspace", () => {
    expect(
      planPlaygroundMove(playgroundSnapshot, "missing", "secondary", "center", phone),
    ).toBeUndefined();
    expect(
      planPlaygroundMove(playgroundSnapshot, "notes", "missing", "center", phone),
    ).toBeUndefined();
    expect(validateWorkspace(playgroundSnapshot)).toEqual([]);
  });
});
