import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@panefold/kernel";
import { commandId, revision, type CommandId, type WorkspaceSnapshot } from "@panefold/model";
import { createWorkspace } from "../src/workspace";
import type { WorkspaceActionPlan } from "../src/actions";
import type { WorkspacePolicy } from "../src/policy";
import type { RuntimeDispatchReceipt } from "../src/runtime";

const bounds = { x: 20, y: 30, width: 400, height: 300 };

function fixture(
  options: {
    readonly createCommandId?: () => CommandId;
    readonly policies?: readonly WorkspacePolicy[];
  } = {},
) {
  return createWorkspace({
    panels: ["a", "b", "c"].map((id) => ({ id, type: "test.panel" })),
    layout: {
      id: "root",
      axis: "inline",
      children: [
        { id: "source", nodeId: "source-node", panels: ["a"] },
        { id: "target", nodeId: "target-node", panels: ["b", "c"] },
      ],
    },
    ...options,
  });
}

function floatingPanels(snapshot: WorkspaceSnapshot): readonly string[] {
  return snapshot.floatingOrder.flatMap((id) => {
    const surface = snapshot.surfaces.byId[id];
    const root = surface === undefined ? undefined : snapshot.nodes.byId[surface.rootNodeId];
    return root?.kind === "group" ? (snapshot.groups.byId[root.groupId]?.panelIds ?? []) : [];
  });
}

describe("workspace plans independent review", () => {
  it("plans without dispatching, evaluating policies, notifying or consuming command IDs", () => {
    let commandIds = 0;
    let policyCalls = 0;
    let notifications = 0;
    const workspace = fixture({
      createCommandId: () => commandId(`command:${++commandIds}`),
      policies: [
        {
          id: "observer",
          priority: 0,
          evaluate: (_snapshot, _envelope, command) => {
            policyCalls += 1;
            return { kind: "allow", command };
          },
        },
      ],
    });
    workspace.subscribe(() => {
      notifications += 1;
    });
    const before = workspace.getSnapshot();
    const open = workspace.plan.openPanel({ id: "new", type: "test.panel" }, "source");
    const split = workspace.plan.splitPanel("new", "block-end", { newGroupId: "tools" });
    expect(Object.isFrozen(open)).toBe(true);
    expect(Object.isFrozen(open.command)).toBe(true);
    expect(workspace.getSnapshot()).toBe(before);
    expect(workspace.getTransactions()).toEqual([]);
    expect([commandIds, policyCalls, notifications]).toEqual([0, 0, 0]);
    expect(
      workspace.actions.batch([open, split], { label: "Open tool", origin: "menu" }).status,
    ).toBe("committed");
    expect([commandIds, policyCalls, notifications]).toEqual([1, 1, 1]);
    expect(workspace.getSnapshot().groups.byId.tools?.panelIds).toEqual(["new"]);
    expect(workspace.getTransactions()).toHaveLength(1);
    expect(workspace.getTransactions()[0]).toMatchObject({ label: "Open tool", origin: "menu" });
    workspace.dispose();
  });

  it("replans a sole-panel float after earlier moves without floating the replacement tab", () => {
    const workspace = fixture();
    const before = workspace.getSnapshot();
    const floating = workspace.plan.floatPanel("a", bounds);
    expect(floating.command.type).toBe("create-floating-surface");
    const surfaceId =
      floating.command.type === "create-floating-surface" ? floating.command.surfaceId : undefined;
    const result = workspace.actions.batch([
      workspace.plan.movePanel("a", "target"),
      workspace.plan.movePanel("b", "source"),
      floating,
    ]);
    expect(result.status).toBe("committed");
    const snapshot = workspace.getSnapshot();
    expect(snapshot.floatingOrder).toEqual([surfaceId]);
    expect(floatingPanels(snapshot)).toEqual(["a"]);
    expect(snapshot.groups.byId.source?.panelIds).toEqual(["b"]);
    expect(snapshot.groups.byId.target?.panelIds).toEqual(["c"]);
    expect(snapshot.revision).toBe(1n);
    expect(validateWorkspace(snapshot)).toEqual([]);
    expect(workspace.actions.undo().status).toBe("committed");
    expect(workspace.getSnapshot().groups).toEqual(before.groups);
    expect(workspace.getSnapshot().nodes).toEqual(before.nodes);
    expect(workspace.getSnapshot().floatingOrder).toEqual([]);
    workspace.dispose();
  });

  it("replans a float when earlier operations turn a single-tab group into a multi-tab group", () => {
    const workspace = fixture();
    const result = workspace.actions.batch([
      workspace.plan.movePanel("b", "source"),
      workspace.plan.floatPanel("a", bounds),
    ]);
    expect(result.status).toBe("committed");
    expect(floatingPanels(workspace.getSnapshot())).toEqual(["a"]);
    expect(workspace.getSnapshot().groups.byId.source?.panelIds).toEqual(["b"]);
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    workspace.dispose();
  });

  it("rejects the entire composed transaction when a later command fails", () => {
    const workspace = fixture();
    const before = workspace.getSnapshot();
    const result = workspace.actions.batch([
      workspace.plan.movePanel("a", "target"),
      workspace.plan.openPanel({ id: "new", type: "test.panel" }, "source"),
      workspace.plan.selectPanel("missing"),
    ]);
    expect(result.status).toBe("rejected");
    expect(workspace.getSnapshot()).toBe(before);
    expect(workspace.getTransactions()).toEqual([]);
    expect(workspace.canUndo()).toBe(false);
    expect(workspace.getStructuralFailure()).toBeUndefined();
    workspace.dispose();
  });

  it("preserves every requested operation for policies even when staging fails early", () => {
    const workspace = fixture({
      policies: [
        {
          id: "repair-missing-selection",
          priority: 0,
          evaluate: (_snapshot, _envelope, command) => {
            if (
              command.type === "batch" &&
              command.commands.some(
                (item) => item.type === "select-panel" && item.panelId === "missing",
              )
            ) {
              return {
                kind: "transform",
                reason: "Select the active panel instead",
                command: {
                  ...command,
                  commands: command.commands.map((item) =>
                    item.type === "select-panel" && item.panelId === "missing"
                      ? { ...item, panelId: _snapshot.activation.activePanelId ?? item.panelId }
                      : item,
                  ),
                },
              };
            }
            return { kind: "allow", command };
          },
        },
      ],
    });
    const result = workspace.actions.batch([
      workspace.plan.selectPanel("missing"),
      workspace.plan.openPanel({ id: "new", type: "test.panel" }, "source"),
    ]);
    expect(result.status).toBe("committed");
    expect(workspace.getSnapshot().groups.byId.source?.panelIds).toEqual(["a", "new"]);
    expect(workspace.getTransactions()).toHaveLength(1);
    workspace.dispose();
  });

  it("owns plan arguments across deferred preparation, including placement and options", () => {
    const workspace = fixture();
    const panel = {
      id: "new",
      type: "test.panel",
      title: "Original",
      parameters: { text: "original" },
    };
    const target = { groupId: "target", beforePanelId: "c" };
    const options = { select: false, activate: false };
    const plan = workspace.plan.openPanel(panel, target, options);
    panel.title = "Changed";
    panel.parameters.text = "changed";
    target.groupId = "source";
    target.beforePanelId = "a";
    options.select = true;
    options.activate = true;
    expect(workspace.actions.batch([plan]).status).toBe("committed");
    const snapshot = workspace.getSnapshot();
    expect(snapshot.groups.byId.target?.panelIds).toEqual(["b", "new", "c"]);
    expect(snapshot.groups.byId.target?.selectedPanelId).toBe("b");
    expect(snapshot.activation.activePanelId).toBe("a");
    expect(snapshot.panels.byId.new).toMatchObject({
      title: "Original",
      parameters: { text: "original" },
    });
    workspace.dispose();
  });

  it("rejects mixed-revision plans even when the caller supplies the latest revision", () => {
    const workspace = fixture();
    const old = workspace.plan.movePanel("a", "target");
    workspace.actions.selectPanel("b");
    const current = workspace.plan.closePanel("c");
    const before = workspace.getSnapshot();
    const result = workspace.actions.batch([old, current], { baseRevision: before.revision });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("Expected revision conflict");
    expect(result.result.error.code).toBe("REVISION_CONFLICT");
    expect(workspace.getSnapshot()).toBe(before);
    expect(() =>
      workspace.actions.batch([old], { baseRevision: revision(before.revision + 1n) }),
    ).toThrow(/future revision/);
    expect(workspace.getSnapshot()).toBe(before);
    workspace.dispose();
  });

  it("rejects foreign and copied plans before consuming command IDs", () => {
    let commandIds = 0;
    const first = fixture({ createCommandId: () => commandId(`command:${++commandIds}`) });
    const second = fixture();
    expect(() => first.actions.batch([second.plan.selectPanel("a")])).toThrow(/this workspace/);
    const local = first.plan.selectPanel("a");
    expect(() => first.actions.batch([{ ...local }])).toThrow(/this workspace/);
    expect(commandIds).toBe(0);
    expect(first.getSnapshot().revision).toBe(0n);
    first.dispose();
    second.dispose();
  });

  it("does not rebase a queued batch after an earlier queued operation changes the workspace", () => {
    const workspace = fixture();
    let once = false;
    let receipt: RuntimeDispatchReceipt | undefined;
    workspace.subscribe(() => {
      if (once) return;
      once = true;
      const plan = workspace.plan.floatPanel("a", bounds);
      workspace.actions.movePanel("a", "target");
      receipt = workspace.actions.batch([plan]);
    });
    workspace.actions.selectPanel("b");
    expect(receipt?.status).toBe("queued");
    expect(workspace.getSnapshot().revision).toBe(2n);
    expect(workspace.getSnapshot().floatingOrder).toEqual([]);
    expect(workspace.getSnapshot().groups.byId.target?.panelIds).toEqual(["b", "c", "a"]);
    expect(workspace.getSubscriberErrors()).toEqual([]);
    workspace.dispose();
  });

  it("queues a fresh dependent batch atomically and owns the caller's plans array", () => {
    const workspace = fixture();
    let once = false;
    let receipt: RuntimeDispatchReceipt | undefined;
    workspace.subscribe(() => {
      if (once) return;
      once = true;
      const plans: WorkspaceActionPlan[] = [
        workspace.plan.openPanel({ id: "new", type: "test.panel" }, "source"),
        workspace.plan.splitPanel("new", "block-end", { newGroupId: "tools" }),
        workspace.plan.floatPanel("new", bounds),
      ];
      receipt = workspace.actions.batch(plans);
      plans.push(workspace.plan.closePanel("a"));
    });
    workspace.actions.selectPanel("b");
    expect(receipt?.status).toBe("queued");
    const snapshot = workspace.getSnapshot();
    expect(snapshot.revision).toBe(2n);
    expect(floatingPanels(snapshot)).toEqual(["new"]);
    expect(snapshot.groups.byId.source?.panelIds).toEqual(["a"]);
    expect(snapshot.groups.byId.tools?.panelIds).toEqual(["new"]);
    expect(workspace.getTransactions()).toHaveLength(2);
    expect(workspace.getSubscriberErrors()).toEqual([]);
    expect(validateWorkspace(snapshot)).toEqual([]);
    workspace.dispose();
  });

  it("uses explicit canonical recovery-ID ties for uncanonicalized staging snapshots", () => {
    const workspace = fixture();
    for (let index = 0; index < 8; index += 1) workspace.plan.closePanel("a");
    const close = workspace.plan.closePanels(["a", "b"]);
    expect(close.command.type).toBe("close-panels");
    if (close.command.type !== "close-panels") throw new Error("Expected close command");
    expect(close.command.targets.map((target) => target.closedPanelId)).toEqual([
      "panefold:action:closed:9",
      "panefold:action:closed:10",
    ]);
    expect(workspace.actions.batch([close, workspace.plan.reopenLastPanel()]).status).toBe(
      "committed",
    );
    expect(workspace.getSnapshot().panels.byId.a).toBeDefined();
    expect(workspace.getSnapshot().panels.byId.b).toBeUndefined();
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    workspace.dispose();
  });

  it("bounds batch input before dispatching", () => {
    const workspace = fixture();
    const plan = workspace.plan.selectPanel("a");
    expect(() => workspace.actions.batch(Array.from({ length: 1_001 }, () => plan))).toThrow(
      /1,000/,
    );
    expect(workspace.getTransactions()).toEqual([]);
    workspace.dispose();
  });
});
