import { describe, expect, it } from "vitest";
import { validateWorkspace } from "@panefold/kernel";
import {
  INITIAL_REVISION,
  commandId,
  createWorkspaceLayout,
  type WorkspaceLayoutInput,
} from "@panefold/model";

import {
  createWorkspace,
  createWorkspaceActions,
  type RuntimeDispatchReceipt,
  type Workspace,
  type WorkspaceOptions,
  type WorkspacePolicy,
} from "../src";

const layout: WorkspaceLayoutInput = {
  panels: ["a", "b", "c", "d"].map((id) => ({ id, type: "test", title: id })),
  layout: {
    id: "root",
    axis: "inline",
    weights: [3, 1],
    children: [
      { id: "left", panels: ["a", "b", "c"] },
      { id: "right", panels: ["d"] },
    ],
  },
};

function workspace(options: { readonly policies?: readonly WorkspacePolicy[] } = {}): Workspace {
  let sequence = 0;
  return createWorkspace({
    ...layout,
    ...options,
    createCommandId: () => commandId(`test:${String(++sequence)}`),
  });
}

function rejection(receipt: RuntimeDispatchReceipt, code: string): void {
  expect(receipt.status).toBe("rejected");
  if (receipt.status === "rejected") expect(receipt.result.error.code).toBe(code);
}

describe("workspace application API", () => {
  it("creates a real runtime from a compact layout and exposes bound, undoable actions", () => {
    const runtime = workspace();
    const { selectPanel, undo, redo } = runtime.actions;
    expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
    expect(runtime.getSnapshot().activation.activePanelId).toBe("a");
    expect(selectPanel("b").status).toBe("committed");
    expect(runtime.getSnapshot().activation.activePanelId).toBe("b");
    expect(undo().status).toBe("committed");
    expect(runtime.getSnapshot().activation.activePanelId).toBe("a");
    expect(redo().status).toBe("committed");
    expect(runtime.getSnapshot().activation.activePanelId).toBe("b");
    runtime.dispose();
    runtime.dispose();
    expect(() => selectPanel("a")).toThrow("disposed");
  });

  it("accepts an existing snapshot and forwards bounded history and policy options", () => {
    const initialSnapshot = createWorkspaceLayout(layout);
    const runtime = createWorkspace({ initialSnapshot, historyLimit: 0, transactionLimit: 1 });
    runtime.actions.selectPanel("b");
    runtime.actions.selectPanel("c");
    expect(runtime.canUndo()).toBe(false);
    expect(runtime.getTransactions()).toHaveLength(1);
    expect(initialSnapshot.activation.activePanelId).toBe("a");
    expect(() =>
      createWorkspace({ ...layout, initialSnapshot } as unknown as WorkspaceOptions),
    ).toThrow("not both");
    runtime.dispose();
  });

  it("opens panels with defaults and relational placement without retaining caller-owned data", () => {
    const runtime = workspace();
    const parameters = { document: { text: "original" } };
    const result = runtime.actions.openPanel(
      { id: "e", type: "editor", parameters, capabilities: { floatable: false } },
      { groupId: "left", beforePanelId: "b" },
      { origin: "menu", label: "Open editor" },
    );
    expect(result.status).toBe("committed");
    parameters.document.text = "changed";
    const snapshot = runtime.getSnapshot();
    expect(snapshot.groups.byId["left"]?.panelIds).toEqual(["a", "e", "b", "c"]);
    expect(snapshot.panels.byId["e"]?.parameters).toEqual({ document: { text: "original" } });
    expect(snapshot.panels.byId["e"]?.capabilities).toMatchObject({
      closable: true,
      floatable: false,
      popout: false,
    });
    expect(snapshot.activation.activePanelId).toBe("e");
    expect(runtime.getTransactions()[0]).toMatchObject({ origin: "menu", label: "Open editor" });
    runtime.dispose();
  });

  it("moves tabs with anchors, preserves records and exposes the existing focus policy", () => {
    const runtime = workspace();
    const panel = runtime.getSnapshot().panels.byId["b"];
    expect(runtime.actions.movePanel("b", { groupId: "right", beforePanelId: "d" }).status).toBe(
      "committed",
    );
    expect(runtime.getSnapshot().groups.byId["right"]?.panelIds).toEqual(["b", "d"]);
    expect(runtime.getSnapshot().panels.byId["b"]).toBe(panel);
    expect(runtime.actions.activatePanel("d", { focus: "focus-panel-root" }).status).toBe(
      "committed",
    );
    expect(runtime.getTransactions().at(-1)?.command).toMatchObject({
      type: "activate-panel",
      focus: "focus-panel-root",
    });
    runtime.dispose();
  });

  it("returns ordinary typed rejections without changing state or history", () => {
    const runtime = workspace();
    const before = runtime.getSnapshot();
    rejection(runtime.actions.selectPanel("missing"), "ENTITY_NOT_FOUND");
    rejection(runtime.actions.movePanel("b", "missing"), "ENTITY_NOT_FOUND");
    rejection(runtime.actions.reopenLastPanel(), "ENTITY_NOT_FOUND");
    expect(runtime.getSnapshot()).toBe(before);
    expect(runtime.getTransactions()).toHaveLength(0);
    expect(runtime.canUndo()).toBe(false);
    runtime.dispose();
  });

  it("closes and reopens the latest closed revision at an optional destination", () => {
    const runtime = workspace();
    runtime.actions.closePanel("a");
    runtime.actions.closePanel("b");
    const firstClosedId = runtime
      .getSnapshot()
      .recoverableClosedPanels.find((record) => record.panel.id === "a")?.id;
    expect(runtime.actions.reopenLastPanel({ placement: "right" }).status).toBe("committed");
    expect(runtime.getSnapshot().groups.byId["right"]?.panelIds).toEqual(["d", "b"]);
    expect(runtime.getSnapshot().activation.activePanelId).toBe("b");
    expect(firstClosedId).toBeDefined();
    expect(runtime.actions.reopenPanel(String(firstClosedId)).status).toBe("committed");
    expect(runtime.getSnapshot().groups.byId["left"]?.panelIds).toContain("a");
    expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
    runtime.dispose();
  });

  it("close-other and close-to-right preserve panels that cannot be closed", () => {
    const runtime = createWorkspace({
      ...layout,
      panels: layout.panels.map((panel) =>
        panel.id === "b" ? { ...panel, capabilities: { closable: false } } : panel,
      ),
    });
    expect(runtime.actions.closePanelsToRight("a").status).toBe("committed");
    expect(runtime.getSnapshot().groups.byId["left"]?.panelIds).toEqual(["a", "b"]);
    runtime.actions.undo();
    expect(runtime.actions.closeOtherPanels("c").status).toBe("committed");
    expect(runtime.getSnapshot().groups.byId["left"]?.panelIds).toEqual(["b", "c"]);
    runtime.actions.undo();
    const before = runtime.getSnapshot();
    rejection(runtime.actions.closePanels(["a", "b"]), "CAPABILITY_DENIED");
    expect(runtime.getSnapshot()).toBe(before);
    runtime.dispose();
  });

  it("splits a tab into a named group in one transaction and undoes it", () => {
    const runtime = workspace();
    expect(
      runtime.actions.splitPanel("b", "block-end", {
        newGroupId: "bottom",
        ratio: 0.25,
        region: "tools",
      }).status,
    ).toBe("committed");
    const snapshot = runtime.getSnapshot();
    expect(snapshot.groups.byId["bottom"]).toMatchObject({ panelIds: ["b"], region: "tools" });
    expect(snapshot.groups.byId["left"]?.panelIds).toEqual(["a", "c"]);
    expect(snapshot.activation.activePanelId).toBe("b");
    expect(runtime.getTransactions()).toHaveLength(1);
    expect(validateWorkspace(snapshot)).toEqual([]);
    runtime.actions.undo();
    expect(runtime.getSnapshot().groups.byId["bottom"]).toBeUndefined();
    expect(runtime.getSnapshot().groups.byId["left"]?.panelIds).toEqual(["a", "b", "c"]);
    const before = runtime.getSnapshot();
    rejection(runtime.actions.splitPanel("d", "inline-end"), "INVALID_COMMAND");
    expect(runtime.getSnapshot()).toBe(before);
    runtime.dispose();
  });

  it("floats one tab atomically and redocks it without moving its siblings", () => {
    const runtime = workspace();
    const bounds = { x: 10, y: 20, width: 400, height: 300 };
    expect(runtime.actions.floatPanel("b", bounds).status).toBe("committed");
    expect(runtime.getTransactions()).toHaveLength(1);
    const floatingId = runtime.getSnapshot().floatingOrder[0];
    expect(floatingId).toBeDefined();
    expect(runtime.getSnapshot().groups.byId["left"]?.panelIds).toEqual(["a", "c"]);
    bounds.width = 800;
    expect(runtime.getSnapshot().surfaces.byId[String(floatingId)]?.bounds?.width).toBe(400);
    expect(
      runtime.actions.redockSurface(String(floatingId), { groupId: "left", beforePanelId: "c" })
        .status,
    ).toBe("committed");
    expect(runtime.getSnapshot().groups.byId["left"]?.panelIds).toEqual(["a", "b", "c"]);
    expect(runtime.getSnapshot().floatingOrder).toEqual([]);
    expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
    runtime.dispose();
  });

  it("rejects failed compound floats without publishing a partial split", () => {
    const runtime = workspace();
    const before = runtime.getSnapshot();
    expect(runtime.actions.floatPanel("b", { x: 0, y: 0, width: -1, height: 100 }).status).toBe(
      "rejected",
    );
    rejection(
      runtime.actions.floatPanel("missing", { x: 0, y: 0, width: 100, height: 100 }),
      "ENTITY_NOT_FOUND",
    );
    expect(runtime.getSnapshot()).toBe(before);
    expect(runtime.getTransactions()).toHaveLength(0);
    expect(runtime.getStructuralFailure()).toBeUndefined();
    runtime.dispose();
  });

  it("keeps permission policies authoritative for conveniences", () => {
    const runtime = workspace({
      policies: [
        {
          id: "locked-layout",
          priority: 1,
          evaluate: (_snapshot, _envelope, command) =>
            command.type === "select-panel"
              ? { kind: "allow", command }
              : { kind: "deny", code: "LOCKED", reason: "Layout is locked" },
        },
      ],
    });
    const before = runtime.getSnapshot();
    rejection(runtime.actions.closePanel("b"), "CAPABILITY_DENIED");
    rejection(runtime.actions.splitPanel("b", "block-end"), "CAPABILITY_DENIED");
    rejection(
      runtime.actions.floatPanel("b", { x: 0, y: 0, width: 100, height: 100 }),
      "CAPABILITY_DENIED",
    );
    expect(runtime.getSnapshot()).toBe(before);
    expect(runtime.actions.selectPanel("b").status).toBe("committed");
    runtime.dispose();
  });

  it("allocates unique recovery IDs across independently bound actions and queued calls", () => {
    const runtime = workspace();
    const other = createWorkspaceActions(runtime);
    const queued: RuntimeDispatchReceipt[] = [];
    runtime.subscribe(() => {
      if (runtime.getSnapshot().revision !== 1n) return;
      queued.push(runtime.actions.closePanel("b"), other.closePanel("c"));
    });
    runtime.actions.selectPanel("a");
    expect(queued.map((receipt) => receipt.status)).toEqual(["queued", "queued"]);
    expect(runtime.getSnapshot().revision).toBe(3n);
    expect(runtime.getSnapshot().recoverableClosedPanels.map((record) => record.panel.id)).toEqual([
      "b",
      "c",
    ]);
    expect(
      new Set(runtime.getSnapshot().recoverableClosedPanels.map((record) => record.id)).size,
    ).toBe(2);
    expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
    runtime.dispose();
  });

  it("skips generated identities already present in restored snapshots", () => {
    const original = workspace();
    original.actions.closePanel("a");
    const initialSnapshot = original.getSnapshot();
    original.dispose();
    const restored = createWorkspace({ initialSnapshot });
    expect(restored.actions.closePanel("b").status).toBe("committed");
    expect(
      new Set(restored.getSnapshot().recoverableClosedPanels.map((record) => record.id)).size,
    ).toBe(2);
    expect(validateWorkspace(restored.getSnapshot())).toEqual([]);
    restored.dispose();
  });

  it("skips authored group and node identity collisions", () => {
    const runtime = createWorkspace({
      panels: layout.panels,
      layout: {
        id: "panefold:action:group:1",
        nodeId: "panefold:action:node:3",
        panels: ["a", "b", "c", "d"],
      },
    });
    expect(runtime.actions.splitPanel("b", "inline-end").status).toBe("committed");
    expect(runtime.getSnapshot().groups.ids).toHaveLength(2);
    expect(validateWorkspace(runtime.getSnapshot())).toEqual([]);
    runtime.dispose();
  });

  it("does not reinterpret a state-derived split after an earlier queued command changes revision", () => {
    const runtime = workspace();
    const queued: RuntimeDispatchReceipt[] = [];
    runtime.subscribe(() => {
      if (runtime.getSnapshot().revision !== 1n) return;
      queued.push(
        runtime.actions.movePanel("b", "right"),
        runtime.actions.splitPanel("b", "block-end", { newGroupId: "stale" }),
      );
    });
    runtime.actions.selectPanel("a");
    expect(queued.map((receipt) => receipt.status)).toEqual(["queued", "queued"]);
    expect(runtime.getSnapshot().groups.byId["right"]?.panelIds).toEqual(["d", "b"]);
    expect(runtime.getSnapshot().groups.byId["stale"]).toBeUndefined();
    expect(runtime.getSnapshot().revision).toBe(2n);
    rejection(
      runtime.actions.splitPanel("b", "inline-end", {
        baseRevision: INITIAL_REVISION,
      }),
      "REVISION_CONFLICT",
    );
    expect(runtime.getStructuralFailure()).toBeUndefined();
    runtime.dispose();
  });

  it("owns queued argument data and preserves caller-specified dispatch metadata", () => {
    const runtime = workspace();
    const weights = [1, 3];
    let queued: RuntimeDispatchReceipt | undefined;
    runtime.subscribe(() => {
      if (runtime.getSnapshot().revision !== 1n) return;
      queued = runtime.actions.resizeSplit("root", weights, {
        label: "Resize from toolbar",
        origin: "menu",
      });
      weights[0] = 99;
    });
    runtime.actions.selectPanel("a");
    expect(queued?.status).toBe("queued");
    expect(runtime.getSnapshot().nodes.byId["root"]).toMatchObject({ weights: [250_000, 750_000] });
    expect(runtime.getTransactions().at(-1)).toMatchObject({
      label: "Resize from toolbar",
      origin: "menu",
    });
    expect(runtime.actions.equalizeSplit("root").status).toBe("committed");
    expect(runtime.getSnapshot().nodes.byId["root"]).toMatchObject({ weights: [500_000, 500_000] });
    runtime.dispose();
  });
});
