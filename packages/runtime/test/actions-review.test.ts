import { describe, expect, it } from "vitest";
import { groupId, panelId, revision, type WorkspaceLayoutNode } from "@panefold/model";
import { validateWorkspace } from "@panefold/kernel";
import { createWorkspaceActions } from "../src/actions";
import { createWorkspace } from "../src/workspace";
import type { RuntimeDispatchReceipt } from "../src/runtime";

const bounds = { x: 20, y: 30, width: 400, height: 300 };

function fixture() {
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
  });
}

describe("workspace actions independent review", () => {
  it("does not float a replacement tab after a queued source-group change", () => {
    const workspace = fixture();
    let once = false;
    let receipt: RuntimeDispatchReceipt | undefined;
    workspace.subscribe(() => {
      if (once) return;
      once = true;
      workspace.dispatch({
        type: "batch",
        commands: [
          { type: "move-panel", panelId: panelId("a"), target: { groupId: groupId("target") } },
          { type: "move-panel", panelId: panelId("b"), target: { groupId: groupId("source") } },
        ],
      });
      receipt = workspace.actions.floatPanel("a", bounds);
    });
    workspace.actions.selectPanel("b");
    expect(receipt?.status).toBe("queued");
    expect(workspace.getSnapshot().floatingOrder).toEqual([]);
    expect(workspace.getSnapshot().groups.byId.source?.panelIds).toEqual(["b"]);
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    workspace.dispose();
  });

  it("does not reinterpret an explicit future revision as intent to float an unrelated tab", () => {
    const workspace = fixture();
    let once = false;
    let futureError: unknown;
    workspace.subscribe(() => {
      if (once) return;
      once = true;
      const futureRevision = revision(workspace.getSnapshot().revision + 1n);
      workspace.dispatch({
        type: "batch",
        commands: [
          { type: "move-panel", panelId: panelId("a"), target: { groupId: groupId("target") } },
          { type: "move-panel", panelId: panelId("b"), target: { groupId: groupId("source") } },
        ],
      });
      try {
        workspace.actions.floatPanel("a", bounds, { baseRevision: futureRevision });
      } catch (error) {
        futureError = error;
      }
    });
    workspace.actions.selectPanel("b");
    expect(futureError).toBeInstanceOf(RangeError);
    expect((futureError as Error).message).toMatch(/future revision/);
    expect(workspace.getSnapshot().floatingOrder).toEqual([]);
    expect(workspace.getSnapshot().groups.byId.source?.panelIds).toEqual(["b"]);
    expect(workspace.getSnapshot().revision).toBe(2n);
    expect(workspace.getSubscriberErrors()).toEqual([]);
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    workspace.dispose();
  });

  it("keeps independently created action facades collision-free during reentrant closes", () => {
    const workspace = fixture();
    const second = createWorkspaceActions(workspace);
    let once = false;
    const receipts: RuntimeDispatchReceipt[] = [];
    workspace.subscribe(() => {
      if (once) return;
      once = true;
      receipts.push(workspace.actions.closePanel("b"));
      receipts.push(second.closePanel("c"));
    });
    workspace.actions.selectPanel("a");
    expect(receipts.map((receipt) => receipt.status)).toEqual(["queued", "queued"]);
    const snapshot = workspace.getSnapshot();
    expect(snapshot.panels.ids).toEqual(["a"]);
    expect(new Set(snapshot.recoverableClosedPanels.map((record) => record.id)).size).toBe(2);
    expect(validateWorkspace(snapshot)).toEqual([]);
    workspace.dispose();
  });

  it("freezes queued floating bounds before a caller mutates the source object", () => {
    const workspace = fixture();
    let once = false;
    const mutableBounds = { ...bounds };
    workspace.subscribe(() => {
      if (once) return;
      once = true;
      workspace.actions.floatPanel("a", mutableBounds);
      mutableBounds.width = -1;
      mutableBounds.x = 999;
    });
    workspace.actions.selectPanel("b");
    const snapshot = workspace.getSnapshot();
    expect(snapshot.floatingOrder).toHaveLength(1);
    const floatingId = snapshot.floatingOrder[0];
    expect(
      floatingId === undefined ? undefined : snapshot.surfaces.byId[floatingId]?.bounds,
    ).toEqual(bounds);
    expect(validateWorkspace(snapshot)).toEqual([]);
    workspace.dispose();
  });

  it("breaks reopen ties canonically and rejects unsorted restored recovery records", () => {
    const original = fixture();
    original.actions.closePanels(["b", "c"]);
    const snapshot = original.getSnapshot();
    original.dispose();
    expect(() =>
      createWorkspace({
        initialSnapshot: {
          ...snapshot,
          recoverableClosedPanels: [...snapshot.recoverableClosedPanels].reverse(),
        },
      }),
    ).toThrow(/NON_CANONICAL_CLOSED_PANEL_ORDER/);
    const restored = createWorkspace({ initialSnapshot: snapshot });
    expect(validateWorkspace(restored.getSnapshot())).toEqual([]);
    expect(restored.actions.reopenLastPanel().status).toBe("committed");
    expect(restored.getSnapshot().panels.byId.c).toBeDefined();
    expect(restored.getSnapshot().panels.byId.b).toBeUndefined();
    restored.dispose();
  });

  it("preserves ordinary receipts for equal and older state-derived revision guards", () => {
    const workspace = fixture();
    const capturedRevision = workspace.getSnapshot().revision;
    expect(
      workspace.actions.floatPanel("a", bounds, { baseRevision: capturedRevision }).status,
    ).toBe("committed");
    workspace.actions.undo();
    const before = workspace.getSnapshot();
    const stale = workspace.actions.floatPanel("a", bounds, { baseRevision: capturedRevision });
    expect(stale.status).toBe("rejected");
    if (stale.status !== "rejected") throw new Error("Expected stale rejection");
    expect(stale.result.error.code).toBe("REVISION_CONFLICT");
    expect(workspace.getSnapshot()).toBe(before);
    workspace.dispose();
  });

  it("keeps authored same-axis nesting valid through canonicalization, floating and undo", () => {
    const workspace = createWorkspace({
      panels: ["a", "b", "c"].map((id) => ({ id, type: "test.panel" })),
      layout: {
        id: "root",
        axis: "inline",
        weights: [1, 2],
        children: [
          { id: "a", panels: ["a"] },
          {
            id: "nested",
            axis: "inline",
            children: [
              { id: "b", panels: ["b"] },
              { id: "c", panels: ["c"] },
            ],
          },
        ],
      },
    });
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    expect(workspace.actions.selectPanel("c").status).toBe("committed");
    expect(workspace.getSnapshot().nodes.byId.nested).toBeUndefined();
    expect(workspace.getSnapshot().groups.ids).toEqual(["a", "b", "c"]);
    expect(workspace.actions.floatPanel("b", bounds).status).toBe("committed");
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    expect(workspace.actions.undo().status).toBe("committed");
    expect(workspace.getSnapshot().floatingOrder).toEqual([]);
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    workspace.dispose();
  });

  it("supports the maximum authored tree depth through real runtime validation and updates", () => {
    let layout: WorkspaceLayoutNode = { id: "leaf", panels: ["leaf"] };
    for (let index = 0; index < 128; index += 1) {
      layout = {
        axis: index % 2 === 0 ? "inline" : "block",
        children: [{ id: `empty:${index}`, panels: [] }, layout],
      };
    }
    const workspace = createWorkspace({ panels: [{ id: "leaf", type: "test.panel" }], layout });
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    expect(workspace.actions.selectPanel("leaf").status).toBe("committed");
    expect(workspace.actions.floatPanel("leaf", bounds).status).toBe("committed");
    expect(validateWorkspace(workspace.getSnapshot())).toEqual([]);
    expect(workspace.getStructuralFailure()).toBeUndefined();
    workspace.dispose();
  });
});
