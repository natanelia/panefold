import { describe, expect, it } from "vitest";
import { solveLayout } from "@panefold/geometry";
import { validateWorkspace } from "@panefold/kernel";
import {
  MAIN_SURFACE_CAPABILITIES,
  closedPanelId,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type BatchableWorkspaceCommand,
} from "@panefold/model";
import { createWorkspaceRuntime } from "@panefold/runtime";

import {
  createModelWorkspaceBindings,
  createModelWorkspaceCommands,
  createModelWorkspaceSession,
  projectModelWorkspace,
  type ModelWorkspaceBindings,
} from "../src/model";
import type { WorkspaceGroupDropRequest, WorkspacePanelDropRequest } from "../src/types";
import { modelBounds, modelFixture, modelPanel } from "./model-fixture";

function solve(bindings: ModelWorkspaceBindings) {
  const snapshot = bindings.runtime.getSnapshot();
  const projection = bindings.projector(snapshot);
  return bindings.layoutSolver(snapshot, {
    projection,
    rootNodeId: projection.rootNodeId,
    bounds: modelBounds,
    splitterSize: 6,
    splitOverrides: {},
  });
}

function panelRequest(bindings: ModelWorkspaceBindings, id = "b"): WorkspacePanelDropRequest {
  const projection = bindings.projector(bindings.runtime.getSnapshot());
  const panel = projection.panels[id];
  const sourceGroup = Object.values(projection.groups).find((group) => group.panelIds.includes(id));
  const targetGroup = projection.groups.right;
  if (!panel || !sourceGroup || !targetGroup) throw new Error("Missing fixture panel/group");
  return {
    revision: projection.revision,
    panel,
    sourceGroup,
    sourcePanels: sourceGroup.panelIds.flatMap((panelId) => projection.panels[panelId] ?? []),
    targetGroup,
    targetPanels: targetGroup.panelIds.flatMap((panelId) => projection.panels[panelId] ?? []),
    targetNodeId: "right-node",
    target: { kind: "edge", edge: "block-start", ratio: 0.3 },
  };
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

describe("model-backed React integration", () => {
  it("preserves prototype-sensitive model IDs as own projection entries", () => {
    const snapshot = modelFixture({
      panels: [modelPanel("__proto__")],
      groups: [
        {
          id: groupId("__proto__"),
          panelIds: [panelId("__proto__")],
          selectedPanelId: panelId("__proto__"),
          persistent: true,
        },
      ],
      nodes: [{ kind: "group", id: nodeId("__proto__"), groupId: groupId("__proto__") }],
      surfaces: [
        {
          id: surfaceId("main"),
          kind: "main",
          rootNodeId: nodeId("__proto__"),
          capabilities: MAIN_SURFACE_CAPABILITIES,
          maximized: false,
        },
      ],
      activation: { activePanelId: panelId("__proto__"), activeSurfaceId: surfaceId("main") },
    });
    expect(validateWorkspace(snapshot)).toEqual([]);
    const projection = projectModelWorkspace(snapshot);
    for (const table of [projection.nodes, projection.groups, projection.panels]) {
      expect(Object.keys(table)).toEqual(["__proto__"]);
      expect(Object.hasOwn(table, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(table)).toBeNull();
    }
  });

  it("projects model capabilities and resize policy without demo-specific labels", () => {
    const snapshot = modelFixture();
    expect(validateWorkspace(snapshot)).toEqual([]);
    const projection = projectModelWorkspace(snapshot);
    expect(projection.panels.a).toMatchObject({
      title: "A",
      floatable: true,
      resizeDelivery: "deferred",
      parameters: { id: "a" },
    });
    expect(projection.groups.left?.label).toBe("Panel group");
    expect(
      projectModelWorkspace(snapshot, { groupLabel: (group) => `Area ${group.id}` }).groups.left
        ?.label,
    ).toBe("Area left");
  });

  it("enforces model constraints and forwards temporary split overrides", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    try {
      const layout = solve(session);
      expect(layout.groupRects.left?.inlineSize).toBeGreaterThanOrEqual(420);
      const snapshot = session.runtime.getSnapshot();
      const projection = session.projector(snapshot);
      const overrides = { root: { weights: [900_000, 100_000] } };
      expect(
        session.layoutSolver(snapshot, {
          projection,
          rootNodeId: projection.rootNodeId,
          bounds: modelBounds,
          splitterSize: 6,
          splitOverrides: overrides,
        }),
      ).toEqual(
        solveLayout(snapshot, nodeId(projection.rootNodeId), modelBounds, {
          splitterSize: 6,
          splitOverrides: overrides,
        }),
      );
      expect(session.runtime.getSnapshot()).toBe(snapshot);
    } finally {
      session.dispose();
    }
  });

  it("shares its configured solver between exact drop previews and committed geometry", () => {
    let solverCalls = 0;
    const session = createModelWorkspaceSession(
      { initialSnapshot: modelFixture() },
      {
        solveLayout: (...args) => {
          solverCalls += 1;
          return solveLayout(...args);
        },
      },
    );
    try {
      const request = panelRequest(session);
      const context = {
        bounds: modelBounds,
        targetRect: required(solve(session).groupRects.right),
        splitterSize: 6,
      };
      const before = session.runtime.getSnapshot();
      const plan = session.commands.planPanelDrop?.(request, context);
      expect(plan).toEqual(session.commands.planPanelDrop?.(request, context));
      expect(session.runtime.getSnapshot()).toBe(before);
      expect(session.runtime.getTransactions()).toHaveLength(0);
      expect(session.runtime.dispatch(required(plan?.command)).status).toBe("committed");
      const next = session.runtime.getSnapshot();
      const destination = Object.values(next.groups.byId).find((group) =>
        group.panelIds.includes(panelId("b")),
      );
      expect(destination).toBeDefined();
      expect(plan?.previewRect).toEqual(solve(session).groupRects[String(destination?.id)]);
      expect(solverCalls).toBeGreaterThanOrEqual(4);
      expect(session.commands.planPanelDrop?.(request, context)).toBeUndefined();
      expect(session.runtime.getTransactions()).toHaveLength(1);
      expect(session.runtime.undo().status).toBe("committed");
      expect(getEntity(session.runtime.getSnapshot().groups, groupId("left"))?.panelIds).toEqual([
        panelId("a"),
        panelId("b"),
      ]);
      expect(session.runtime.redo().status).toBe("committed");
      expect(validateWorkspace(session.runtime.getSnapshot())).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("reorders and moves tabs through existing semantic commands", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    try {
      expect(
        session.runtime.dispatch(
          required(session.commands.reorderPanel?.("b", "left", { beforePanelId: "a" })),
        ).status,
      ).toBe("committed");
      expect(getEntity(session.runtime.getSnapshot().groups, groupId("left"))?.panelIds).toEqual([
        panelId("b"),
        panelId("a"),
      ]);
      expect(
        session.runtime.dispatch(required(session.commands.movePanel?.("b", "right"))).status,
      ).toBe("committed");
      expect(getEntity(session.runtime.getSnapshot().groups, groupId("right"))?.panelIds).toEqual([
        panelId("c"),
        panelId("b"),
      ]);
      expect(session.runtime.dispatch(session.commands.selectPanel("c")).status).toBe("committed");
      expect(session.runtime.getSnapshot().activation.activePanelId).toBe(panelId("c"));
      expect(validateWorkspace(session.runtime.getSnapshot())).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it.each<WorkspaceGroupDropRequest["target"]>([
    { kind: "swap" },
    { kind: "merge" },
    { kind: "edge", edge: "block-end", ratio: 0.4 },
  ])("previews and commits whole-group $kind placement as one transaction", (target) => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    try {
      const snapshot = session.runtime.getSnapshot();
      const projection = session.projector(snapshot);
      const sourceGroup = required(projection.groups.left);
      const targetGroup = required(projection.groups.right);
      const plan = session.commands.planGroupDrop?.(
        {
          revision: projection.revision,
          sourceGroup,
          sourcePanels: sourceGroup.panelIds.map((id) => required(projection.panels[id])),
          sourceNodeId: "left-node",
          targetGroup,
          targetPanels: targetGroup.panelIds.map((id) => required(projection.panels[id])),
          targetNodeId: "right-node",
          target,
        },
        {
          bounds: modelBounds,
          targetRect: required(solve(session).groupRects.right),
          splitterSize: 6,
        },
      );
      expect(session.runtime.getSnapshot()).toBe(snapshot);
      expect(session.runtime.dispatch(required(plan?.command)).status).toBe("committed");
      expect(session.runtime.getTransactions()).toHaveLength(1);
      const destination = target.kind === "merge" ? "right" : "left";
      expect(plan?.previewRect).toEqual(solve(session).groupRects[destination]);
      expect(
        getEntity(session.runtime.getSnapshot().groups, groupId(destination))?.panelIds,
      ).toEqual(
        target.kind === "merge"
          ? [panelId("c"), panelId("a"), panelId("b")]
          : [panelId("a"), panelId("b")],
      );
      expect(validateWorkspace(session.runtime.getSnapshot())).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("keeps close identities fresh across pending commands and restored records", () => {
    const initial = modelFixture({
      recoverableClosedPanels: [
        {
          id: closedPanelId("panefold:closed:a:1"),
          panel: modelPanel("retired"),
          formerPlacement: { groupId: groupId("left") },
          closedAtRevision: modelFixture().revision,
        },
      ],
    });
    const session = createModelWorkspaceSession({ initialSnapshot: initial });
    try {
      const first = session.commands.closePanel("a");
      const second = session.commands.closePanel("a");
      expect(first).not.toEqual(second);
      expect(first).toMatchObject({ targets: [{ closedPanelId: "panefold:closed:a:2" }] });
      expect(session.runtime.dispatch(first).status).toBe("committed");
      expect(session.runtime.getSnapshot().recoverableClosedPanels).toHaveLength(2);
      expect(session.runtime.undo().status).toBe("committed");
      expect(getEntity(session.runtime.getSnapshot().panels, panelId("a"))).toBeDefined();
    } finally {
      session.dispose();
    }
  });

  it("allocates fresh split identities after restoring an earlier placement of the same panel", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    try {
      const context = {
        bounds: modelBounds,
        targetRect: required(solve(session).groupRects.right),
        splitterSize: 6,
      };
      const first = session.commands.planPanelDrop?.(panelRequest(session), context);
      expect(session.runtime.dispatch(required(first?.command)).status).toBe("committed");
      const splitGroup = Object.values(session.runtime.getSnapshot().groups.byId).find((group) =>
        group.panelIds.includes(panelId("b")),
      );
      if (!splitGroup) throw new Error("Expected a new split group");
      expect(
        session.runtime.dispatch(required(session.commands.movePanel?.("a", splitGroup.id))).status,
      ).toBe("committed");
      expect(
        session.runtime.dispatch(required(session.commands.movePanel?.("b", "right"))).status,
      ).toBe("committed");
      const restored = createModelWorkspaceSession({
        initialSnapshot: session.runtime.getSnapshot(),
      });
      try {
        const before = restored.runtime.getSnapshot();
        const next = restored.commands.planPanelDrop?.(panelRequest(restored), {
          ...context,
          targetRect: required(solve(restored).groupRects.right),
        });
        expect(restored.runtime.dispatch(required(next?.command)).status).toBe("committed");
        const after = restored.runtime.getSnapshot();
        const newGroup = required(
          Object.values(after.groups.byId).find((group) => group.panelIds.includes(panelId("b"))),
        );
        expect(newGroup.id).not.toBe(splitGroup.id);
        expect(getEntity(before.groups, newGroup.id)).toBeUndefined();
        expect(getEntity(after.groups, splitGroup.id)?.panelIds).toEqual([panelId("a")]);
        expect(validateWorkspace(restored.runtime.getSnapshot())).toEqual([]);
      } finally {
        restored.dispose();
      }
    } finally {
      session.dispose();
    }
  });

  it("lets applications override floating, redock and individual command policies", () => {
    const session = createModelWorkspaceSession(
      { initialSnapshot: modelFixture() },
      {
        floatingBounds: () => ({ x: 100, y: 80, width: 560, height: 360 }),
        redockTarget: () => ({ groupId: groupId("right"), beforePanelId: panelId("c") }),
        commands: {
          activatePanel: (id) => ({ type: "select-panel", panelId: panelId(id), activate: true }),
        },
      },
    );
    try {
      expect(session.commands.activatePanel("b").type).toBe("select-panel");
      expect(session.runtime.dispatch(required(session.commands.floatPanel?.("b"))).status).toBe(
        "committed",
      );
      const id = required(session.runtime.getSnapshot().floatingOrder[0]);
      expect(session.projector(session.runtime.getSnapshot()).floatingSurfaces).toHaveLength(1);
      expect(getEntity(session.runtime.getSnapshot().surfaces, id)?.bounds).toEqual({
        x: 100,
        y: 80,
        width: 560,
        height: 360,
      });
      expect(
        session.runtime.dispatch(
          required(session.commands.moveFloatingSurface?.(id, { x: 120, y: 140 })),
        ).status,
      ).toBe("committed");
      expect(session.runtime.getSnapshot().activation).toMatchObject({
        activePanelId: panelId("b"),
        activeSurfaceId: id,
      });
      expect(
        session.runtime.dispatch(required(session.commands.redockFloatingSurface?.(id))).status,
      ).toBe("committed");
      expect(getEntity(session.runtime.getSnapshot().groups, groupId("right"))?.panelIds).toEqual([
        panelId("b"),
        panelId("c"),
      ]);
      expect(session.runtime.getSnapshot().floatingOrder).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("binds an existing runtime without changing its state or owning its lifetime", () => {
    const runtime = createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    try {
      const before = runtime.getSnapshot();
      const bindings = createModelWorkspaceBindings(runtime);
      expect(bindings.runtime).toBe(runtime);
      expect(runtime.getSnapshot()).toBe(before);
      expect(runtime.dispatch(bindings.commands.selectPanel("b")).status).toBe("committed");
      expect(
        createModelWorkspaceCommands(() => runtime.getSnapshot()).resizeSplit("root", [1, 2]),
      ).toEqual({
        type: "resize-split",
        splitNodeId: nodeId("root"),
        weights: [1, 2],
      });
    } finally {
      runtime.dispose();
    }
  });

  it("leaves runtime policy transforms authoritative rather than running them during preview", () => {
    let policyCalls = 0;
    const session = createModelWorkspaceSession({
      initialSnapshot: modelFixture(),
      policies: [
        {
          id: "application-ratio",
          priority: 1,
          evaluate: (_snapshot, _envelope, command) => {
            policyCalls += 1;
            const adjust = (item: BatchableWorkspaceCommand): BatchableWorkspaceCommand =>
              item.type === "split-group" && item.ratio !== 0.7 ? { ...item, ratio: 0.7 } : item;
            if (command.type === "batch") {
              const commands = command.commands.map(adjust);
              return commands.some((item, index) => item !== command.commands[index])
                ? {
                    kind: "transform",
                    command: { ...command, commands },
                    reason: "Application split policy",
                  }
                : { kind: "allow", command };
            }
            const adjusted =
              command.type === "split-group" && command.ratio !== 0.7
                ? { ...command, ratio: 0.7 }
                : command;
            return adjusted === command
              ? { kind: "allow", command }
              : { kind: "transform", command: adjusted, reason: "Application split policy" };
          },
        },
      ],
    });
    try {
      const plan = required(
        session.commands.planPanelDrop?.(panelRequest(session), {
          bounds: modelBounds,
          targetRect: required(solve(session).groupRects.right),
          splitterSize: 6,
        }),
      );
      expect(policyCalls).toBe(0);
      expect(session.runtime.dispatch(plan.command, { origin: "pointer" }).status).toBe(
        "committed",
      );
      expect(policyCalls).toBeGreaterThan(0);
      const destination = required(
        Object.values(session.runtime.getSnapshot().groups.byId).find((group) =>
          group.panelIds.includes(panelId("b")),
        ),
      );
      // Applications that transform placement must override the corresponding planners.
      expect(required(solve(session).groupRects[destination.id]).blockSize).toBeGreaterThan(
        plan.previewRect.blockSize,
      );
    } finally {
      session.dispose();
    }
  });

  it("rejects a direct stale plan when its caller supplies the captured base revision", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    try {
      const before = session.runtime.getSnapshot();
      const plan = required(
        session.commands.planPanelDrop?.(panelRequest(session), {
          bounds: modelBounds,
          targetRect: required(solve(session).groupRects.right),
          splitterSize: 6,
        }),
      );
      expect(session.runtime.dispatch(session.commands.selectPanel("b")).status).toBe("committed");
      const latest = session.runtime.getSnapshot();
      expect(session.runtime.dispatch(plan.command, { baseRevision: before.revision }).status).toBe(
        "rejected",
      );
      expect(session.runtime.getSnapshot()).toBe(latest);
    } finally {
      session.dispose();
    }
  });
});
