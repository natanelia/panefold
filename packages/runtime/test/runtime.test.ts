import {
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  commandId,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it, vi } from "vitest";

import { createWorkspaceRuntime, InvalidInitialWorkspaceError } from "../src";

const firstPanelId = panelId("panel:first");
const secondPanelId = panelId("panel:second");
const testGroupId = groupId("group:main");

function panel(id: PanelRecord["id"]): PanelRecord {
  return {
    id,
    type: "test.panel",
    typeVersion: 1,
    parameters: {},
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: {},
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

function fixture() {
  const group: GroupRecord = {
    id: testGroupId,
    panelIds: [firstPanelId, secondPanelId],
    selectedPanelId: firstPanelId,
    persistent: true,
  };
  const rootNodeId = nodeId("node:main");
  const node: LayoutNode = {
    kind: "group",
    id: rootNodeId,
    groupId: group.id,
  };
  const surface: SurfaceRecord = {
    id: surfaceId("surface:main"),
    kind: "main",
    rootNodeId,
    capabilities: MAIN_SURFACE_CAPABILITIES,
    maximized: false,
  };
  return createWorkspaceSnapshot({
    panels: [panel(firstPanelId), panel(secondPanelId)],
    groups: [group],
    nodes: [node],
    surfaces: [surface],
    activation: {
      activePanelId: firstPanelId,
      activeSurfaceId: surface.id,
    },
    focusMemory: {
      panelId: firstPanelId,
      groupId: group.id,
      fallback: "selected-tab",
    },
  });
}

function deterministicIds() {
  let next = 0;
  return () => commandId(`command:${String(++next)}`);
}

describe("workspace runtime", () => {
  it("publishes one immutable snapshot and transaction per accepted command", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
    });
    const snapshotListener = vi.fn();
    const transactionListener = vi.fn();
    runtime.subscribe(snapshotListener);
    runtime.subscribeTransactions(transactionListener);

    const receipt = runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { origin: "keyboard", label: "Select second panel" },
    );

    expect(receipt.status).toBe("committed");
    expect(runtime.getSnapshot().revision).toBe(1n);
    expect(runtime.getSnapshot().groups.byId[testGroupId]?.selectedPanelId).toBe(secondPanelId);
    expect(snapshotListener).toHaveBeenCalledTimes(1);
    expect(transactionListener).toHaveBeenCalledTimes(1);
    expect(runtime.getTransactions()).toHaveLength(1);
  });

  it("queues reentrant commands until all listeners finish", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
    });
    const revisions: bigint[] = [];
    let queuedStatus: string | undefined;
    runtime.subscribe(() => {
      revisions.push(runtime.getSnapshot().revision);
      if (runtime.getSnapshot().revision === 1n) {
        queuedStatus = runtime.dispatch(
          { type: "select-panel", panelId: firstPanelId },
          { label: "Select first panel again" },
        ).status;
      }
    });

    runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Select second panel" },
    );

    expect(queuedStatus).toBe("queued");
    expect(revisions).toEqual([1n, 2n]);
    expect(runtime.getSnapshot().groups.byId[testGroupId]?.selectedPanelId).toBe(firstPanelId);
  });

  it("drains thousands of reentrant commands iteratively without stack growth", () => {
    const finalRevision = 2_501n;
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
      queueLimit: 4,
      queueDrainLimit: Number(finalRevision),
      transactionLimit: 0,
    });
    let queued = 0;
    runtime.subscribe(() => {
      const revision = runtime.getSnapshot().revision;
      if (revision >= finalRevision) return;
      const target = revision % 2n === 0n ? secondPanelId : firstPanelId;
      const receipt = runtime.dispatch(
        { type: "select-panel", panelId: target },
        { label: `Select at revision ${String(revision)}` },
      );
      if (receipt.status === "queued") queued += 1;
    });

    const receipt = runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Start iterative drain" },
    );

    expect(receipt.status).toBe("committed");
    expect(runtime.getSnapshot().revision).toBe(finalRevision);
    expect(queued).toBe(Number(finalRevision - 1n));
    expect(runtime.getTransactions()).toEqual([]);
  });

  it("returns a typed rejection when the waiting queue reaches capacity", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
      queueLimit: 2,
      queueDrainLimit: 10,
    });
    const reentrant: ReturnType<typeof runtime.dispatch>[] = [];
    runtime.subscribe(() => {
      if (runtime.getSnapshot().revision !== 1n) return;
      reentrant.push(
        runtime.dispatch({ type: "select-panel", panelId: firstPanelId }, { label: "Queued one" }),
        runtime.dispatch({ type: "select-panel", panelId: secondPanelId }, { label: "Queued two" }),
        runtime.dispatch(
          { type: "select-panel", panelId: firstPanelId },
          { label: "Rejected three" },
        ),
      );
    });

    runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Start bounded queue" },
    );

    expect(reentrant.map((receipt) => receipt.status)).toEqual(["queued", "queued", "rejected"]);
    const rejected = reentrant[2];
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.runtimeCode).toBe("QUEUE_CAPACITY_EXCEEDED");
      expect(rejected.result.error).toMatchObject({
        code: "INVALID_COMMAND",
        revision: 1n,
        details: { runtimeCode: "QUEUE_CAPACITY_EXCEEDED", limit: 2 },
      });
    }
    expect(runtime.getSnapshot().revision).toBe(3n);
  });

  it("stops an endless subscriber chain at the per-drain budget", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
      queueLimit: 1,
      queueDrainLimit: 50,
    });
    let overflow: ReturnType<typeof runtime.dispatch> | undefined;
    runtime.subscribe(() => {
      const revision = runtime.getSnapshot().revision;
      const target = revision % 2n === 0n ? secondPanelId : firstPanelId;
      const receipt = runtime.dispatch(
        { type: "select-panel", panelId: target },
        { label: "Continue hostile chain" },
      );
      if (receipt.status === "rejected") overflow = receipt;
    });

    runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Start hostile chain" },
    );

    expect(runtime.getSnapshot().revision).toBe(51n);
    expect(overflow?.status).toBe("rejected");
    if (overflow?.status === "rejected") {
      expect(overflow.runtimeCode).toBe("QUEUE_DRAIN_BUDGET_EXCEEDED");
      expect(overflow.result.error.details).toEqual({
        runtimeCode: "QUEUE_DRAIN_BUDGET_EXCEEDED",
        limit: 50,
      });
    }
  });

  it("validates every retained-history and queue limit", () => {
    const names = [
      "historyLimit",
      "transactionLimit",
      "notificationErrorLimit",
      "queueLimit",
      "queueDrainLimit",
    ] as const;
    const invalidValues = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];

    for (const name of names) {
      for (const value of invalidValues) {
        expect(() =>
          createWorkspaceRuntime({
            initialSnapshot: fixture(),
            createCommandId: deterministicIds(),
            [name]: value,
          }),
        ).toThrow(RangeError);
      }
    }
  });

  it("stops notification and clears queued work when disposed during a drain", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
      queueLimit: 2,
      queueDrainLimit: 10,
    });
    const events: string[] = [];
    runtime.subscribe(() => {
      const revision = runtime.getSnapshot().revision;
      events.push(`first:${String(revision)}`);
      if (revision === 1n) {
        runtime.dispatch(
          { type: "select-panel", panelId: firstPanelId },
          { label: "Queued before disposal" },
        );
        runtime.dispatch(
          { type: "select-panel", panelId: secondPanelId },
          { label: "Cleared by disposal" },
        );
      } else if (revision === 2n) {
        runtime.dispose();
      }
    });
    runtime.subscribe(() => {
      events.push(`later:${String(runtime.getSnapshot().revision)}`);
    });

    const receipt = runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Start disposal fixture" },
    );

    expect(receipt.status).toBe("committed");
    expect(runtime.getSnapshot().revision).toBe(2n);
    expect(events).toEqual(["first:1", "later:1", "first:2"]);
    expect(() =>
      runtime.dispatch(
        { type: "select-panel", panelId: secondPanelId },
        { label: "Dispatch after disposal" },
      ),
    ).toThrow("disposed");
  });

  it("applies listener mutations only to later transactions", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
    });
    const events: string[] = [];
    let unsubscribeSecond = () => {};
    runtime.subscribe(() => {
      const revision = runtime.getSnapshot().revision;
      events.push(`first:${String(revision)}`);
      if (revision === 1n) {
        unsubscribeSecond();
        runtime.subscribe(() => {
          events.push(`added:${String(runtime.getSnapshot().revision)}`);
        });
      }
    });
    unsubscribeSecond = runtime.subscribe(() => {
      events.push(`second:${String(runtime.getSnapshot().revision)}`);
    });

    runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "First notification" },
    );
    runtime.dispatch(
      { type: "select-panel", panelId: firstPanelId },
      { label: "Second notification" },
    );

    expect(events).toEqual(["first:1", "second:1", "first:2", "added:2"]);
  });

  it("isolates subscriber failures, notifies later observers, and drains reentrant commands", () => {
    const reported = vi.fn(() => {
      throw new Error("A reporting hook must also be isolated");
    });
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
      onSubscriberError: reported,
    });
    const events: string[] = [];
    let queuedStatus: string | undefined;

    runtime.subscribe(() => {
      const revision = runtime.getSnapshot().revision;
      events.push(`snapshot-failing:${String(revision)}`);
      if (revision === 1n) {
        queuedStatus = runtime.dispatch(
          { type: "select-panel", panelId: firstPanelId },
          { label: "Reentrant selection" },
        ).status;
        throw new Error("snapshot subscriber failed");
      }
    });
    runtime.subscribe(() => {
      events.push(`snapshot-later:${String(runtime.getSnapshot().revision)}`);
    });
    runtime.subscribeTransactions((transaction) => {
      events.push(`transaction-failing:${String(transaction.revision)}`);
      if (transaction.revision === 1n) {
        throw new Error("transaction subscriber failed");
      }
    });
    runtime.subscribeTransactions((transaction) => {
      events.push(`transaction-later:${String(transaction.revision)}`);
    });

    const receipt = runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Initial selection" },
    );

    expect(receipt.status).toBe("committed");
    expect(queuedStatus).toBe("queued");
    expect(events).toEqual([
      "snapshot-failing:1",
      "snapshot-later:1",
      "transaction-failing:1",
      "transaction-later:1",
      "snapshot-failing:2",
      "snapshot-later:2",
      "transaction-failing:2",
      "transaction-later:2",
    ]);
    expect(runtime.getSnapshot().revision).toBe(2n);
    expect(runtime.getSnapshot().groups.byId[testGroupId]?.selectedPanelId).toBe(firstPanelId);
    expect(runtime.getTransactions()).toHaveLength(2);
    expect(reported).toHaveBeenCalledTimes(2);
    expect(runtime.getSubscriberErrors()).toMatchObject([
      { channel: "snapshot", listenerIndex: 0, revision: 1n },
      { channel: "transaction", listenerIndex: 0, revision: 1n },
    ]);
  });

  it("bounds retained subscriber failures without suppressing reporting", () => {
    const reported = vi.fn();
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
      notificationErrorLimit: 1,
      onSubscriberError: reported,
    });
    runtime.subscribe(() => {
      throw new Error(`failure at ${String(runtime.getSnapshot().revision)}`);
    });

    runtime.dispatch({ type: "select-panel", panelId: secondPanelId }, { label: "Select second" });
    runtime.dispatch({ type: "select-panel", panelId: firstPanelId }, { label: "Select first" });

    expect(reported).toHaveBeenCalledTimes(2);
    expect(runtime.getSubscriberErrors()).toHaveLength(1);
    expect(runtime.getSubscriberErrors()[0]?.revision).toBe(2n);
  });

  it("notifies selectors only when their selected value changes", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: deterministicIds(),
    });
    const listener = vi.fn();
    runtime.subscribeSelector(
      (snapshot) => snapshot.groups.byId[testGroupId]?.selectedPanelId,
      listener,
    );

    runtime.dispatch(
      {
        type: "activate-panel",
        panelId: firstPanelId,
        focus: "focus-panel-root",
      },
      { label: "Activate first panel" },
    );
    runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Select second panel" },
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(secondPanelId);
  });

  it("keeps rejected commands atomic and supports bounded undo and redo", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      historyLimit: 1,
      createCommandId: deterministicIds(),
    });
    const invalid = runtime.dispatch(
      { type: "select-panel", panelId: panelId("panel:missing") },
      { label: "Select a missing panel" },
    );
    expect(invalid.status).toBe("rejected");
    expect(runtime.getSnapshot().revision).toBe(0n);

    runtime.dispatch(
      { type: "select-panel", panelId: secondPanelId },
      { label: "Select second panel" },
    );
    expect(runtime.canUndo()).toBe(true);
    expect(runtime.undo().status).toBe("committed");
    expect(runtime.canRedo()).toBe(true);
    expect(runtime.getSnapshot().groups.byId[testGroupId]?.selectedPanelId).toBe(firstPanelId);
    expect(runtime.redo().status).toBe("committed");
    expect(runtime.getSnapshot().groups.byId[testGroupId]?.selectedPanelId).toBe(secondPanelId);
  });

  it("rejects an invalid initial snapshot instead of silently canonicalizing it", () => {
    const valid = fixture();
    const group = valid.groups.byId[testGroupId];
    if (group === undefined) throw new Error("Fixture group is missing");
    const invalid = {
      ...valid,
      groups: {
        ...valid.groups,
        byId: {
          ...valid.groups.byId,
          [testGroupId]: {
            ...group,
            selectedPanelId: panelId("panel:not-in-group"),
          },
        },
      },
    } satisfies WorkspaceSnapshot;

    expect(() =>
      createWorkspaceRuntime({
        initialSnapshot: invalid,
        createCommandId: deterministicIds(),
      }),
    ).toThrow(InvalidInitialWorkspaceError);

    try {
      createWorkspaceRuntime({
        initialSnapshot: invalid,
        createCommandId: deterministicIds(),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInitialWorkspaceError);
      if (error instanceof InvalidInitialWorkspaceError) {
        expect(error.violations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "INVALID_GROUP_SELECTION",
              path: `groups.${testGroupId}.selectedPanelId`,
            }),
          ]),
        );
        expect(error.message).toContain("INVALID_GROUP_SELECTION");
      }
    }
  });
});
