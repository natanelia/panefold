import { getEntity, nodeId, type SurfaceId, type WorkspaceSnapshot } from "@panefold/model";
import {
  openDurableWorkspace,
  type DurableWorkspaceRestoration,
  type DurableWorkspaceRuntime,
  type WorkspaceJournalPort,
  type WorkspaceRuntime,
} from "@panefold/runtime";
import { IndexedDbWorkspaceJournalPort } from "@panefold/runtime-effect";

import { initialWorkspaceSnapshot } from "./workspace-config";

const WORKSPACE_STORAGE_KEY = "atlas.workspace.v2";
const WORKSPACE_DATABASE_NAME = "panefold-atlas-demo";
const WORKSPACE_STORE_NAME = "workspace-journal";

export type DemoWorkspaceRestoration = DurableWorkspaceRestoration & {
  readonly recoveredExternalSurfaces: number;
};

export type DemoBeforeDisposeCleanup = () => void | Promise<void>;

export interface DemoWorkspaceSession {
  readonly runtime: WorkspaceRuntime;
  readonly durable: DurableWorkspaceRuntime;
  readonly journal: WorkspaceJournalPort;
  readonly restoration: DemoWorkspaceRestoration;
  registerBeforeDispose(cleanup: DemoBeforeDisposeCleanup): () => void;
  resetLayout(): Promise<void>;
  dispose(): Promise<void>;
}

export interface DemoWorkspaceDisposalDependencies {
  readonly durable: Pick<DurableWorkspaceRuntime, "flush" | "dispose">;
  readonly runtime: Pick<WorkspaceRuntime, "dispose">;
  readonly closeJournal: () => Promise<void>;
}

export type OpenDemoWorkspaceSessionResult =
  | { readonly ok: true; readonly session: DemoWorkspaceSession }
  | {
      readonly ok: false;
      readonly error: Error;
      readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
      reset(): Promise<void>;
    };

type DemoWorkspaceSessionFailure = Extract<OpenDemoWorkspaceSessionResult, { readonly ok: false }>;

/**
 * Opens Atlas only after its checksummed IndexedDB snapshot and journal have
 * been recovered. A persisted external surface is deliberately rehomed into
 * the main document: reloading a page must never recreate a popup without a
 * fresh user activation.
 */
export async function openDemoWorkspaceSession(): Promise<OpenDemoWorkspaceSessionResult> {
  let journal: IndexedDbWorkspaceJournalPort;
  try {
    journal = new IndexedDbWorkspaceJournalPort({
      databaseName: WORKSPACE_DATABASE_NAME,
      storeName: WORKSPACE_STORE_NAME,
      version: 1,
    });
  } catch (cause) {
    return unavailableResult(cause);
  }
  let opened: Awaited<ReturnType<typeof openDurableWorkspace>>;
  try {
    opened = await openDurableWorkspace({
      initialSnapshot: initialWorkspaceSnapshot,
      runtimeOptions: {
        historyLimit: 200,
        transactionLimit: 100,
      },
      journal,
      key: WORKSPACE_STORAGE_KEY,
      recovery: {
        currentKernelSchemaVersion: initialWorkspaceSnapshot.schemaVersion,
        currentApplicationLayoutVersion: initialWorkspaceSnapshot.applicationLayoutVersion,
        currentProtocolVersion: 1,
      },
      durability: "balanced",
      // The reference fixture keeps one verified snapshot per transaction. This
      // favors visible recovery evidence over storage throughput.
      compactionInterval: 1,
    });
  } catch (cause) {
    const error = asError(cause, "IndexedDB workspace initialization failed");
    return {
      ok: false,
      error,
      diagnostics: [{ code: "INDEXEDDB_OPEN_FAILED", message: error.message }],
      async reset() {
        await journal.clear(WORKSPACE_STORAGE_KEY).catch(() => undefined);
        await journal.close().catch(() => undefined);
      },
    };
  }

  if (!opened.ok) {
    return {
      ok: false,
      error: opened.error,
      diagnostics: opened.diagnostics,
      async reset() {
        await journal.clear(WORKSPACE_STORAGE_KEY);
        await journal.close();
      },
    };
  }

  let recoveredExternalSurfaces: number;
  try {
    recoveredExternalSurfaces = recoverPersistedExternalSurfaces(
      opened.runtime,
      opened.runtime.getSnapshot(),
    );
    if (recoveredExternalSurfaces > 0) await opened.durable.flush();
  } catch (cause) {
    await opened.durable.dispose().catch(() => undefined);
    opened.runtime.dispose();
    await journal.close().catch(() => undefined);
    return createDemoWorkspaceFailureResult(
      cause,
      "RECOVERY_PERSIST_FAILED",
      "Recovered external panels could not be saved safely",
    );
  }

  const disposal = createDemoWorkspaceDisposal({
    durable: opened.durable,
    runtime: opened.runtime,
    closeJournal: () => journal.close(),
  });
  const session: DemoWorkspaceSession = {
    runtime: opened.runtime,
    durable: opened.durable,
    journal,
    restoration: Object.freeze({
      ...opened.restoration,
      recoveredExternalSurfaces,
    }),
    registerBeforeDispose: disposal.registerBeforeDispose,
    async resetLayout() {
      opened.runtime.dispatch(
        { type: "restore-workspace", snapshot: initialWorkspaceSnapshot },
        { origin: "restore", label: "Reset saved Atlas layout" },
      );
      await opened.durable.flush();
    },
    dispose: disposal.dispose,
  };
  return { ok: true, session };
}

/**
 * Owns the only supported session teardown order. Registered application
 * coordinators finish semantic recovery before its durable queue is flushed;
 * every lower-level resource is still closed when any earlier step fails.
 */
export function createDemoWorkspaceDisposal(dependencies: DemoWorkspaceDisposalDependencies) {
  const beforeDispose = new Set<DemoBeforeDisposeCleanup>();
  let disposePromise: Promise<void> | undefined;

  const registerBeforeDispose = (cleanup: DemoBeforeDisposeCleanup): (() => void) => {
    if (disposePromise !== undefined) {
      throw new Error("Cannot register workspace cleanup after disposal has started");
    }
    beforeDispose.add(cleanup);
    return () => {
      beforeDispose.delete(cleanup);
    };
  };

  const dispose = (): Promise<void> => {
    if (disposePromise !== undefined) return disposePromise;
    const cleanups = [...beforeDispose];
    beforeDispose.clear();
    disposePromise = disposeDemoWorkspaceResources(dependencies, cleanups);
    return disposePromise;
  };

  return Object.freeze({ registerBeforeDispose, dispose });
}

async function disposeDemoWorkspaceResources(
  dependencies: DemoWorkspaceDisposalDependencies,
  cleanups: readonly DemoBeforeDisposeCleanup[],
): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => void | Promise<void>) => {
    try {
      await operation();
    } catch (cause) {
      errors.push(cause);
    }
  };

  for (const cleanup of cleanups) await attempt(cleanup);
  await attempt(() => dependencies.durable.flush());
  await attempt(() => dependencies.durable.dispose());
  await attempt(() => dependencies.runtime.dispose());
  await attempt(dependencies.closeJournal);

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Workspace disposal completed with ${String(errors.length)} cleanup error${
        errors.length === 1 ? "" : "s"
      }`,
    );
  }
}

/** Converts even an unexpected bootstrap rejection into the same fail-closed UI contract. */
export function createDemoWorkspaceFailureResult(
  cause: unknown,
  code = "WORKSPACE_BOOTSTRAP_REJECTED",
  fallback = "Workspace initialization failed",
): DemoWorkspaceSessionFailure {
  const error = asError(cause, fallback);
  return {
    ok: false,
    error,
    diagnostics: [{ code, message: error.message }],
    reset: resetStoredWorkspace,
  };
}

function recoverPersistedExternalSurfaces(
  runtime: WorkspaceRuntime,
  initial: WorkspaceSnapshot,
): number {
  const mainSurface = initial.surfaces.ids
    .map((id) => getEntity(initial.surfaces, id))
    .find((surface) => surface?.kind === "main");
  if (mainSurface === undefined) return 0;

  const targetGroupId = firstGroupOnSurface(initial, mainSurface.id);
  if (targetGroupId === undefined) return 0;

  let recovered = 0;
  for (const surfaceId of initial.surfaces.ids) {
    const surface = getEntity(initial.surfaces, surfaceId);
    if (surface === undefined || !surface.capabilities.crossDocument) continue;
    const receipt = runtime.dispatch(
      {
        type: "recover-orphaned-surface",
        surfaceId: surface.id,
        expectedOwnerEpoch: surface.ownerEpoch ?? 0,
        targetGroupId,
        edge: "inline-end",
        splitNodeId: nodeId(
          `reload-recovery:${String(surface.id)}:${runtime.getSnapshot().revision.toString()}`,
        ),
        ratio: 0.35,
      },
      {
        origin: "recovery",
        label: "Recover external panel after reload",
        history: "barrier",
      },
    );
    if (receipt.status === "committed") recovered += 1;
  }
  return recovered;
}

function firstGroupOnSurface(snapshot: WorkspaceSnapshot, surfaceId: SurfaceId) {
  const surface = getEntity(snapshot.surfaces, surfaceId);
  if (surface === undefined) return undefined;
  const pending = [surface.rootNodeId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    const node = getEntity(snapshot.nodes, current);
    if (node?.kind === "group") return node.groupId;
    if (node?.kind === "split") pending.push(...node.children);
  }
  return undefined;
}

function unavailableResult(cause: unknown): OpenDemoWorkspaceSessionResult {
  return createDemoWorkspaceFailureResult(
    cause,
    "INDEXEDDB_UNAVAILABLE",
    "IndexedDB is unavailable in this browser context",
  );
}

async function resetStoredWorkspace(): Promise<void> {
  const journal = new IndexedDbWorkspaceJournalPort({
    databaseName: WORKSPACE_DATABASE_NAME,
    storeName: WORKSPACE_STORE_NAME,
    version: 1,
  });
  try {
    await journal.clear(WORKSPACE_STORAGE_KEY);
  } finally {
    await journal.close().catch(() => undefined);
  }
}

function asError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback, { cause });
}
