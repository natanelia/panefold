import { canonicalHash } from "@panefold/kernel";
import type {
  CommandEnvelope,
  CommittedTransaction,
  WorkspaceCommand,
  WorkspaceSnapshot,
} from "@panefold/model";

import { createWorkspaceEnvelope, type CreateWorkspaceEnvelopeOptions } from "./persistence-codec";
import type { PersistenceDurability, WorkspaceJournalEntry, WorkspaceJournalPort } from "./journal";
import type { DispatchOptions, RuntimeDispatchReceipt, WorkspaceRuntime } from "./runtime";

export type PersistenceRuntimeErrorCode =
  "PERSISTENCE_QUEUE_OVERFLOW" | "PERSISTENCE_WRITE_FAILED" | "PERSISTENCE_DEGRADED";

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

export interface DurableWorkspaceRuntimeOptions {
  readonly runtime: WorkspaceRuntime;
  readonly journal: WorkspaceJournalPort;
  readonly key: string;
  readonly durability?: PersistenceDurability;
  readonly queueLimit?: number;
  readonly compactionInterval?: number;
  readonly envelope?: CreateWorkspaceEnvelopeOptions;
  readonly onPersistenceError?: (error: PersistenceRuntimeError) => void;
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
  dispose(): Promise<void>;
}

interface PendingTransaction {
  readonly transaction: CommittedTransaction;
  readonly snapshot: WorkspaceSnapshot;
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

class DurableWorkspaceRuntimeImpl implements DurableWorkspaceRuntime {
  public readonly runtime: WorkspaceRuntime;
  readonly #journal: WorkspaceJournalPort;
  readonly #key: string;
  readonly #durability: PersistenceDurability;
  readonly #queueLimit: number;
  readonly #compactionInterval: number;
  readonly #envelopeOptions: CreateWorkspaceEnvelopeOptions;
  readonly #onPersistenceError: ((error: PersistenceRuntimeError) => void) | undefined;
  readonly #queue: PendingTransaction[] = [];
  #sequence = 0;
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
  }

  public async initialize(): Promise<void> {
    const existing = await this.#journal.read(this.#key);
    this.#sequence = (existing?.journal.at(-1)?.sequence ?? -1) + 1;
    if (existing?.latestSnapshot === undefined) {
      const snapshot = this.runtime.getSnapshot();
      const envelope = await createWorkspaceEnvelope(snapshot, this.#envelopeOptions);
      await this.#journal.commit(this.#key, {
        snapshot: envelope,
        markLastKnownGood: true,
        compactThroughRevision: snapshot.revision.toString(),
      });
      this.#lastPersistedRevision = snapshot.revision.toString();
    } else {
      this.#lastPersistedRevision = existing.latestSnapshot.snapshotRevision;
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
    } catch (cause) {
      const error = new PersistenceRuntimeError(
        "PERSISTENCE_WRITE_FAILED",
        "Persistence recovery snapshot could not be written.",
        ["Keep the in-memory workspace open", "Export the workspace", "Free storage and retry"],
        cause,
      );
      this.#report(error);
      throw error;
    }
    await this.#startProcessing();
  }

  public getStatus(): DurableWorkspaceStatus {
    return Object.freeze({
      durability: this.#durability,
      pendingWrites: this.#queue.length,
      ...(this.#lastPersistedRevision === undefined
        ? {}
        : { lastPersistedRevision: this.#lastPersistedRevision }),
      degraded: this.#error !== undefined,
      ...(this.#error === undefined ? {} : { error: this.#error }),
    });
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    try {
      await this.#startProcessing();
    } finally {
      this.#disposed = true;
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
