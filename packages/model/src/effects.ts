import { isWorkspaceCommandType, type CommandOrigin, type WorkspaceCommandType } from "./commands";
import { effectIntentId, type CommandId, type EffectIntentId, type Revision } from "./ids";

export type EffectIntentClass =
  "prepare" | "post-commit-idempotent" | "compensatable" | "observational";

export interface TransactionCommittedEffectPayload {
  readonly commandType: WorkspaceCommandType;
  readonly origin: CommandOrigin;
}

/**
 * A pure description of retryable work that follows one semantic commit.
 * The runtime owns delivery; the model owns stable identity and correlation.
 */
export interface TransactionCommittedEffectIntent {
  readonly id: EffectIntentId;
  readonly kind: "transaction-committed";
  readonly class: "post-commit-idempotent";
  readonly transactionId: CommandId;
  readonly previousRevision: Revision;
  readonly revision: Revision;
  readonly ordinal: number;
  readonly payload: TransactionCommittedEffectPayload;
}

/** Exhaustive public union of kernel-emitted effect descriptions. */
export type EffectIntent = TransactionCommittedEffectIntent;

export interface TransactionCommittedEffectIntentInput {
  readonly transactionId: CommandId;
  readonly previousRevision: Revision;
  readonly revision: Revision;
  readonly ordinal: number;
  readonly commandType: WorkspaceCommandType;
  readonly origin: CommandOrigin;
}

const COMMAND_ORIGINS: ReadonlySet<string> = new Set<CommandOrigin>([
  "pointer",
  "keyboard",
  "menu",
  "application",
  "restore",
  "remote",
  "platform",
  "recovery",
  "history",
]);

function transactionEffectIntentId(
  transactionId: CommandId,
  previousRevision: Revision,
  revision: Revision,
  ordinal: number,
): EffectIntentId {
  const transaction = String(transactionId);
  return effectIntentId(
    `effect:v1:transaction-committed:${String(transaction.length)}:${transaction}:${previousRevision.toString()}:${revision.toString()}:${String(ordinal)}`,
  );
}

/**
 * Creates a deterministic, deeply immutable post-commit envelope. Repeating
 * this function for the same transaction tuple returns the same identity;
 * changing the transaction, revision pair, or ordinal changes the identity.
 */
export function createTransactionCommittedEffectIntent(
  input: TransactionCommittedEffectIntentInput,
): TransactionCommittedEffectIntent {
  if (String(input.transactionId).trim().length === 0) {
    throw new TypeError("Effect transactionId must not be empty");
  }
  if (
    typeof input.previousRevision !== "bigint" ||
    typeof input.revision !== "bigint" ||
    input.previousRevision < 0n ||
    input.revision !== input.previousRevision + 1n
  ) {
    throw new RangeError("Effect revision must advance previousRevision exactly once");
  }
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
    throw new RangeError("Effect ordinal must be a non-negative safe integer");
  }
  if (!isWorkspaceCommandType(input.commandType)) {
    throw new TypeError(`Unknown effect command type: ${String(input.commandType)}`);
  }
  if (!COMMAND_ORIGINS.has(input.origin)) {
    throw new TypeError(`Unknown effect command origin: ${String(input.origin)}`);
  }

  const payload: TransactionCommittedEffectPayload = Object.freeze({
    commandType: input.commandType,
    origin: input.origin,
  });
  return Object.freeze({
    id: transactionEffectIntentId(
      input.transactionId,
      input.previousRevision,
      input.revision,
      input.ordinal,
    ),
    kind: "transaction-committed",
    class: "post-commit-idempotent",
    transactionId: input.transactionId,
    previousRevision: input.previousRevision,
    revision: input.revision,
    ordinal: input.ordinal,
    payload,
  });
}
