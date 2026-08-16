import { canonicalHash } from "@panefold/kernel";
import type {
  CommandEnvelope,
  CommittedTransaction,
  WorkspaceCommand,
  WorkspaceSnapshot,
} from "@panefold/model";

import {
  createWorkspaceEnvelope,
  type CreateWorkspaceEnvelopeOptions,
  type DecodeWorkspaceEnvelopeOptions,
} from "./persistence-codec";
import {
  recoverWorkspaceBundle,
  type PersistenceDurability,
  type StoredWorkspaceBundle,
  type WorkspaceJournalEntry,
  type WorkspaceJournalPort,
  type WorkspaceRecoveryDiagnostic,
} from "./journal";
import {
  createWorkspaceRuntime,
  type DispatchOptions,
  type RuntimeDispatchReceipt,
  type WorkspaceRuntime,
  type WorkspaceRuntimeOptions,
} from "./runtime";

export type PersistenceRuntimeErrorCode =
  | "PERSISTENCE_QUEUE_OVERFLOW"
  | "PERSISTENCE_WRITE_FAILED"
  | "PERSISTENCE_DEGRADED";

export class PersistenceRuntimeError extends Error {
  public override readonly name = "PersistenceRuntimeError";

  public constructor(
    public readonly code: PersistenceRuntimeErrorCode,
    message: string,
    public readonly remediation: readonly string[],
    public readonly originalCause?: unknown,
  ) {
    super(message);
  }
}

export class DurableWorkspaceOpenError extends Error {
  public override readonly name = "DurableWorkspaceOpenError";
  public readonly code = "JOURNAL_RECOVERY_INCOMPLETE";

  public constructor(
    message: string,
    public readonly diagnostics: readonly WorkspaceRecoveryDiagnostic[],
  ) {
    super(message);
  }
}

export interface DurableWorkspaceRuntimeOptions {
  readonly runtime: WorkspaceRuntime;
  readonly journal: WorkspaceJournalPort;
  readonly key: string;
  readonly durability?: PersistenceDurability;
  readonly queueLimit?: number;
  readonly compactionInterval?: number;
  readonly envelope?: CreateWorkspaceEnvelopeOptions;
  readonly onPersistenceError?: (error: PersistenceRuntimeError) => void;
  /** Observes an isolated status-listener failure without affecting persistence. */
  readonly onStatusSubscriberError?: (cause: unknown) => void;
}

export interface DurableWorkspaceStatus {
  readonly durability: PersistenceDurability;
  readonly pendingWrites: number;
  readonly lastPersistedRevision?: string;
  readonly degraded: boolean;
  readonly error?: PersistenceRuntimeError;
}

export interface DurableWorkspaceRuntime {
  readonly runtime: WorkspaceRuntime;
  dispatch(command: WorkspaceCommand, options?: DispatchOptions): Promise<RuntimeDispatchReceipt>;
  undo(): Promise<RuntimeDispatchReceipt>;
  redo(): Promise<RuntimeDispatchReceipt>;
  flush(): Promise<void>;
  retry(): Promise<void>;
  getStatus(): DurableWorkspaceStatus;
  subscribeStatus(listener: (status: DurableWorkspaceStatus) => void): () => void;
  dispose(): Promise<void>;
}

export interface OpenDurableWorkspaceOptions extends Omit<
  DurableWorkspaceRuntimeOptions,
  "runtime"
> {
  /** Used only when the journal has no prior workspace. */
  readonly initialSnapshot: WorkspaceSnapshot;
  readonly runtimeOptions?: Omit<WorkspaceRuntimeOptions, "initialSnapshot">;
  readonly recovery: DecodeWorkspaceEnvelopeOptions;
}

export type DurableWorkspaceRestoration =
  | {
      readonly status: "initialized";
      readonly source: "initial";
      readonly revision: string;
      readonly appliedTransactions: 0;
      readonly diagnostics: readonly WorkspaceRecoveryDiagnostic[];
    }
  | {
      readonly status: "restored";
      readonly source: "latest" | "last-known-good";
      readonly revision: string;
      readonly appliedTransactions: number;
      readonly diagnostics: readonly WorkspaceRecoveryDiagnostic[];
    };

export type OpenDurableWorkspaceResult =
  | {
      readonly ok: true;
      readonly runtime: WorkspaceRuntime;
      readonly durable: DurableWorkspaceRuntime;
      readonly restoration: DurableWorkspaceRestoration;
    }
  | {
      readonly ok: false;
      readonly error: Error;
      readonly diagnostics: readonly WorkspaceRecoveryDiagnostic[];
    };

interface PendingTransaction {
  readonly transaction: CommittedTransaction;
  readonly snapshot: WorkspaceSnapshot;
}

interface PreloadedWorkspace {
  readonly bundle: StoredWorkspaceBundle | undefined;
  /** The revision produced by verified decoding and journal replay. */
  readonly recoveredRevision?: string;
}

const DEFAULT_QUEUE_LIMIT = 1_000;
const DEFAULT_COMPACTION_INTERVAL = 100;

export async function createDurableWorkspaceRuntime(
  options: DurableWorkspaceRuntimeOptions,
): Promise<DurableWorkspaceRuntime> {
  const controller = new DurableWorkspaceRuntimeImpl(options);
  await controller.initialize();
  return controller;
}

/**
 * Opens a durable workspace at its recovered revision. The persisted bundle is
 * decoded and replayed before the synchronous runtime is constructed, so
 * consumers can never observe an initial layout and later have it replaced by
 * an older or newer persisted layout.
 *
 * A corrupt or unsupported bundle is returned as a typed, non-destructive
 * failure. Callers must explicitly clear, export, or migrate that bundle rather
 * than silently overwriting it with the fallback snapshot.
 */
export async function openDurableWorkspace(
  options: OpenDurableWorkspaceOptions,
): Promise<OpenDurableWorkspaceResult> {
  const existing = await options.journal.read(options.key);
  let initialSnapshot = options.initialSnapshot;
  let restoration: DurableWorkspaceRestoration = Object.freeze({
    status: "initialized",
    source: "initial",
    revision: initialSnapshot.revision.toString(),
    appliedTransactions: 0,
    diagnostics: Object.freeze([]),
  });

  if (existing !== undefined) {
    const recovered = await recoverWorkspaceBundle(existing, options.recovery);
    if (!recovered.ok) {
      return Object.freeze({
        ok: false,
        error: recovered.error,
        diagnostics: recovered.diagnostics,
      });
    }
    const interruptedReplay = recovered.diagnostics.find(
      (diagnostic) => diagnostic.transactionId !== undefined,
    );
    if (interruptedReplay !== undefined) {
      return Object.freeze({
        ok: false,
        error: new DurableWorkspaceOpenError(
          "Workspace journal replay did not reach a verified tail.",
          recovered.diagnostics,
        ),
        diagnostics: recovered.diagnostics,
      });
    }
    initialSnapshot = recovered.snapshot;
    restoration = Object.freeze({
      status: "restored",
      source: recovered.source,
      revision: recovered.snapshot.revision.toString(),
      appliedTransactions: recovered.appliedTransactions,
      diagnostics: recovered.diagnostics,
    });
  }

  const runtime = createWorkspaceRuntime({
    ...(options.runtimeOptions ?? {}),
    initialSnapshot,
  });
  const controller = new DurableWorkspaceRuntimeImpl({
    runtime,
    journal: options.journal,
    key: options.key,
    ...(options.durability === undefined ? {} : { durability: options.durability }),
    ...(options.queueLimit === undefined ? {} : { queueLimit: options.queueLimit }),
    ...(options.compactionInterval === undefined
      ? {}
      : { compactionInterval: options.compactionInterval }),
    ...(options.envelope === undefined ? {} : { envelope: options.envelope }),
    ...(options.onPersistenceError === undefined
      ? {}
      : { onPersistenceError: options.onPersistenceError }),
    ...(options.onStatusSubscriberError === undefined
      ? {}
      : { onStatusSubscriberError: options.onStatusSubscriberError }),
  });
  try {
    await controller.initialize({
      bundle: existing,
      recoveredRevision: initialSnapshot.revision.toString(),
    });
  } catch (cause) {
    runtime.dispose();
    throw cause;
  }
  return Object.freeze({ ok: true, runtime, durable: controller, restoration });
}

class DurableWorkspaceRuntimeImpl implements DurableWorkspaceRuntime {
  public readonly runtime: WorkspaceRuntime;
  readonly #journal: WorkspaceJournalPort;
  readonly #key: string;
  readonly #durability: PersistenceDurability;
  readonly #queueLimit: number;
  readonly #compactionInterval: number;
  readonly #envelopeOptions: CreateWorkspaceEnvelopeOptions;
  readonly #onPersistenceError: ((error: PersistenceRuntimeError) => void) | undefined;
  readonly #onStatusSubscriberError: ((cause: unknown) => void) | undefined;
  readonly #queue: PendingTransaction[] = [];
  readonly #statusListeners = new Set<(status: DurableWorkspaceStatus) => void>();
  #sequence = 0;
  #activeWrites = 0;
  #processing: Promise<void> | undefined;
  #unsubscribe: (() => void) | undefined;
  #lastPersistedRevision: string | undefined;
  #degradedSnapshot: WorkspaceSnapshot | undefined;
  #error: PersistenceRuntimeError | undefined;
  #disposed = false;

  public constructor(options: DurableWorkspaceRuntimeOptions) {
    if (options.key.length === 0) throw new TypeError("Persistence key must not be empty");
    this.runtime = options.runtime;
    this.#journal = options.journal;
    this.#key = options.key;
    this.#durability = options.durability ?? "balanced";
    this.#queueLimit = validatedLimit(options.queueLimit, DEFAULT_QUEUE_LIMIT, "queueLimit");
    this.#compactionInterval = validatedPositiveLimit(
      options.compactionInterval,
      DEFAULT_COMPACTION_INTERVAL,
      "compactionInterval",
    );
    this.#envelopeOptions = options.envelope ?? {};
    this.#onPersistenceError = options.onPersistenceError;
    this.#onStatusSubscriberError = options.onStatusSubscriberError;
  }

  public async initialize(preloaded?: PreloadedWorkspace): Promise<void> {
    const existing =
      preloaded === undefined ? await this.#journal.read(this.#key) : preloaded.bundle;
    this.#sequence = (existing?.journal.at(-1)?.sequence ?? -1) + 1;
    if (
      existing === undefined ||
      (existing.latestSnapshot === undefined && preloaded?.recoveredRevision === undefined)
    ) {
      const snapshot = this.runtime.getSnapshot();
      const envelope = await createWorkspaceEnvelope(snapshot, this.#envelopeOptions);
      await this.#journal.commit(this.#key, {
        snapshot: envelope,
        markLastKnownGood: true,
        compactThroughRevision: snapshot.revision.toString(),
      });
      this.#lastPersistedRevision = snapshot.revision.toString();
    } else {
      this.#lastPersistedRevision =
        preloaded?.recoveredRevision ??
        existing.journal.at(-1)?.revision ??
        existing.latestSnapshot?.snapshotRevision ??
        existing.lastKnownGoodSnapshot?.snapshotRevision;
    }
    this.#unsubscribe = this.runtime.subscribeTransactions((transaction) => {
      this.#enqueue(transaction, this.runtime.getSnapshot());
    });
  }

  public async dispatch(
    command: WorkspaceCommand,
    options: DispatchOptions = {},
  ): Promise<RuntimeDispatchReceipt> {
    this.#assertLive();
    if (this.#durability === "strict" && this.#error !== undefined) throw this.#error;
    const receipt = this.runtime.dispatch(command, options);
    if (receipt.status === "committed" && this.#durability === "strict") await this.flush();
    return receipt;
  }

  public async undo(): Promise<RuntimeDispatchReceipt> {
    return this.dispatch(
      { type: "undo-workspace-operation" },
      { origin: "history", label: "Undo workspace operation" },
    );
  }

  public async redo(): Promise<RuntimeDispatchReceipt> {
    return this.dispatch(
      { type: "redo-workspace-operation" },
      { origin: "history", label: "Redo workspace operation" },
    );
  }

  public async flush(): Promise<void> {
    this.#assertLive();
    await this.#startProcessing();
    if (this.#error !== undefined) throw this.#error;
  }

  public async retry(): Promise<void> {
    this.#assertLive();
    const snapshot = this.#degradedSnapshot;
    if (snapshot === undefined) return;
    this.#activeWrites += 1;
    this.#notifyStatus();
    try {
      const envelope = await createWorkspaceEnvelope(snapshot, this.#envelopeOptions);
      await this.#journal.commit(this.#key, {
        snapshot: envelope,
        markLastKnownGood: true,
        compactThroughRevision: snapshot.revision.toString(),
      });
      this.#lastPersistedRevision = snapshot.revision.toString();
      this.#degradedSnapshot = undefined;
      this.#error = undefined;
      this.#notifyStatus();
    } catch (cause) {
      const error = new PersistenceRuntimeError(
        "PERSISTENCE_WRITE_FAILED",
        "Persistence recovery snapshot could not be written.",
        ["Keep the in-memory workspace open", "Export the workspace", "Free storage and retry"],
        cause,
      );
      this.#report(error);
      throw error;
    } finally {
      this.#activeWrites -= 1;
      this.#notifyStatus();
    }
    await this.#startProcessing();
  }

  public getStatus(): DurableWorkspaceStatus {
    return Object.freeze({
      durability: this.#durability,
      pendingWrites: this.#queue.length + this.#activeWrites,
      ...(this.#lastPersistedRevision === undefined
        ? {}
        : { lastPersistedRevision: this.#lastPersistedRevision }),
      degraded: this.#error !== undefined,
      ...(this.#error === undefined ? {} : { error: this.#error }),
    });
  }

  public subscribeStatus(listener: (status: DurableWorkspaceStatus) => void): () => void {
    this.#assertLive();
    this.#statusListeners.add(listener);
    this.#deliverStatus(listener, this.getStatus());
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    try {
      await this.#startProcessing();
    } finally {
      this.#disposed = true;
      this.#statusListeners.clear();
    }
  }

  #enqueue(transaction: CommittedTransaction, snapshot: WorkspaceSnapshot): void {
    if (this.#disposed) return;
    if (this.#queue.length >= this.#queueLimit) {
      this.#degradedSnapshot = snapshot;
      this.#queue.length = 0;
      this.#report(
        new PersistenceRuntimeError(
          "PERSISTENCE_QUEUE_OVERFLOW",
          `Persistence queue exceeded its bounded capacity ${String(this.#queueLimit)}.`,
          ["A full recovery snapshot is retained in memory", "Flush or retry persistence"],
        ),
      );
      return;
    }
    this.#queue.push(Object.freeze({ transaction, snapshot }));
    this.#notifyStatus();
    if (this.#durability !== "strict") void this.#startProcessing();
  }

  #startProcessing(): Promise<void> {
    if (this.#processing !== undefined) return this.#processing;
    this.#processing = this.#drain().finally(() => {
      this.#processing = undefined;
    });
    return this.#processing;
  }

  async #drain(): Promise<void> {
    while (this.#queue.length > 0 && this.#error === undefined) {
      const pending = this.#queue.shift();
      if (pending === undefined) break;
      this.#activeWrites += 1;
      this.#notifyStatus();
      try {
        await this.#persist(pending);
      } catch (cause) {
        this.#degradedSnapshot = pending.snapshot;
        this.#queue.length = 0;
        this.#report(
          new PersistenceRuntimeError(
            "PERSISTENCE_WRITE_FAILED",
            "Workspace journal write failed; in-memory truth remains authoritative.",
            ["Export the workspace", "Free storage or repair the adapter", "Retry persistence"],
            cause,
          ),
        );
      } finally {
        this.#activeWrites -= 1;
        this.#notifyStatus();
      }
    }
  }

  async #persist(pending: PendingTransaction): Promise<void> {
    const transaction = pending.transaction;
    const envelope: CommandEnvelope = Object.freeze({
      id: transaction.id,
      origin: transaction.origin,
      label: transaction.label,
      baseRevision: transaction.previousRevision,
      command: transaction.command,
    });
    const entry: WorkspaceJournalEntry = Object.freeze({
      sequence: this.#sequence,
      transactionId: transaction.id,
      previousRevision: transaction.previousRevision.toString(),
      revision: transaction.revision.toString(),
      envelope,
      resultChecksum: canonicalHash(pending.snapshot),
    });
    this.#sequence += 1;
    const compact =
      this.#durability === "session" || this.#sequence % this.#compactionInterval === 0;
    const snapshot = compact
      ? await createWorkspaceEnvelope(pending.snapshot, this.#envelopeOptions)
      : undefined;
    await this.#journal.commit(this.#key, {
      ...(this.#durability === "session" ? {} : { journalEntry: entry }),
      ...(snapshot === undefined
        ? {}
        : {
            snapshot,
            markLastKnownGood: true,
            compactThroughRevision: pending.snapshot.revision.toString(),
          }),
    });
    this.#lastPersistedRevision = pending.snapshot.revision.toString();
  }

  #report(error: PersistenceRuntimeError): void {
    this.#error = error;
    try {
      this.#onPersistenceError?.(error);
    } catch {
      // Diagnostics are observational and cannot alter persistence state.
    }
    this.#notifyStatus();
  }

  #notifyStatus(): void {
    if (this.#statusListeners.size === 0) return;
    const status = this.getStatus();
    for (const listener of [...this.#statusListeners]) {
      this.#deliverStatus(listener, status);
    }
  }

  #deliverStatus(
    listener: (status: DurableWorkspaceStatus) => void,
    status: DurableWorkspaceStatus,
  ): void {
    try {
      listener(status);
    } catch (cause) {
      try {
        this.#onStatusSubscriberError?.(cause);
      } catch {
        // Status diagnostics are observational and cannot affect writes.
      }
    }
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Durable workspace runtime has been disposed");
  }
}

function validatedLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function validatedPositiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}
