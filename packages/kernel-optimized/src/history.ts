import {
  WORKSPACE_COMMAND_TYPES,
  type CommandId,
  type CommandOrigin,
  type CommittedTransaction,
  type Revision,
  type WorkspaceCommandType,
  type WorkspacePatch,
} from "@panefold/model";

const COMMAND_TYPES = new Set<string>(WORKSPACE_COMMAND_TYPES);

const PATCH_BITS: Readonly<Record<WorkspacePatch["kind"], number>> = Object.freeze({
  versions: 1 << 0,
  panel: 1 << 1,
  group: 1 << 2,
  node: 1 << 3,
  surface: 1 << 4,
  activation: 1 << 5,
  "focus-memory": 1 << 6,
  "floating-order": 1 << 7,
  "closed-panels": 1 << 8,
  "remote-transactions": 1 << 9,
  metadata: 1 << 10,
});

/**
 * A bounded replay audit record. It deliberately omits snapshots, command
 * payloads, patch payloads, labels, and inverses; it is not an undo history.
 */
export interface CompactTransactionRecord {
  readonly id: CommandId;
  readonly origin: CommandOrigin;
  readonly commandType: WorkspaceCommandType;
  readonly previousRevision: Revision;
  readonly revision: Revision;
  readonly patchCount: number;
  readonly entityPatchCount: number;
  readonly patchKindMask: number;
}

export function compactTransaction(transaction: CommittedTransaction): CompactTransactionRecord {
  const commandType = transaction.command.type;
  if (!COMMAND_TYPES.has(commandType)) {
    throw new TypeError(`Unregistered workspace command type: ${commandType}`);
  }
  let patchKindMask = 0;
  let entityPatchCount = 0;
  for (const patch of transaction.patches) {
    patchKindMask |= PATCH_BITS[patch.kind];
    if (
      patch.kind === "panel" ||
      patch.kind === "group" ||
      patch.kind === "node" ||
      patch.kind === "surface"
    ) {
      entityPatchCount += 1;
    }
  }
  return Object.freeze({
    id: transaction.id,
    origin: transaction.origin,
    commandType: commandType as WorkspaceCommandType,
    previousRevision: transaction.previousRevision,
    revision: transaction.revision,
    patchCount: transaction.patches.length,
    entityPatchCount,
    patchKindMask,
  });
}

function assertHistoryOptions(limit: number, chunkSize: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("history limit must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 2 || chunkSize > 1_024) {
    throw new RangeError("history chunkSize must be an integer between 2 and 1024");
  }
}

/** Persistent, bounded, chunked storage for compact transaction records. */
export class CompactHistory {
  readonly limit: number;
  readonly chunkSize: number;
  readonly size: number;
  readonly #chunks: readonly (readonly CompactTransactionRecord[])[];

  private constructor(
    limit: number,
    chunkSize: number,
    size: number,
    chunks: readonly (readonly CompactTransactionRecord[])[],
  ) {
    this.limit = limit;
    this.chunkSize = chunkSize;
    this.size = size;
    this.#chunks = chunks;
    Object.freeze(this);
  }

  static empty(limit = 512, chunkSize = 32): CompactHistory {
    assertHistoryOptions(limit, chunkSize);
    return new CompactHistory(limit, chunkSize, 0, Object.freeze([]));
  }

  append(record: CompactTransactionRecord): CompactHistory {
    if (this.limit === 0) return this;
    const chunks = [...this.#chunks];
    const tail = chunks.at(-1);
    if (tail === undefined || tail.length >= this.chunkSize) {
      chunks.push(Object.freeze([record]));
    } else {
      chunks[chunks.length - 1] = Object.freeze([...tail, record]);
    }

    let size = this.size + 1;
    let overflow = Math.max(0, size - this.limit);
    while (overflow > 0) {
      const first = chunks[0];
      if (first === undefined) throw new RangeError("History accounting is inconsistent");
      if (first.length <= overflow) {
        chunks.shift();
        overflow -= first.length;
        size -= first.length;
      } else {
        chunks[0] = Object.freeze(first.slice(overflow));
        size -= overflow;
        overflow = 0;
      }
    }
    return new CompactHistory(this.limit, this.chunkSize, size, Object.freeze(chunks));
  }

  entries(): readonly CompactTransactionRecord[] {
    return Object.freeze(this.#chunks.flat());
  }

  last(): CompactTransactionRecord | undefined {
    return this.#chunks.at(-1)?.at(-1);
  }

  get chunkCount(): number {
    return this.#chunks.length;
  }

  /** Diagnostic identity for structural-sharing tests; the chunk is frozen. */
  chunkIdentity(index: number): object {
    const chunk = this.#chunks[index];
    if (chunk === undefined) throw new RangeError("History chunk index is out of bounds");
    return chunk;
  }
}
