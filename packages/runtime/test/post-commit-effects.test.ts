import { executeCommand } from "@panefold/kernel";
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
  type EffectIntent,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type SurfaceRecord,
} from "@panefold/model";
import { describe, expect, it, vi } from "vitest";

import {
  createPostCommitEffectController,
  createWorkspaceRuntime,
  type PostCommitEffectDelivery,
  type PostCommitEffectFailure,
} from "../src";

const firstPanelId = panelId("panel:effect-first");
const secondPanelId = panelId("panel:effect-second");
const testGroupId = groupId("group:effects");

function fixture() {
  const group: GroupRecord = {
    id: testGroupId,
    panelIds: [firstPanelId, secondPanelId],
    selectedPanelId: firstPanelId,
    persistent: true,
  };
  const rootNodeId = nodeId("node:effects");
  const node: LayoutNode = { kind: "group", id: rootNodeId, groupId: group.id };
  const panel = (id: PanelRecord["id"]): PanelRecord => ({
    id,
    type: "test.effect-panel",
    typeVersion: 1,
    parameters: {},
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: {},
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  });
  const surface: SurfaceRecord = {
    id: surfaceId("surface:effects"),
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
    activation: { activePanelId: firstPanelId, activeSurfaceId: surface.id },
    focusMemory: { panelId: firstPanelId, groupId: group.id, fallback: "selected-tab" },
  });
}

function committedFixture(id = "command:effect") {
  const result = executeCommand(fixture(), {
    id: commandId(id),
    origin: "application",
    label: "Select the second panel",
    command: { type: "select-panel", panelId: secondPanelId },
  });
  if (!result.ok) throw new Error(result.error.message);
  const intent = result.effects[0];
  if (intent === undefined) throw new Error("Fixture effect is missing");
  return { intent, transaction: result.transaction };
}

function deferred() {
  let resolve: () => void = () => {};
  let reject: (cause: unknown) => void = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("post-commit effect controller", () => {
  it("coalesces concurrent and sequential duplicate delivery by stable effect ID", async () => {
    const gate = deferred();
    const deliveries: PostCommitEffectDelivery[] = [];
    const controller = createPostCommitEffectController({
      port: {
        deliver: (delivery) => {
          deliveries.push(delivery);
          return gate.promise;
        },
      },
    });
    const { intent, transaction } = committedFixture();

    const first = controller.submit(intent, transaction);
    const duplicate = controller.submit(intent, transaction);
    await Promise.resolve();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ intent, transaction, attempt: 1 });

    gate.resolve();
    await expect(Promise.all([first, duplicate])).resolves.toMatchObject([
      { status: "succeeded", effectId: intent.id, attempt: 1 },
      { status: "succeeded", effectId: intent.id, attempt: 1 },
    ]);
    await expect(controller.submit(intent, transaction)).resolves.toMatchObject({
      status: "succeeded",
      attempt: 1,
    });
    expect(deliveries).toHaveLength(1);
  });

  it("coalesces a structurally identical reconstructed duplicate", async () => {
    const port = { deliver: vi.fn() };
    const controller = createPostCommitEffectController({ port });
    const { intent, transaction } = committedFixture("command:reconstructed");
    await controller.submit(intent, transaction);
    const clonedIntent = structuredClone(intent);
    const clonedTransaction = structuredClone(transaction);

    await expect(controller.submit(clonedIntent, clonedTransaction)).resolves.toMatchObject({
      status: "succeeded",
      effectId: intent.id,
      attempt: 1,
    });
    expect(port.deliver).toHaveBeenCalledOnce();
  });

  it("contains failure and explicitly retries a retryable intent with the same identity", async () => {
    const attempts: PostCommitEffectDelivery[] = [];
    const applied = new Set<string>();
    let applications = 0;
    const reported = vi.fn((failure: PostCommitEffectFailure) => {
      void failure;
      throw new Error("Reporting must remain observational");
    });
    const controller = createPostCommitEffectController({
      port: {
        deliver: (delivery) => {
          attempts.push(delivery);
          if (!applied.has(delivery.intent.id)) {
            applied.add(delivery.intent.id);
            applications += 1;
          }
          if (delivery.attempt === 1) {
            throw new Error("ambiguous acknowledgement after application");
          }
        },
      },
      onError: reported,
    });
    const { intent, transaction } = committedFixture();

    await expect(controller.submit(intent, transaction)).resolves.toMatchObject({
      status: "failed",
      code: "DELIVERY_FAILED",
      retryable: true,
      effectId: intent.id,
      attempt: 1,
      cause: { name: "Error" },
    });
    const firstRetry = controller.retry(intent.id);
    const concurrentRetry = controller.retry(intent.id);
    await expect(Promise.all([firstRetry, concurrentRetry])).resolves.toMatchObject([
      { status: "retried", receipt: { status: "succeeded", attempt: 2 } },
      { status: "coalesced", receipt: { status: "succeeded", attempt: 2 } },
    ]);
    expect(attempts.map((delivery) => delivery.attempt)).toEqual([1, 2]);
    expect(new Set(attempts.map((delivery) => delivery.intent.id))).toEqual(new Set([intent.id]));
    expect(applications).toBe(1);
    expect(reported).toHaveBeenCalledOnce();
    expect(reported.mock.calls[0]?.[0]?.cause).toBeInstanceOf(Error);
    expect(reported.mock.calls[0]?.[0]?.receipt.cause).toEqual({ name: "Error" });
  });

  it("rejects a forged duplicate ID instead of coalescing it", async () => {
    const port = { deliver: vi.fn() };
    const controller = createPostCommitEffectController({ port });
    const { intent, transaction } = committedFixture();
    await controller.submit(intent, transaction);
    const forged = Object.freeze({
      ...intent,
      payload: Object.freeze({ ...intent.payload, origin: "keyboard" as const }),
    }) as EffectIntent;
    const forgedTransaction = Object.freeze({
      ...transaction,
      effects: Object.freeze([forged]),
    });

    await expect(controller.submit(forged, forgedTransaction)).resolves.toMatchObject({
      status: "failed",
      code: "IDENTITY_MISMATCH",
      retryable: false,
      attempt: 0,
    });
    const alteredPatches = { ...structuredClone(transaction), patches: [] };
    await expect(controller.submit(intent, alteredPatches)).resolves.toMatchObject({
      status: "failed",
      code: "IDENTITY_MISMATCH",
      retryable: false,
    });
    expect(port.deliver).toHaveBeenCalledOnce();
  });

  it("bounds both terminal receipts and concurrently pending work", async () => {
    const gate = deferred();
    const failures = vi.fn();
    const controller = createPostCommitEffectController({
      port: { deliver: () => gate.promise },
      receiptLimit: 2,
      pendingLimit: 1,
      onError: failures,
    });
    const first = committedFixture("command:pending-one");
    const second = committedFixture("command:pending-two");
    const third = committedFixture("command:pending-three");
    const pending = controller.submit(first.intent, first.transaction);
    await Promise.resolve();

    await expect(controller.submit(second.intent, second.transaction)).resolves.toMatchObject({
      status: "failed",
      code: "DELIVERY_CAPACITY_EXCEEDED",
      retryable: true,
    });
    await expect(controller.submit(third.intent, third.transaction)).resolves.toMatchObject({
      status: "failed",
      code: "DELIVERY_CAPACITY_EXCEEDED",
      retryable: true,
    });
    expect(controller.getReceipts()).toHaveLength(3);
    expect(failures).toHaveBeenCalledTimes(2);

    gate.resolve();
    await pending;
    expect(controller.getReceipts()).toHaveLength(2);
    expect(new Set(controller.getReceipts().map((receipt) => receipt.effectId))).toEqual(
      new Set([third.intent.id, first.intent.id]),
    );
  });

  it("retries a retained capacity failure after a pending slot frees", async () => {
    const gate = deferred();
    const deliveries: string[] = [];
    const controller = createPostCommitEffectController({
      port: {
        deliver: ({ intent }) => {
          deliveries.push(intent.id);
          return gate.promise;
        },
      },
      receiptLimit: 2,
      pendingLimit: 1,
    });
    const first = committedFixture("command:capacity-first");
    const second = committedFixture("command:capacity-second");
    const pending = controller.submit(first.intent, first.transaction);
    await Promise.resolve();
    await expect(controller.submit(second.intent, second.transaction)).resolves.toMatchObject({
      status: "failed",
      code: "DELIVERY_CAPACITY_EXCEEDED",
      retryable: true,
    });

    gate.resolve();
    await pending;
    await expect(controller.retry(second.intent.id)).resolves.toMatchObject({
      status: "retried",
      receipt: { status: "succeeded", attempt: 2 },
    });
    expect(deliveries).toEqual([first.intent.id, second.intent.id]);
  });

  it("validates both controller bounds", () => {
    for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createPostCommitEffectController({ port: { deliver: () => {} }, receiptLimit: value }),
      ).toThrow(RangeError);
      expect(() =>
        createPostCommitEffectController({ port: { deliver: () => {} }, pendingLimit: value }),
      ).toThrow(RangeError);
    }
    expect(() =>
      createWorkspaceRuntime({
        initialSnapshot: fixture(),
        postCommitEffects: { deliver: () => {} },
        postCommitEffectPendingLimit: -1,
      }),
    ).toThrow(RangeError);
  });

  it("aborts pending work on disposal and contains a late port rejection", async () => {
    const gate = deferred();
    let observedSignal: AbortSignal | undefined;
    const controller = createPostCommitEffectController({
      port: {
        deliver: ({ signal }) => {
          observedSignal = signal;
          return gate.promise;
        },
      },
    });
    const { intent, transaction } = committedFixture();
    const pending = controller.submit(intent, transaction);
    await Promise.resolve();

    controller.dispose();
    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({
      status: "cancelled",
      code: "DELIVERY_CANCELLED",
      effectId: intent.id,
    });
    gate.reject(new Error("late rejection after abort"));
    await controller.flush();
    await expect(controller.retry(intent.id)).resolves.toMatchObject({
      status: "rejected",
      reason: "CONTROLLER_DISPOSED",
    });
  });

  it("does not start a deferred port after immediate disposal", async () => {
    const port = { deliver: vi.fn() };
    const controller = createPostCommitEffectController({ port });
    const { intent, transaction } = committedFixture("command:immediate-dispose");
    const pending = controller.submit(intent, transaction);
    controller.dispose();

    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    expect(port.deliver).not.toHaveBeenCalled();
  });
});

describe("workspace runtime post-commit effects", () => {
  it("starts effects after commit observers and the reentrant notification queue drain", async () => {
    const events: string[] = [];
    let nextId = 0;
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: () => commandId(`command:ordered-${String(++nextId)}`),
      postCommitEffects: {
        deliver: ({ intent }) => {
          events.push(`effect:${String(intent.revision)}`);
        },
      },
    });
    runtime.subscribeTransactions((transaction) => {
      events.push(`observer:${String(transaction.revision)}`);
      if (transaction.revision === 1n) {
        expect(runtime.dispatch({ type: "select-panel", panelId: firstPanelId }).status).toBe(
          "queued",
        );
      }
    });

    const receipt = runtime.dispatch({ type: "select-panel", panelId: secondPanelId });
    events.push(`returned:${receipt.status}:${String(runtime.getSnapshot().revision)}`);
    await runtime.flushPostCommitEffects();

    expect(events).toEqual([
      "observer:1",
      "observer:2",
      "returned:committed:2",
      "effect:1",
      "effect:2",
    ]);
  });

  it("keeps a canonical commit final when an async effect fails", async () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: () => commandId("command:failure-isolated"),
      postCommitEffects: {
        deliver: async () => {
          throw new Error("storage unavailable");
        },
      },
    });

    const receipt = runtime.dispatch({ type: "select-panel", panelId: secondPanelId });
    expect(receipt.status).toBe("committed");
    await runtime.flushPostCommitEffects();

    expect(runtime.getSnapshot().revision).toBe(1n);
    expect(runtime.getSnapshot().groups.byId[testGroupId]?.selectedPanelId).toBe(secondPanelId);
    expect(runtime.getTransactions()).toHaveLength(1);
    expect(runtime.getPostCommitEffectReceipts()).toMatchObject([
      { status: "failed", code: "DELIVERY_FAILED", revision: 1n },
    ]);
  });

  it("delivers after an observer throws and all remaining observers run", async () => {
    const events: string[] = [];
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: () => commandId("command:observer-failure"),
      postCommitEffects: {
        deliver: () => {
          events.push("effect");
        },
      },
    });
    runtime.subscribeTransactions(() => {
      events.push("observer:throws");
      throw new Error("observer failed");
    });
    runtime.subscribeTransactions(() => {
      events.push("observer:later");
    });

    expect(runtime.dispatch({ type: "select-panel", panelId: secondPanelId }).status).toBe(
      "committed",
    );
    await runtime.flushPostCommitEffects();

    expect(events).toEqual(["observer:throws", "observer:later", "effect"]);
    expect(runtime.getSubscriberErrors()).toHaveLength(1);
  });

  it("does not operationally deliver preview intents", async () => {
    const deliver = vi.fn();
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: () => commandId("command:preview"),
      postCommitEffects: { deliver },
    });

    const preview = runtime.preview({ type: "select-panel", panelId: secondPanelId });
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.effects).toHaveLength(1);
    await Promise.resolve();
    await runtime.flushPostCommitEffects();

    expect(deliver).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().revision).toBe(0n);
    expect(runtime.getPostCommitEffectReceipts()).toEqual([]);
  });

  it("gives undo and redo distinct effect identities at their new revisions", async () => {
    const deliveries: PostCommitEffectDelivery[] = [];
    let nextId = 0;
    const runtime = createWorkspaceRuntime({
      initialSnapshot: fixture(),
      createCommandId: () => commandId(`command:history-${String(++nextId)}`),
      postCommitEffects: {
        deliver: (delivery) => {
          deliveries.push(delivery);
        },
      },
    });

    runtime.dispatch({ type: "select-panel", panelId: secondPanelId });
    runtime.undo();
    runtime.redo();
    await runtime.flushPostCommitEffects();

    expect(deliveries.map(({ intent }) => intent.payload.commandType)).toEqual([
      "select-panel",
      "restore-workspace",
      "select-panel",
    ]);
    expect(deliveries.map(({ intent }) => intent.payload.origin)).toEqual([
      "application",
      "history",
      "history",
    ]);
    expect(deliveries.map(({ intent }) => intent.revision)).toEqual([1n, 2n, 3n]);
    expect(new Set(deliveries.map(({ intent }) => intent.id))).toHaveLength(3);
  });
});
