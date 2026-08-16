import { canonicalSerialize } from "@panefold/kernel";
import {
  createTransactionCommittedEffectIntent,
  type CommittedTransaction,
  type EffectIntent,
  type EffectIntentId,
  type Revision,
} from "@panefold/model";

export interface PostCommitEffectDelivery {
  readonly intent: EffectIntent;
  /**
   * Supplies the command and patches without duplicating them in the bounded
   * intent payload. Its identity and revisions are validated before delivery.
   */
  readonly transaction: CommittedTransaction;
  /** One-based physical delivery attempt. A retry keeps the same intent ID. */
  readonly attempt: number;
  readonly signal: AbortSignal;
}

/**
 * An operational boundary invoked only after the canonical transaction has
 * committed and synchronous observers have run. Implementations must use
 * `delivery.intent.id` as their idempotency key for retryable effects.
 */
export interface PostCommitEffectPort {
  deliver(delivery: PostCommitEffectDelivery): void | PromiseLike<void>;
}

export type PostCommitEffectFailureCode =
  | "DELIVERY_FAILED"
  | "DELIVERY_CAPACITY_EXCEEDED"
  | "IDENTITY_MISMATCH"
  | "DELIVERY_CANCELLED";

interface PostCommitEffectReceiptBase {
  readonly effectId: EffectIntentId;
  readonly transactionId: CommittedTransaction["id"];
  readonly previousRevision: Revision;
  readonly revision: Revision;
  readonly attempt: number;
}

export type PostCommitEffectReceipt =
  | (PostCommitEffectReceiptBase & {
      readonly status: "pending";
    })
  | (PostCommitEffectReceiptBase & {
      readonly status: "succeeded";
    })
  | (PostCommitEffectReceiptBase & {
      readonly status: "failed";
      readonly code: Exclude<PostCommitEffectFailureCode, "DELIVERY_CANCELLED">;
      readonly retryable: boolean;
      readonly cause: unknown;
    })
  | (PostCommitEffectReceiptBase & {
      readonly status: "cancelled";
      readonly code: "DELIVERY_CANCELLED";
      readonly retryable: boolean;
      readonly cause: unknown;
    });

export interface PostCommitEffectFailure {
  readonly receipt: Extract<PostCommitEffectReceipt, { readonly status: "failed" }>;
  /** Raw operational error; retained receipts are redacted unless opted in. */
  readonly cause: unknown;
}

export type PostCommitEffectRetryRejection =
  | "NOT_FOUND"
  | "NOT_FAILED"
  | "NOT_RETRYABLE"
  | "CONTROLLER_DISPOSED";

export type PostCommitEffectRetryResult =
  | {
      readonly status: "retried" | "coalesced";
      readonly receipt: Exclude<PostCommitEffectReceipt, { readonly status: "pending" }>;
    }
  | {
      readonly status: "rejected";
      readonly reason: PostCommitEffectRetryRejection;
      readonly receipt?: PostCommitEffectReceipt;
    };

export interface PostCommitEffectControllerOptions {
  readonly port: PostCommitEffectPort;
  /**
   * Number of terminal receipts, and therefore recent deduplication keys, kept
   * in memory. Pending deliveries are never evicted. Defaults to 200.
   */
  readonly receiptLimit?: number;
  /** Maximum simultaneously pending deliveries. Defaults to 1,000. */
  readonly pendingLimit?: number;
  /** Opt-in because retained exception objects may contain application data. */
  readonly retainErrorCause?: boolean;
  /** Reporting is observational; exceptions thrown here are contained. */
  readonly onError?: (failure: PostCommitEffectFailure) => void;
}

export interface PostCommitEffectController {
  /**
   * Delivers once within the retained ledger. Concurrent duplicates coalesce
   * onto the same promise and successful duplicates do not call the port.
   * This in-memory window is not crash-durable: ports that retry across reloads
   * must durably deduplicate the stable `intent.id` before applying work.
   */
  submit(
    intent: EffectIntent,
    transaction: CommittedTransaction,
  ): Promise<Exclude<PostCommitEffectReceipt, { readonly status: "pending" }>>;
  retry(effectId: EffectIntentId): Promise<PostCommitEffectRetryResult>;
  getReceipts(): readonly PostCommitEffectReceipt[];
  flush(): Promise<void>;
  dispose(): void;
}

interface DeliveryRecord {
  readonly intent: EffectIntent;
  readonly transaction: CommittedTransaction;
  fingerprint: string | undefined;
  readonly controller: AbortController;
  readonly promise: Promise<TerminalReceipt>;
  receipt: PostCommitEffectReceipt;
}

type TerminalReceipt = Exclude<PostCommitEffectReceipt, { readonly status: "pending" }>;

const DEFAULT_POST_COMMIT_EFFECT_RECEIPT_LIMIT = 200;
const DEFAULT_POST_COMMIT_EFFECT_PENDING_LIMIT = 1_000;

export function createPostCommitEffectController(
  options: PostCommitEffectControllerOptions,
): PostCommitEffectController {
  return new PostCommitEffectControllerImpl(options);
}

class PostCommitEffectControllerImpl implements PostCommitEffectController {
  readonly #port: PostCommitEffectPort;
  readonly #records = new Map<EffectIntentId, DeliveryRecord>();
  readonly #terminalOrder: EffectIntentId[] = [];
  readonly #receiptLimit: number;
  readonly #pendingLimit: number;
  readonly #retainErrorCause: boolean;
  readonly #onError: ((failure: PostCommitEffectFailure) => void) | undefined;
  #disposed = false;

  public constructor(options: PostCommitEffectControllerOptions) {
    this.#port = options.port;
    this.#receiptLimit = validatedReceiptLimit(options.receiptLimit);
    this.#pendingLimit = validatedPendingLimit(options.pendingLimit);
    this.#retainErrorCause = options.retainErrorCause ?? false;
    this.#onError = options.onError;
  }

  public submit(intent: EffectIntent, transaction: CommittedTransaction): Promise<TerminalReceipt> {
    const identityError = validateIdentity(intent, transaction);
    if (identityError !== undefined) {
      return this.#rejectIdentity(intent, transaction, identityError);
    }
    const existing = this.#records.get(intent.id);
    if (existing !== undefined) {
      if (existing.intent === intent && existing.transaction === transaction) {
        return existing.promise;
      }
      const candidateFingerprint = bindingFingerprint(intent, transaction);
      existing.fingerprint ??= fingerprintOrUndefined(
        bindingFingerprint(existing.intent, existing.transaction),
      );
      if (
        existing.fingerprint === undefined ||
        candidateFingerprint instanceof Error ||
        existing.fingerprint !== candidateFingerprint
      ) {
        return this.#rejectUnretainedIdentity(
          intent,
          candidateFingerprint instanceof Error
            ? candidateFingerprint
            : new TypeError(
                "Post-commit effect ID is already bound to different transaction content.",
              ),
        );
      }
      return existing.promise;
    }

    if (this.#disposed) {
      return Promise.resolve(
        cancelledReceipt(intent, 0, "Post-commit effect controller is disposed."),
      );
    }

    return this.#start(intent, transaction, 1);
  }

  public retry(effectId: EffectIntentId): Promise<PostCommitEffectRetryResult> {
    const record = this.#records.get(effectId);
    if (record === undefined) {
      return Promise.resolve({ status: "rejected", reason: "NOT_FOUND" });
    }
    if (this.#disposed) {
      return Promise.resolve({
        status: "rejected",
        reason: "CONTROLLER_DISPOSED",
        receipt: record.receipt,
      });
    }
    if (record.receipt.status === "pending") {
      return record.promise.then((receipt) => ({ status: "coalesced", receipt }));
    }
    if (record.receipt.status === "succeeded") {
      return Promise.resolve({
        status: "rejected",
        reason: "NOT_FAILED",
        receipt: record.receipt,
      });
    }
    if (!record.receipt.retryable || record.intent.class !== "post-commit-idempotent") {
      return Promise.resolve({
        status: "rejected",
        reason: "NOT_RETRYABLE",
        receipt: record.receipt,
      });
    }

    const promise = this.#start(record.intent, record.transaction, record.receipt.attempt + 1);
    return promise.then((receipt) => ({ status: "retried", receipt }));
  }

  public getReceipts(): readonly PostCommitEffectReceipt[] {
    return Object.freeze([...this.#records.values()].map((record) => record.receipt));
  }

  public async flush(): Promise<void> {
    while (true) {
      const pending = [...this.#records.values()]
        .filter((record) => record.receipt.status === "pending")
        .map((record) => record.promise);
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const record of this.#records.values()) {
      if (record.receipt.status === "pending") {
        record.controller.abort(new Error("Post-commit effect delivery was cancelled."));
      }
    }
  }

  #start(
    intent: EffectIntent,
    transaction: CommittedTransaction,
    attempt: number,
  ): Promise<TerminalReceipt> {
    this.#removeTerminal(intent.id);
    if (this.#pendingCount() >= this.#pendingLimit) {
      const capacityError = new Error(
        `Post-commit effect pending limit ${String(this.#pendingLimit)} was reached.`,
      );
      const receipt = failedReceipt(
        intent,
        attempt,
        "DELIVERY_CAPACITY_EXCEEDED",
        intent.class === "post-commit-idempotent",
        capacityError,
        this.#retainErrorCause,
      );
      const promise = Promise.resolve(receipt);
      const record: DeliveryRecord = {
        intent,
        transaction,
        fingerprint: undefined,
        controller: new AbortController(),
        promise,
        receipt,
      };
      this.#records.set(intent.id, record);
      this.#recordTerminal(intent.id);
      this.#reportFailure(receipt, capacityError);
      return promise;
    }
    const controller = new AbortController();
    const pending = pendingReceipt(intent, attempt);
    let deliveryFailed = false;
    let deliveryFailureCause: unknown;
    const promise = this.#deliver(intent, transaction, attempt, controller.signal).then(
      () => succeededReceipt(intent, attempt),
      (cause: unknown) => {
        if (controller.signal.aborted) return cancelledReceipt(intent, attempt, cause);
        deliveryFailed = true;
        deliveryFailureCause = cause;
        const receipt = failedReceipt(
          intent,
          attempt,
          "DELIVERY_FAILED",
          intent.class === "post-commit-idempotent",
          cause,
          this.#retainErrorCause,
        );
        return receipt;
      },
    );
    const record: DeliveryRecord = {
      intent,
      transaction,
      fingerprint: undefined,
      controller,
      promise,
      receipt: pending,
    };
    this.#records.set(intent.id, record);

    void promise.then((receipt) => {
      // A later explicit retry may have replaced this record. Never let the
      // earlier attempt overwrite that newer receipt.
      if (this.#records.get(intent.id) !== record) return;
      record.receipt = receipt;
      this.#recordTerminal(intent.id);
      if (deliveryFailed && receipt.status === "failed") {
        this.#reportFailure(receipt, deliveryFailureCause);
      }
    });
    return promise;
  }

  #rejectIdentity(
    intent: EffectIntent,
    transaction: CommittedTransaction,
    cause: Error,
  ): Promise<TerminalReceipt> {
    if (this.#records.has(intent.id)) return this.#rejectUnretainedIdentity(intent, cause);
    const receipt = failedReceipt(
      intent,
      0,
      "IDENTITY_MISMATCH",
      false,
      cause,
      this.#retainErrorCause,
    );
    const promise = Promise.resolve(receipt);
    const record: DeliveryRecord = {
      intent,
      transaction,
      fingerprint: undefined,
      controller: new AbortController(),
      promise,
      receipt,
    };
    this.#records.set(intent.id, record);
    this.#recordTerminal(intent.id);
    this.#reportFailure(receipt, cause);
    return promise;
  }

  #rejectUnretainedIdentity(intent: EffectIntent, cause: Error): Promise<TerminalReceipt> {
    const receipt = failedReceipt(
      intent,
      0,
      "IDENTITY_MISMATCH",
      false,
      cause,
      this.#retainErrorCause,
    );
    this.#reportFailure(receipt, cause);
    return Promise.resolve(receipt);
  }

  #deliver(
    intent: EffectIntent,
    transaction: CommittedTransaction,
    attempt: number,
    signal: AbortSignal,
  ): Promise<void> {
    const operation = Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return this.#port.deliver(Object.freeze({ intent, transaction, attempt, signal }));
    });
    return waitWithSignal(operation, signal);
  }

  #recordTerminal(effectId: EffectIntentId): void {
    this.#removeTerminal(effectId);
    this.#terminalOrder.push(effectId);
    while (this.#terminalOrder.length > this.#receiptLimit) {
      const evicted = this.#terminalOrder.shift();
      if (evicted !== undefined) this.#records.delete(evicted);
    }
  }

  #pendingCount(): number {
    let count = 0;
    for (const record of this.#records.values()) {
      if (record.receipt.status === "pending") count += 1;
    }
    return count;
  }

  #removeTerminal(effectId: EffectIntentId): void {
    const index = this.#terminalOrder.indexOf(effectId);
    if (index >= 0) this.#terminalOrder.splice(index, 1);
  }

  #reportFailure(
    receipt: Extract<PostCommitEffectReceipt, { readonly status: "failed" }>,
    cause: unknown,
  ): void {
    try {
      this.#onError?.(Object.freeze({ receipt, cause }));
    } catch {
      // Reporting is observational and cannot affect commit or delivery state.
    }
  }
}

function validateIdentity(
  intent: EffectIntent,
  transaction: CommittedTransaction,
): Error | undefined {
  if (
    intent.transactionId !== transaction.id ||
    intent.previousRevision !== transaction.previousRevision ||
    intent.revision !== transaction.revision
  ) {
    return new TypeError("Post-commit effect identity does not match its transaction.");
  }
  const matchingIntent = transaction.effects.find((candidate) => candidate.id === intent.id);
  if (matchingIntent === undefined) {
    return new TypeError("Post-commit effect is not present in its transaction.");
  }
  if (!sameIntent(matchingIntent, intent)) {
    return new TypeError("Post-commit effect does not match its transaction member.");
  }
  if (
    intent.kind !== "transaction-committed" ||
    intent.class !== "post-commit-idempotent" ||
    intent.ordinal < 0 ||
    !Number.isSafeInteger(intent.ordinal) ||
    intent.payload.commandType !== transaction.command.type ||
    intent.payload.origin !== transaction.origin
  ) {
    return new TypeError("Post-commit effect payload does not match its transaction.");
  }
  let expected: EffectIntent;
  try {
    expected = createTransactionCommittedEffectIntent({
      transactionId: transaction.id,
      previousRevision: transaction.previousRevision,
      revision: transaction.revision,
      ordinal: intent.ordinal,
      commandType: transaction.command.type,
      origin: transaction.origin,
    });
  } catch (cause) {
    return cause instanceof Error
      ? cause
      : new TypeError("Post-commit effect identity could not be derived.");
  }
  if (!sameIntent(intent, expected)) {
    return new TypeError("Post-commit effect does not match its deterministic identity.");
  }
  return undefined;
}

function sameIntent(left: EffectIntent, right: EffectIntent): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.class === right.class &&
    left.transactionId === right.transactionId &&
    left.previousRevision === right.previousRevision &&
    left.revision === right.revision &&
    left.ordinal === right.ordinal &&
    left.payload.commandType === right.payload.commandType &&
    left.payload.origin === right.payload.origin
  );
}

function bindingFingerprint(
  intent: EffectIntent,
  transaction: CommittedTransaction,
): string | Error {
  try {
    return canonicalSerialize({ intent, transaction });
  } catch (cause) {
    return cause instanceof Error
      ? cause
      : new TypeError("Post-commit effect transaction is not canonical serializable.");
  }
}

function fingerprintOrUndefined(value: string | Error): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pendingReceipt(intent: EffectIntent, attempt: number): PostCommitEffectReceipt {
  return Object.freeze({
    status: "pending",
    ...receiptIdentity(intent, attempt),
  });
}

function succeededReceipt(intent: EffectIntent, attempt: number): TerminalReceipt {
  return Object.freeze({
    status: "succeeded",
    ...receiptIdentity(intent, attempt),
  });
}

function failedReceipt(
  intent: EffectIntent,
  attempt: number,
  code: Exclude<PostCommitEffectFailureCode, "DELIVERY_CANCELLED">,
  retryable: boolean,
  cause: unknown,
  retainCause: boolean,
): Extract<PostCommitEffectReceipt, { readonly status: "failed" }> {
  return Object.freeze({
    status: "failed",
    ...receiptIdentity(intent, attempt),
    code,
    retryable,
    cause: retainCause ? cause : summarizeEffectCause(cause),
  });
}

function cancelledReceipt(
  intent: EffectIntent,
  attempt: number,
  cause: unknown,
): Extract<PostCommitEffectReceipt, { readonly status: "cancelled" }> {
  return Object.freeze({
    status: "cancelled",
    ...receiptIdentity(intent, attempt),
    code: "DELIVERY_CANCELLED",
    retryable: intent.class === "post-commit-idempotent",
    cause: summarizeEffectCause(cause),
  });
}

function receiptIdentity(intent: EffectIntent, attempt: number): PostCommitEffectReceiptBase {
  return {
    effectId: intent.id,
    transactionId: intent.transactionId,
    previousRevision: intent.previousRevision,
    revision: intent.revision,
    attempt,
  };
}

function summarizeEffectCause(cause: unknown): Readonly<{ name: string }> {
  return Object.freeze({
    name: cause instanceof Error && cause.name.length > 0 ? cause.name : "UnknownEffectError",
  });
}

function validatedReceiptLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_POST_COMMIT_EFFECT_RECEIPT_LIMIT;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError("postCommitEffectReceiptLimit must be a non-negative safe integer");
  }
  return resolved;
}

function validatedPendingLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_POST_COMMIT_EFFECT_PENDING_LIMIT;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError("postCommitEffectPendingLimit must be a non-negative safe integer");
  }
  return resolved;
}

function waitWithSignal(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = () => {
      if (finish()) reject(signal.reason);
    };

    // Both reactions are attached before observing an already-aborted signal,
    // containing late failures from ports that ignore cancellation.
    promise.then(
      () => {
        if (finish()) resolve();
      },
      (cause: unknown) => {
        if (finish()) reject(cause);
      },
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
