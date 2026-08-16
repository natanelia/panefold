import { canonicalHash, executeCommand } from "@panefold/kernel";
import type { CommandEnvelope, JsonValue, WorkspaceSnapshot } from "@panefold/model";

import {
  decodeWorkspaceEnvelope,
  PersistenceCodecError,
  type DecodeWorkspaceEnvelopeOptions,
  type WorkspaceEnvelope,
} from "./persistence-codec";

export type PersistenceDurability = "strict" | "balanced" | "session";

export interface WorkspaceJournalEntry {
  readonly sequence: number;
  readonly transactionId: string;
  readonly previousRevision: string;
  readonly revision: string;
  readonly envelope: CommandEnvelope;
  readonly resultChecksum: string;
}

export interface WorkspaceCheckpointWrite {
  readonly ref: string;
  readonly panelType: string;
  readonly typeVersion: number;
  readonly value: JsonValue;
  readonly checksum: string;
}

export interface StoredWorkspaceBundle {
  readonly latestSnapshot?: WorkspaceEnvelope;
  readonly lastKnownGoodSnapshot?: WorkspaceEnvelope;
  readonly journal: readonly WorkspaceJournalEntry[];
  readonly checkpoints: Readonly<Record<string, WorkspaceCheckpointWrite>>;
}

export interface WorkspaceJournalCommit {
  readonly checkpointWrites?: readonly WorkspaceCheckpointWrite[];
  readonly requiredCheckpointRefs?: readonly string[];
  readonly journalEntry?: WorkspaceJournalEntry;
  readonly snapshot?: WorkspaceEnvelope;
  readonly markLastKnownGood?: boolean;
  readonly compactThroughRevision?: string;
}

export interface WorkspaceJournalPort {
  read(key: string): Promise<StoredWorkspaceBundle | undefined>;
  commit(key: string, commit: WorkspaceJournalCommit): Promise<void>;
  clear(key: string): Promise<void>;
}

export type JournalCommitStep =
  | "read"
  | "checkpoint"
  | "journal"
  | "snapshot"
  | "compact"
  | "publish";

export interface MemoryWorkspaceJournalOptions {
  readonly journalLimit?: number;
  readonly beforeStep?: (step: JournalCommitStep) => void;
}

export class MemoryWorkspaceJournalPort implements WorkspaceJournalPort {
  readonly #bundles = new Map<string, StoredWorkspaceBundle>();
  readonly #journalLimit: number;
  readonly #beforeStep: ((step: JournalCommitStep) => void) | undefined;

  public constructor(options: MemoryWorkspaceJournalOptions = {}) {
    const journalLimit = options.journalLimit ?? 10_000;
    if (!Number.isSafeInteger(journalLimit) || journalLimit < 0) {
      throw new RangeError("journalLimit must be a non-negative safe integer");
    }
    this.#journalLimit = journalLimit;
    this.#beforeStep = options.beforeStep;
  }

  public async read(key: string): Promise<StoredWorkspaceBundle | undefined> {
    this.#beforeStep?.("read");
    const bundle = this.#bundles.get(key);
    return bundle === undefined ? undefined : cloneBundle(bundle);
  }

  public async commit(key: string, commit: WorkspaceJournalCommit): Promise<void> {
    const current = this.#bundles.get(key) ?? emptyBundle();
    const next = applyJournalCommit(current, commit, this.#journalLimit, this.#beforeStep);
    this.#beforeStep?.("publish");
    this.#bundles.set(key, next);
  }

  public async clear(key: string): Promise<void> {
    this.#bundles.delete(key);
  }
}

export function applyJournalCommit(
  current: StoredWorkspaceBundle,
  commit: WorkspaceJournalCommit,
  journalLimit: number,
  beforeStep?: (step: JournalCommitStep) => void,
): StoredWorkspaceBundle {
  const checkpoints: Record<string, WorkspaceCheckpointWrite> = Object.assign(
    Object.create(null) as Record<string, WorkspaceCheckpointWrite>,
    current.checkpoints,
  );
  for (const checkpoint of commit.checkpointWrites ?? []) {
    beforeStep?.("checkpoint");
    validateCheckpoint(checkpoint);
    checkpoints[checkpoint.ref] = Object.freeze(structuredClone(checkpoint));
  }
  for (const ref of commit.requiredCheckpointRefs ?? []) {
    if (checkpoints[ref] === undefined) {
      throw new Error(`Snapshot references checkpoint ${ref} before it is durable`);
    }
  }

  let journal = [...current.journal];
  if (commit.journalEntry !== undefined) {
    beforeStep?.("journal");
    validateJournalEntry(commit.journalEntry, journal.at(-1));
    journal.push(Object.freeze(structuredClone(commit.journalEntry)));
    if (journal.length > journalLimit) {
      journal = journal.slice(journal.length - journalLimit);
    }
  }
  let latestSnapshot = current.latestSnapshot;
  let lastKnownGoodSnapshot = current.lastKnownGoodSnapshot;
  if (commit.snapshot !== undefined) {
    beforeStep?.("snapshot");
    latestSnapshot = structuredClone(commit.snapshot);
    if (commit.markLastKnownGood === true) lastKnownGoodSnapshot = latestSnapshot;
  }
  if (commit.compactThroughRevision !== undefined) {
    beforeStep?.("compact");
    const through = parseRevision(commit.compactThroughRevision);
    journal = journal.filter((entry) => parseRevision(entry.revision) > through);
  }
  return Object.freeze({
    ...(latestSnapshot === undefined ? {} : { latestSnapshot }),
    ...(lastKnownGoodSnapshot === undefined ? {} : { lastKnownGoodSnapshot }),
    journal: Object.freeze(journal),
    checkpoints: Object.freeze(checkpoints),
  });
}

export interface WorkspaceRecoveryDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly transactionId?: string;
}

export type WorkspaceRecoveryResult =
  | {
      readonly ok: true;
      readonly snapshot: WorkspaceSnapshot;
      readonly source: "latest" | "last-known-good";
      readonly appliedTransactions: number;
      readonly diagnostics: readonly WorkspaceRecoveryDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly error: PersistenceCodecError | Error;
      readonly diagnostics: readonly WorkspaceRecoveryDiagnostic[];
    };

export async function recoverWorkspaceBundle(
  bundle: StoredWorkspaceBundle,
  options: DecodeWorkspaceEnvelopeOptions,
): Promise<WorkspaceRecoveryResult> {
  const diagnostics: WorkspaceRecoveryDiagnostic[] = [];
  let decoded =
    bundle.latestSnapshot === undefined
      ? undefined
      : await decodeWorkspaceEnvelope(bundle.latestSnapshot, options);
  let source: "latest" | "last-known-good" = "latest";
  if (decoded?.ok !== true) {
    if (decoded !== undefined) {
      diagnostics.push({ code: decoded.error.code, message: decoded.error.message });
    }
    source = "last-known-good";
    decoded =
      bundle.lastKnownGoodSnapshot === undefined
        ? undefined
        : await decodeWorkspaceEnvelope(bundle.lastKnownGoodSnapshot, options);
  }
  if (decoded?.ok !== true) {
    const error = decoded?.error ?? new Error("No recoverable workspace snapshot exists");
    if (decoded !== undefined) {
      diagnostics.push({
        code: error instanceof PersistenceCodecError ? error.code : "RECOVERY_FAILED",
        message: error.message,
      });
    }
    return Object.freeze({ ok: false, error, diagnostics: Object.freeze(diagnostics) });
  }

  let snapshot = decoded.snapshot;
  let appliedTransactions = 0;
  const journal = [...bundle.journal].sort((left, right) => left.sequence - right.sequence);
  let previousEntry: WorkspaceJournalEntry | undefined;
  for (const entry of journal) {
    try {
      validateJournalEntry(entry, previousEntry);
      if (String(entry.envelope.id) !== entry.transactionId) {
        throw new TypeError("Journal transaction ID does not match its command envelope");
      }
    } catch (cause) {
      diagnostics.push({
        code: "JOURNAL_INVALID",
        message: cause instanceof Error ? cause.message : "Journal entry is invalid.",
        transactionId: entry.transactionId,
      });
      break;
    }
    previousEntry = entry;
    const persistedRevision = parseRevision(entry.revision);
    if (persistedRevision <= snapshot.revision) continue;
    if (
      parseRevision(entry.previousRevision) !== snapshot.revision ||
      persistedRevision !== snapshot.revision + 1n ||
      (entry.envelope.baseRevision !== undefined &&
        entry.envelope.baseRevision !== snapshot.revision)
    ) {
      diagnostics.push({
        code: "JOURNAL_REVISION_CONFLICT",
        message: "Journal replay stopped at a non-contiguous revision.",
        transactionId: entry.transactionId,
      });
      break;
    }
    let result: ReturnType<typeof executeCommand>;
    try {
      result = executeCommand(snapshot, entry.envelope);
    } catch (cause) {
      diagnostics.push({
        code: "JOURNAL_INVALID",
        message: cause instanceof Error ? cause.message : "Journal command could not be decoded.",
        transactionId: entry.transactionId,
      });
      break;
    }
    if (!result.ok || canonicalHash(result.next) !== entry.resultChecksum) {
      diagnostics.push({
        code: result.ok ? "JOURNAL_CHECKSUM_MISMATCH" : result.error.code,
        message: result.ok
          ? "Journal replay checksum did not match the recorded canonical state."
          : result.error.message,
        transactionId: entry.transactionId,
      });
      break;
    }
    snapshot = result.next;
    appliedTransactions += 1;
  }
  return Object.freeze({
    ok: true,
    snapshot,
    source,
    appliedTransactions,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function emptyBundle(): StoredWorkspaceBundle {
  return Object.freeze({ journal: Object.freeze([]), checkpoints: Object.freeze({}) });
}

function cloneBundle(bundle: StoredWorkspaceBundle): StoredWorkspaceBundle {
  return structuredClone(bundle);
}

function validateCheckpoint(checkpoint: WorkspaceCheckpointWrite): void {
  if (
    checkpoint.ref.length === 0 ||
    checkpoint.panelType.length === 0 ||
    checkpoint.checksum.length === 0 ||
    !Number.isSafeInteger(checkpoint.typeVersion) ||
    checkpoint.typeVersion < 1
  ) {
    throw new TypeError("Invalid panel checkpoint write");
  }
}

function validateJournalEntry(
  entry: WorkspaceJournalEntry,
  previous: WorkspaceJournalEntry | undefined,
): void {
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 0) {
    throw new TypeError("Journal sequence must be a non-negative safe integer");
  }
  if (previous !== undefined && entry.sequence <= previous.sequence) {
    throw new TypeError("Journal sequence must increase monotonically");
  }
  if (entry.transactionId.length === 0 || entry.resultChecksum.length === 0) {
    throw new TypeError("Journal transaction identity and checksum are required");
  }
  if (parseRevision(entry.previousRevision) >= parseRevision(entry.revision)) {
    throw new TypeError("Journal revision must advance");
  }
}

function parseRevision(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError("Invalid persisted revision");
  return BigInt(value);
}
