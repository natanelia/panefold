import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@panefold/kernel";
import { createWorkspaceRuntime } from "@panefold/runtime";
import { panelId, closedPanelId } from "@panefold/model";
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
  it("does not treat an existing pane as a move or silently reorder its tabs", () => {
    const original = structuredClone(playgroundSnapshot);
    for (const [id, group] of [
      ["notes", "primary"],
      ["checklist", "primary"],
      ["preview", "secondary"],
      ["activity", "secondary"],
    ] as const) {
      expect(planPlaygroundMove(original, id, group, "center", phone)).toBeUndefined();
      expect(planPlaygroundMove(original, id, group, "block-end", phone)).toBeDefined();
    }
    expect(original).toEqual(playgroundSnapshot);
  });
  it("does not offer floating for the last docked panel and enables it after reopening", () => {
    const runtime = createWorkspaceRuntime({ initialSnapshot: playgroundSnapshot });
    try {
      for (const id of ["checklist", "preview", "activity"]) {
        const receipt = runtime.dispatch({
          type: "close-panels",
          targets: [{ panelId: panelId(id), closedPanelId: closedPanelId(`audit-closed-${id}`) }],
        });
        expect(receipt.status).toBe("committed");
      }
      expect(projectPlayground(runtime.getSnapshot()).panels.notes?.floatable).toBe(false);
      const closed = runtime
        .getSnapshot()
        .recoverableClosedPanels.find((entry) => entry.panel.id === "checklist");
      if (!closed) throw new Error("Expected a recoverable panel");
      expect(runtime.dispatch({ type: "reopen-panel", closedPanelId: closed.id }).status).toBe(
        "committed",
      );
      expect(projectPlayground(runtime.getSnapshot()).panels.notes?.floatable).toBe(true);
      expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
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

describe("floating placement policy", () => {
  it("keeps the floating destination for every edge and viewport shape", async () => {
    const { createPlaygroundCommands, playgroundSurfaceForGroup } = await import("./playground-model");
    for (const bounds of [phone, { ...phone, inlineSize: 900, blockSize: 620 }]) {
      for (const placement of ["inline-start", "inline-end", "block-start", "block-end"] as const) {
        const runtime = createWorkspaceRuntime({ initialSnapshot: playgroundSnapshot });
        try {
          const commands = createPlaygroundCommands(runtime.getSnapshot, () => bounds);
          const float = commands.floatPanel?.("notes");
          if (!float) throw new Error("Missing float command");
          expect(runtime.dispatch(float).status).toBe("committed");
          const snapshot = runtime.getSnapshot();
          const group = Object.values(projectPlayground(snapshot).groups).find((g) =>
            g.panelIds.includes("notes"),
          );
          if (!group) throw new Error("Missing floating group");
          const surface = playgroundSurfaceForGroup(snapshot, group.id);
          if (!surface || surface.kind !== "floating") throw new Error("Missing floating surface");
          const move = planPlaygroundMove(snapshot, "checklist", group.id, placement, bounds);
          if (!move) throw new Error(`Missing ${placement} move`);
          expect(runtime.dispatch(move.command).status).toBe("committed");
          const next = runtime.getSnapshot();
          expect(next.floatingOrder).toContain(surface.id);
          expect(playgroundSurfaceForGroup(next, group.id)?.id).toBe(surface.id);
          expect(validateWorkspace(next)).toEqual([]);
        } finally {
          runtime.dispose();
        }
      }
    }
  });
  it("restores a minimized destination atomically and redocks a nested float without flattening it", async () => {
    const { createPlaygroundCommands, playgroundSurfaceForGroup, playgroundSurfaceBounds } =
      await import("./playground-model");
    const { surfaceId } = await import("@panefold/model");
    const runtime = createWorkspaceRuntime({ initialSnapshot: playgroundSnapshot });
    try {
      const commands = createPlaygroundCommands(runtime.getSnapshot);
      const float = commands.floatPanel?.("notes");
      if (!float) throw new Error("Missing float command");
      expect(runtime.dispatch(float).status).toBe("committed");
      let snapshot = runtime.getSnapshot();
      const group = Object.values(projectPlayground(snapshot).groups).find((g) =>
        g.panelIds.includes("notes"),
      );
      if (!group) throw new Error("Missing floating group");
      const surface = playgroundSurfaceForGroup(snapshot, group.id);
      if (!surface) throw new Error("Missing floating surface");
      expect(
        runtime.dispatch({ type: "minimize-surface", surfaceId: surfaceId(surface.id) }).status,
      ).toBe("committed");
      snapshot = runtime.getSnapshot();
      const move = planPlaygroundMove(snapshot, "checklist", group.id, "block-end", phone);
      if (!move) throw new Error("Cannot split a floating destination");
      const predicted = previewPlaygroundCommand(snapshot, move.command);
      expect(predicted).toBeDefined();
      expect(runtime.dispatch(move.command).status).toBe("committed");
      const next = runtime.getSnapshot();
      const floatingSurface = playgroundSurfaceForGroup(next, group.id);
      if (!floatingSurface) throw new Error("Lost floating surface");
      expect(floatingSurface.minimized).not.toBe(true);
      const projection = projectPlayground(next);
      const moved = Object.values(projection.groups).find((g) => g.panelIds.includes("checklist"));
      if (!moved) throw new Error("Lost checklist");
      const layout = solvePlayground(next, {
        projection,
        rootNodeId: floatingSurface.rootNodeId,
        bounds: playgroundSurfaceBounds(next, floatingSurface, phone),
        splitterSize: PLAYGROUND_SPLITTER,
        splitOverrides: {},
      });
      expect(move.previewRect).toEqual(layout.groupRects[moved.id]);
      const redock = commands.redockFloatingSurface?.(surface.id);
      if (!redock) throw new Error("Missing redock command");
      expect(runtime.dispatch(redock).status).toBe("committed");
      expect(runtime.getSnapshot().floatingOrder).toHaveLength(0);
      expect(runtime.getSnapshot().groups.ids).toHaveLength(3);
      expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
      expect(runtime.undo().status).toBe("committed");
      expect(runtime.getSnapshot().floatingOrder).toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });
});
