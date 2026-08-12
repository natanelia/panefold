import { canonicalHash, canonicalSerialize, executeCommand } from "@panefold/kernel";
import {
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  commandId,
  createWorkspaceSnapshot,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type CommandEnvelope,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it, vi } from "vitest";

import {
  MemoryWorkspaceJournalPort,
  PersistenceRuntimeError,
  SHA256_CHECKSUM,
  createDurableWorkspaceRuntime,
  createWorkspaceEnvelope,
  createWorkspaceRuntime,
  decodeWorkspaceEnvelope,
  openDurableWorkspace,
  recoverWorkspaceBundle,
  type WorkspaceJournalEntry,
} from "../src";

const firstPanelId = panelId("panel:first");
const secondPanelId = panelId("panel:second");
const testGroupId = groupId("group:main");

function panel(id: PanelRecord["id"]): PanelRecord {
  return {
    id,
    type: "test.panel",
    typeVersion: 1,
    parameters: { value: String(id) },
    capabilities: DEFAULT_PANEL_CAPABILITIES,
    constraints: { hardMinInline: 120, hardMinBlock: 80 },
    lifecycle: DEFAULT_PANEL_LIFECYCLE,
  };
}

function fixture(): WorkspaceSnapshot {
  const group: GroupRecord = {
    id: testGroupId,
    panelIds: [firstPanelId, secondPanelId],
    selectedPanelId: firstPanelId,
    persistent: true,
  };
  const rootNodeId = nodeId("node:main");
  const node: LayoutNode = { kind: "group", id: rootNodeId, groupId: group.id };
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
    activation: { activePanelId: firstPanelId, activeSurfaceId: surface.id },
    focusMemory: { panelId: firstPanelId, groupId: group.id, fallback: "selected-tab" },
  });
}

const decodeOptions = {
  currentKernelSchemaVersion: CURRENT_WORKSPACE_SCHEMA_VERSION,
  currentApplicationLayoutVersion: 1,
  currentProtocolVersion: 1,
} as const;

function selectionEnvelope(snapshot: WorkspaceSnapshot): CommandEnvelope {
  return {
    id: commandId("command:select-second"),
    origin: "application",
    label: "Select second panel",
    baseRevision: snapshot.revision,
    command: { type: "select-panel", panelId: secondPanelId },
  };
}

describe("workspace persistence codec", () => {
  it("round-trips a canonical workspace through a checksummed envelope", async () => {
    const initial = fixture();
    const envelope = await createWorkspaceEnvelope(initial);
    const decoded = await decodeWorkspaceEnvelope(envelope, decodeOptions);

    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(canonicalHash(decoded.snapshot)).toBe(canonicalHash(initial));
      expect(decoded.diagnostics).toEqual([]);
    }
  });

  it("rejects tampering, excessive depth, and unsafe object prototypes without replacing state", async () => {
    const envelope = await createWorkspaceEnvelope(fixture());
    const tampered = structuredClone(envelope);
    (tampered.workspace as { revision: unknown }).revision = { $bigint: "99" };

    const checksumFailure = await decodeWorkspaceEnvelope(tampered, decodeOptions);
    expect(checksumFailure).toMatchObject({ ok: false, error: { code: "CHECKSUM_MISMATCH" } });

    const depthFailure = await decodeWorkspaceEnvelope(envelope, {
      ...decodeOptions,
      limits: { maxDepth: 1 },
    });
    expect(depthFailure).toMatchObject({ ok: false, error: { code: "LIMIT_EXCEEDED" } });

    const polluted = Object.create({ inherited: true }) as Record<string, unknown>;
    polluted.workspace = envelope.workspace;
    const prototypeFailure = await decodeWorkspaceEnvelope(polluted, decodeOptions);
    expect(prototypeFailure).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });

    const getter = vi.fn(() => envelope.workspace);
    const accessorEnvelope = { ...envelope } as Record<string, unknown>;
    Object.defineProperty(accessorEnvelope, "workspace", { enumerable: true, get: getter });
    const accessorFailure = await decodeWorkspaceEnvelope(accessorEnvelope, decodeOptions);
    expect(accessorFailure).toMatchObject({ ok: false, error: { code: "INVALID_ENVELOPE" } });
    expect(getter).not.toHaveBeenCalled();
  });

  it("applies a unique sequential migration and reports a missing migration non-destructively", async () => {
    const envelope = await createWorkspaceEnvelope(fixture());
    const oldEnvelope = { ...envelope, applicationLayoutVersion: 1 };
    const migrated = await decodeWorkspaceEnvelope(oldEnvelope, {
      ...decodeOptions,
      currentApplicationLayoutVersion: 2,
      migrations: [
        {
          id: "application-1-to-2",
          scope: "application",
          fromVersion: 1,
          toVersion: 2,
          migrate: (workspace: unknown) => ({
            ...(workspace as Readonly<Record<string, unknown>>),
            applicationLayoutVersion: 2,
          }),
        },
      ],
    });

    expect(migrated).toMatchObject({
      ok: true,
      diagnostics: [{ migrationId: "application-1-to-2", fromVersion: 1, toVersion: 2 }],
    });

    const missing = await decodeWorkspaceEnvelope(oldEnvelope, {
      ...decodeOptions,
      currentApplicationLayoutVersion: 2,
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "MIGRATION_MISSING" } });
    expect(oldEnvelope).toEqual({ ...envelope, applicationLayoutVersion: 1 });
  });

  it("migrates a version-one kernel snapshot with the built-in remote ledger migration", async () => {
    const envelope = await createWorkspaceEnvelope(fixture());
    const workspace = {
      ...(envelope.workspace as Readonly<Record<string, unknown>>),
      schemaVersion: 1,
    } as Record<string, unknown>;
    delete workspace.appliedRemoteTransactions;
    const v1Envelope = {
      ...envelope,
      kernelSchemaVersion: 1,
      workspace,
      checksum: await SHA256_CHECKSUM.digest(canonicalSerialize(workspace)),
    };

    const decoded = await decodeWorkspaceEnvelope(v1Envelope, decodeOptions);
    expect(decoded).toMatchObject({
      ok: true,
      snapshot: { schemaVersion: CURRENT_WORKSPACE_SCHEMA_VERSION, appliedRemoteTransactions: [] },
      diagnostics: [
        { migrationId: "panefold.kernel.1-to-2.remote-transaction-ledger", fromVersion: 1 },
      ],
    });
  });
});

describe("workspace journal", () => {
  it("publishes a commit atomically only after required checkpoints are durable", async () => {
    let failAtPublish = false;
    const port = new MemoryWorkspaceJournalPort({
      beforeStep: (step) => {
        if (step === "publish" && failAtPublish) throw new Error("injected publish failure");
      },
    });
    const initialEnvelope = await createWorkspaceEnvelope(fixture());
    await port.commit("workspace", { snapshot: initialEnvelope, markLastKnownGood: true });
    const before = await port.read("workspace");
    failAtPublish = true;

    await expect(
      port.commit("workspace", {
        checkpointWrites: [
          {
            ref: "checkpoint:first",
            panelType: "test.panel",
            typeVersion: 1,
            value: { text: "draft" },
            checksum: "sha256:test",
          },
        ],
        requiredCheckpointRefs: ["checkpoint:first"],
      }),
    ).rejects.toThrow("injected publish failure");
    expect(await port.read("workspace")).toEqual(before);

    failAtPublish = false;
    await expect(
      port.commit("workspace", { requiredCheckpointRefs: ["checkpoint:missing"] }),
    ).rejects.toThrow("before it is durable");
  });

  it("replays a contiguous journal and falls back from a corrupt latest snapshot", async () => {
    const initial = fixture();
    const envelope = selectionEnvelope(initial);
    const result = executeCommand(initial, envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry: WorkspaceJournalEntry = {
      sequence: 0,
      transactionId: String(envelope.id),
      previousRevision: initial.revision.toString(),
      revision: result.next.revision.toString(),
      envelope,
      resultChecksum: canonicalHash(result.next),
    };
    const lastKnownGoodSnapshot = await createWorkspaceEnvelope(initial);
    const latestSnapshot = {
      ...structuredClone(lastKnownGoodSnapshot),
      checksum: "sha256:corrupt",
    };

    const recovered = await recoverWorkspaceBundle(
      {
        latestSnapshot,
        lastKnownGoodSnapshot,
        journal: [entry],
        checkpoints: {},
      },
      decodeOptions,
    );

    expect(recovered).toMatchObject({
      ok: true,
      source: "last-known-good",
      appliedTransactions: 1,
    });
    if (recovered.ok) {
      expect(canonicalHash(recovered.snapshot)).toBe(canonicalHash(result.next));
      expect(recovered.diagnostics[0]?.code).toBe("CHECKSUM_MISMATCH");
    }
  });

  it("stops safely at a corrupt journal entry and retains the valid snapshot", async () => {
    const initial = fixture();
    const lastKnownGoodSnapshot = await createWorkspaceEnvelope(initial);
    const recovered = await recoverWorkspaceBundle(
      {
        latestSnapshot: lastKnownGoodSnapshot,
        lastKnownGoodSnapshot,
        journal: [
          {
            sequence: -1,
            transactionId: "corrupt",
            previousRevision: "0",
            revision: "1",
            envelope: selectionEnvelope(initial),
            resultChecksum: "invalid",
          },
        ],
        checkpoints: {},
      },
      decodeOptions,
    );

    expect(recovered).toMatchObject({
      ok: true,
      appliedTransactions: 0,
      diagnostics: [{ code: "JOURNAL_INVALID" }],
    });
    if (recovered.ok) expect(canonicalHash(recovered.snapshot)).toBe(canonicalHash(initial));
  });
});

describe("durable workspace runtime", () => {
  it("opens at the recovered journal revision before exposing the runtime", async () => {
    const port = new MemoryWorkspaceJournalPort();
    const first = await openDurableWorkspace({
      initialSnapshot: fixture(),
      journal: port,
      key: "recreate",
      recovery: decodeOptions,
      durability: "strict",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.restoration).toMatchObject({
      status: "initialized",
      source: "initial",
      revision: "0",
    });
    expect((await port.read("recreate"))?.latestSnapshot?.snapshotRevision).toBe("0");

    await first.durable.dispatch({ type: "select-panel", panelId: secondPanelId });
    await first.durable.dispose();
    first.runtime.dispose();
    // The default compaction interval leaves revision one in the journal, so
    // this exercises replay rather than merely loading a newer snapshot.
    expect((await port.read("recreate"))?.journal.at(-1)?.revision).toBe("1");

    const reopened = await openDurableWorkspace({
      initialSnapshot: fixture(),
      journal: port,
      key: "recreate",
      recovery: decodeOptions,
      durability: "strict",
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    expect(reopened.restoration).toMatchObject({
      status: "restored",
      source: "latest",
      revision: "1",
      appliedTransactions: 1,
    });
    expect(reopened.runtime.getSnapshot().groups.byId[String(testGroupId)]).toMatchObject({
      selectedPanelId: secondPanelId,
    });
    expect(reopened.durable.getStatus()).toMatchObject({
      pendingWrites: 0,
      lastPersistedRevision: "1",
      degraded: false,
    });
    await reopened.durable.dispose();
    reopened.runtime.dispose();
  });

  it("does not overwrite an unrecoverable bundle with the initial snapshot", async () => {
    const port = new MemoryWorkspaceJournalPort();
    const envelope = await createWorkspaceEnvelope(fixture());
    await port.commit("corrupt-open", {
      snapshot: { ...envelope, checksum: "sha256:corrupt" },
      markLastKnownGood: true,
    });
    const before = await port.read("corrupt-open");

    const opened = await openDurableWorkspace({
      initialSnapshot: fixture(),
      journal: port,
      key: "corrupt-open",
      recovery: decodeOptions,
    });

    expect(opened).toMatchObject({ ok: false, error: { code: "CHECKSUM_MISMATCH" } });
    expect(await port.read("corrupt-open")).toEqual(before);
  });

  it("restores a last-known-good-only bundle without silently repairing it", async () => {
    const envelope = await createWorkspaceEnvelope(fixture());
    const commit = vi.fn(async () => undefined);
    const journal = {
      read: async () => ({
        lastKnownGoodSnapshot: envelope,
        journal: [],
        checkpoints: {},
      }),
      commit,
      clear: async () => undefined,
    };

    const opened = await openDurableWorkspace({
      initialSnapshot: fixture(),
      journal,
      key: "last-known-good-only",
      recovery: decodeOptions,
    });

    expect(opened).toMatchObject({
      ok: true,
      restoration: { status: "restored", source: "last-known-good", revision: "0" },
    });
    expect(commit).not.toHaveBeenCalled();
    if (opened.ok) {
      await opened.durable.dispose();
      opened.runtime.dispose();
    }
  });

  it("fails closed without appending behind an interrupted journal replay", async () => {
    const port = new MemoryWorkspaceJournalPort();
    const initial = fixture();
    const envelope = selectionEnvelope(initial);
    const selected = executeCommand(initial, envelope);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;

    await port.commit("interrupted-replay", {
      snapshot: await createWorkspaceEnvelope(initial),
      markLastKnownGood: true,
    });
    await port.commit("interrupted-replay", {
      journalEntry: {
        sequence: 0,
        transactionId: String(envelope.id),
        previousRevision: initial.revision.toString(),
        revision: selected.next.revision.toString(),
        envelope,
        resultChecksum: "sha256:corrupt",
      },
    });
    const before = await port.read("interrupted-replay");

    const opened = await openDurableWorkspace({
      initialSnapshot: fixture(),
      journal: port,
      key: "interrupted-replay",
      recovery: decodeOptions,
    });

    expect(opened).toMatchObject({
      ok: false,
      error: { code: "JOURNAL_RECOVERY_INCOMPLETE" },
      diagnostics: [{ code: "JOURNAL_CHECKSUM_MISMATCH" }],
    });
    expect(await port.read("interrupted-replay")).toEqual(before);
  });

  it("publishes saving transitions and isolates status subscribers", async () => {
    const statusSubscriberFailure = vi.fn();
    const statuses: Array<{ readonly pendingWrites: number; readonly revision?: string }> = [];
    const runtime = createWorkspaceRuntime({ initialSnapshot: fixture() });
    const durable = await createDurableWorkspaceRuntime({
      runtime,
      journal: new MemoryWorkspaceJournalPort(),
      key: "observable",
      durability: "strict",
      onStatusSubscriberError: statusSubscriberFailure,
    });
    durable.subscribeStatus(() => {
      throw new Error("observer defect");
    });
    durable.subscribeStatus((status) => {
      statuses.push({
        pendingWrites: status.pendingWrites,
        ...(status.lastPersistedRevision === undefined
          ? {}
          : { revision: status.lastPersistedRevision }),
      });
    });

    await expect(
      durable.dispatch({ type: "select-panel", panelId: secondPanelId }),
    ).resolves.toMatchObject({ status: "committed" });

    expect(statusSubscriberFailure).toHaveBeenCalled();
    expect(statuses.some((status) => status.pendingWrites > 0)).toBe(true);
    expect(statuses.at(-1)).toEqual({ pendingWrites: 0, revision: "1" });
    await durable.dispose();
    runtime.dispose();
  });

  it("waits for strict durability and records the committed revision", async () => {
    const port = new MemoryWorkspaceJournalPort();
    const runtime = createWorkspaceRuntime({ initialSnapshot: fixture() });
    const durable = await createDurableWorkspaceRuntime({
      runtime,
      journal: port,
      key: "strict",
      durability: "strict",
      compactionInterval: 1,
    });

    const receipt = await durable.dispatch({ type: "select-panel", panelId: secondPanelId });

    expect(receipt.status).toBe("committed");
    expect(durable.getStatus()).toMatchObject({
      durability: "strict",
      pendingWrites: 0,
      lastPersistedRevision: "1",
      degraded: false,
    });
    expect((await port.read("strict"))?.latestSnapshot?.snapshotRevision).toBe("1");
    await durable.dispose();
  });

  it("keeps in-memory truth authoritative when a write fails and recovers by snapshot", async () => {
    let failWrites = false;
    const onPersistenceError = vi.fn();
    const port = new MemoryWorkspaceJournalPort({
      beforeStep: (step) => {
        if (step === "publish" && failWrites) throw new Error("quota exhausted");
      },
    });
    const runtime = createWorkspaceRuntime({ initialSnapshot: fixture() });
    const durable = await createDurableWorkspaceRuntime({
      runtime,
      journal: port,
      key: "balanced",
      durability: "balanced",
      onPersistenceError,
    });
    failWrites = true;

    const receipt = await durable.dispatch({ type: "select-panel", panelId: secondPanelId });
    expect(receipt.status).toBe("committed");
    await expect(durable.flush()).rejects.toBeInstanceOf(PersistenceRuntimeError);
    expect(runtime.getSnapshot().revision).toBe(1n);
    expect(durable.getStatus()).toMatchObject({ degraded: true, lastPersistedRevision: "0" });
    expect(onPersistenceError).toHaveBeenCalledTimes(1);

    failWrites = false;
    await durable.retry();
    expect(durable.getStatus()).toMatchObject({
      degraded: false,
      pendingWrites: 0,
      lastPersistedRevision: "1",
    });
    expect((await port.read("balanced"))?.latestSnapshot?.snapshotRevision).toBe("1");
    await durable.dispose();
  });
});
