import {
  dispatchKernelState,
  executeCommand,
  validateWorkspace,
  type InvariantViolation,
} from "@panefold/kernel";
import {
  commandId,
  createKernelState,
  type CommandEnvelope,
  type CommandId,
  type CommandOrigin,
  type CommittedTransaction,
  type KernelResult,
  type KernelStateResult,
  type WorkspaceCommand,
  type WorkspaceKernelState,
  type WorkspaceSnapshot,
} from "@panefold/model";

import { evaluatePolicies, type WorkspacePolicy } from "./policy";
import type { Equality, WorkspaceSelector } from "./selectors";

export interface DispatchOptions {
  readonly origin?: CommandOrigin;
  readonly label?: string;
  readonly baseRevision?: WorkspaceSnapshot["revision"];
}

export type RuntimeDispatchReceipt =
  | {
      readonly status: "committed";
      readonly commandId: CommandId;
      readonly result: Extract<KernelStateResult, { readonly ok: true }>;
    }
  | {
      readonly status: "rejected";
      readonly commandId: CommandId;
      readonly result: Extract<KernelStateResult, { readonly ok: false }>;
      /** Present when rejection came from runtime queue admission. */
      readonly runtimeCode?: RuntimeQueueRejectionCode;
    }
  | {
      readonly status: "queued";
      readonly commandId: CommandId;
    };

export interface WorkspaceRuntimeOptions {
  readonly initialSnapshot: WorkspaceSnapshot;
  readonly historyLimit?: number;
  readonly transactionLimit?: number;
  readonly notificationErrorLimit?: number;
  /** Maximum commands waiting while commit observers are being notified. */
  readonly queueLimit?: number;
  /** Maximum queued commands processed after one top-level dispatch. */
  readonly queueDrainLimit?: number;
  /** Opt-in because retained exception objects may contain application secrets. */
  readonly retainSubscriberErrorCause?: boolean;
  readonly policies?: readonly WorkspacePolicy[];
  readonly createCommandId?: () => CommandId;
  /**
   * Observes isolated subscriber failures. An exception thrown by this hook is
   * also contained because notification reporting cannot invalidate a commit.
   */
  readonly onSubscriberError?: (failure: SubscriberNotificationFailure) => void;
}

export type SubscriberChannel = "snapshot" | "transaction";

export type RuntimeQueueRejectionCode = "QUEUE_CAPACITY_EXCEEDED" | "QUEUE_DRAIN_BUDGET_EXCEEDED";

export interface SubscriberNotificationFailure {
  readonly channel: SubscriberChannel;
  readonly listenerIndex: number;
  readonly transactionId: CommandId;
  readonly revision: WorkspaceSnapshot["revision"];
  readonly cause: unknown;
}

export class InvalidInitialWorkspaceError extends Error {
  public override readonly name = "InvalidInitialWorkspaceError";

  public constructor(public readonly violations: readonly InvariantViolation[]) {
    const summary = violations
      .slice(0, 3)
      .map((violation) => `${violation.code} at ${violation.path}: ${violation.message}`)
      .join("; ");
    const remainder = Math.max(0, violations.length - 3);
    super(
      `Initial workspace violates ${String(violations.length)} invariant${
        violations.length === 1 ? "" : "s"
      }: ${summary}${remainder === 0 ? "" : `; and ${String(remainder)} more`}`,
    );
  }
}

export interface WorkspaceRuntime {
  getSnapshot(): WorkspaceSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeTransactions(listener: (transaction: CommittedTransaction) => void): () => void;
  subscribeSelector<Value>(
    selector: WorkspaceSelector<Value>,
    listener: (value: Value) => void,
    equality?: Equality<Value>,
  ): () => void;
  dispatch(command: WorkspaceCommand, options?: DispatchOptions): RuntimeDispatchReceipt;
  preview(command: WorkspaceCommand, options?: DispatchOptions): KernelResult;
  undo(): RuntimeDispatchReceipt;
  redo(): RuntimeDispatchReceipt;
  canUndo(): boolean;
  canRedo(): boolean;
  getTransactions(): readonly CommittedTransaction[];
  getSubscriberErrors(): readonly SubscriberNotificationFailure[];
  dispose(): void;
}

interface QueuedEnvelope {
  readonly envelope: CommandEnvelope;
}

const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_TRANSACTION_LIMIT = 200;
const DEFAULT_NOTIFICATION_ERROR_LIMIT = 100;
const DEFAULT_QUEUE_LIMIT = 1_000;
const DEFAULT_QUEUE_DRAIN_LIMIT = 1_000;

export function createWorkspaceRuntime(options: WorkspaceRuntimeOptions): WorkspaceRuntime {
  return new WorkspaceRuntimeImpl(options);
}

class WorkspaceRuntimeImpl implements WorkspaceRuntime {
  #state: WorkspaceKernelState;
  readonly #listeners = new Set<() => void>();
  readonly #transactionListeners = new Set<(transaction: CommittedTransaction) => void>();
  readonly #queue: QueuedEnvelope[] = [];
  readonly #transactions: CommittedTransaction[] = [];
  readonly #subscriberErrors: SubscriberNotificationFailure[] = [];
  readonly #policies: readonly WorkspacePolicy[];
  readonly #createCommandId: () => CommandId;
  readonly #onSubscriberError: ((failure: SubscriberNotificationFailure) => void) | undefined;
  readonly #transactionLimit: number;
  readonly #notificationErrorLimit: number;
  readonly #queueLimit: number;
  readonly #queueDrainLimit: number;
  readonly #retainSubscriberErrorCause: boolean;
  #queueDrainRemaining: number | undefined;
  #draining = false;
  #notifying = false;
  #disposed = false;

  public constructor(options: WorkspaceRuntimeOptions) {
    const historyLimit = validatedLimit(
      options.historyLimit,
      DEFAULT_HISTORY_LIMIT,
      "historyLimit",
    );
    this.#transactionLimit = validatedLimit(
      options.transactionLimit,
      DEFAULT_TRANSACTION_LIMIT,
      "transactionLimit",
    );
    this.#notificationErrorLimit = validatedLimit(
      options.notificationErrorLimit,
      DEFAULT_NOTIFICATION_ERROR_LIMIT,
      "notificationErrorLimit",
    );
    this.#queueLimit = validatedLimit(options.queueLimit, DEFAULT_QUEUE_LIMIT, "queueLimit");
    this.#queueDrainLimit = validatedLimit(
      options.queueDrainLimit,
      DEFAULT_QUEUE_DRAIN_LIMIT,
      "queueDrainLimit",
    );
    this.#retainSubscriberErrorCause = options.retainSubscriberErrorCause ?? false;
    const violations = validateWorkspace(options.initialSnapshot);
    if (violations.length > 0) {
      // Initial state is a trust boundary. Do not canonicalize it silently:
      // callers must consciously repair or migrate invalid input first.
      throw new InvalidInitialWorkspaceError(violations);
    }
    this.#state = createKernelState(options.initialSnapshot, historyLimit);
    this.#policies = Object.freeze([...(options.policies ?? [])]);
    this.#createCommandId = options.createCommandId ?? defaultCreateCommandId;
    this.#onSubscriberError = options.onSubscriberError;
  }

  public getSnapshot = (): WorkspaceSnapshot => this.#state.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    this.#assertLive();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  public subscribeTransactions(listener: (transaction: CommittedTransaction) => void): () => void {
    this.#assertLive();
    this.#transactionListeners.add(listener);
    return () => this.#transactionListeners.delete(listener);
  }

  public subscribeSelector<Value>(
    selector: WorkspaceSelector<Value>,
    listener: (value: Value) => void,
    equality: Equality<Value> = Object.is,
  ): () => void {
    let previous = selector(this.#state.snapshot);
    return this.subscribe(() => {
      const next = selector(this.#state.snapshot);
      if (!equality(previous, next)) {
        previous = next;
        listener(next);
      }
    });
  }

  public dispatch(
    command: WorkspaceCommand,
    options: DispatchOptions = {},
  ): RuntimeDispatchReceipt {
    this.#assertLive();
    const envelope = this.#envelope(command, options);
    if (this.#notifying) {
      return this.#enqueue(envelope);
    }

    this.#queueDrainRemaining = this.#queueDrainLimit;
    try {
      const receipt = this.#apply(envelope);
      this.#drainQueue();
      return receipt;
    } finally {
      if (!this.#draining) {
        this.#queueDrainRemaining = undefined;
      }
    }
  }

  public preview(command: WorkspaceCommand, options: DispatchOptions = {}): KernelResult {
    this.#assertLive();
    const envelope = this.#envelope(command, options);
    const policy = evaluatePolicies(this.#state.snapshot, envelope, this.#policies);
    if (!policy.ok) {
      return { ok: false, error: policy.error };
    }
    return executeCommand(this.#state.snapshot, { ...envelope, command: policy.command });
  }

  public undo(): RuntimeDispatchReceipt {
    return this.dispatch(
      { type: "undo-workspace-operation" },
      { origin: "history", label: "Undo workspace operation" },
    );
  }

  public redo(): RuntimeDispatchReceipt {
    return this.dispatch(
      { type: "redo-workspace-operation" },
      { origin: "history", label: "Redo workspace operation" },
    );
  }

  public canUndo(): boolean {
    return this.#state.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.#state.redoStack.length > 0;
  }

  public getTransactions(): readonly CommittedTransaction[] {
    return Object.freeze([...this.#transactions]);
  }

  public getSubscriberErrors(): readonly SubscriberNotificationFailure[] {
    return Object.freeze([...this.#subscriberErrors]);
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#listeners.clear();
    this.#transactionListeners.clear();
    this.#subscriberErrors.length = 0;
    this.#queue.length = 0;
    this.#queueDrainRemaining = 0;
  }

  #envelope(command: WorkspaceCommand, options: DispatchOptions): CommandEnvelope {
    const baseRevision = options.baseRevision;
    return {
      id: this.#createCommandId(),
      origin: options.origin ?? "application",
      label: options.label ?? labelForCommand(command),
      ...(baseRevision === undefined ? {} : { baseRevision }),
      command,
    };
  }

  #apply(rawEnvelope: CommandEnvelope): RuntimeDispatchReceipt {
    const policy = evaluatePolicies(this.#state.snapshot, rawEnvelope, this.#policies);
    if (!policy.ok) {
      const result: Extract<KernelStateResult, { readonly ok: false }> = {
        ok: false,
        state: this.#state,
        error: policy.error,
      };
      return { status: "rejected", commandId: rawEnvelope.id, result };
    }

    const envelope: CommandEnvelope = { ...rawEnvelope, command: policy.command };
    const result = dispatchKernelState(this.#state, envelope);
    if (!result.ok) {
      return { status: "rejected", commandId: envelope.id, result };
    }

    this.#state = result.state;
    this.#transactions.push(result.transaction);
    if (this.#transactions.length > this.#transactionLimit) {
      this.#transactions.splice(0, this.#transactions.length - this.#transactionLimit);
    }

    this.#notifySubscribers(result.transaction);
    return { status: "committed", commandId: envelope.id, result };
  }

  #enqueue(envelope: CommandEnvelope): RuntimeDispatchReceipt {
    if (this.#queue.length >= this.#queueLimit) {
      return this.#queueRejection(envelope, "QUEUE_CAPACITY_EXCEEDED", this.#queueLimit);
    }

    const remaining = this.#queueDrainRemaining ?? 0;
    if (this.#queue.length >= remaining) {
      return this.#queueRejection(envelope, "QUEUE_DRAIN_BUDGET_EXCEEDED", this.#queueDrainLimit);
    }

    this.#queue.push({ envelope });
    return { status: "queued", commandId: envelope.id };
  }

  #queueRejection(
    envelope: CommandEnvelope,
    reason: RuntimeQueueRejectionCode,
    limit: number,
  ): Extract<RuntimeDispatchReceipt, { readonly status: "rejected" }> {
    const capacity = reason === "QUEUE_CAPACITY_EXCEEDED";
    const result: Extract<KernelStateResult, { readonly ok: false }> = {
      ok: false,
      state: this.#state,
      error: {
        code: "INVALID_COMMAND",
        message: capacity
          ? `Reentrant command queue capacity ${String(limit)} was exceeded.`
          : `Reentrant drain budget ${String(limit)} was exceeded.`,
        remediation: capacity
          ? ["Reduce commands dispatched by one notification", "Increase queueLimit deliberately"]
          : [
              "Stop dispatching an endless command chain from subscribers",
              "Increase queueDrainLimit deliberately",
            ],
        commandId: envelope.id,
        revision: this.#state.snapshot.revision,
        details: { runtimeCode: reason, limit },
      },
    };
    return { status: "rejected", commandId: envelope.id, result, runtimeCode: reason };
  }

  /**
   * A semantic commit is final before observers run. Notification therefore
   * follows a fail-safe policy: snapshot both listener sets, call every
   * listener in insertion order, isolate each exception, report failures, then
   * drain commands queued by any listener. Subscriber code can never turn an
   * accepted transaction into an apparent dispatch failure.
   */
  #notifySubscribers(transaction: CommittedTransaction): void {
    const snapshotListeners = [...this.#listeners];
    const transactionListeners = [...this.#transactionListeners];
    const failures: SubscriberNotificationFailure[] = [];

    this.#notifying = true;
    try {
      for (const [listenerIndex, listener] of snapshotListeners.entries()) {
        if (this.#disposed) break;
        try {
          listener();
        } catch (cause) {
          failures.push({
            channel: "snapshot",
            listenerIndex,
            transactionId: transaction.id,
            revision: transaction.revision,
            cause,
          });
        }
      }
      for (const [listenerIndex, listener] of transactionListeners.entries()) {
        if (this.#disposed) break;
        try {
          listener(transaction);
        } catch (cause) {
          failures.push({
            channel: "transaction",
            listenerIndex,
            transactionId: transaction.id,
            revision: transaction.revision,
            cause,
          });
        }
      }

      for (const failure of failures) {
        if (this.#disposed) break;
        this.#recordSubscriberFailure(failure);
      }
    } finally {
      this.#notifying = false;
    }
  }

  #recordSubscriberFailure(failure: SubscriberNotificationFailure): void {
    if (this.#notificationErrorLimit > 0) {
      this.#subscriberErrors.push(
        Object.freeze({
          ...failure,
          cause: this.#retainSubscriberErrorCause
            ? failure.cause
            : summarizeSubscriberCause(failure.cause),
        }),
      );
      if (this.#subscriberErrors.length > this.#notificationErrorLimit) {
        this.#subscriberErrors.splice(
          0,
          this.#subscriberErrors.length - this.#notificationErrorLimit,
        );
      }
    }

    try {
      this.#onSubscriberError?.(failure);
    } catch {
      // Error reporting is observational. A faulty reporting hook cannot
      // affect commit success, later observers, or queued-command progress.
    }
  }

  #drainQueue(): void {
    if (this.#draining || this.#notifying || this.#disposed) return;

    this.#draining = true;
    try {
      while (this.#queue.length > 0 && !this.#disposed) {
        const remaining = this.#queueDrainRemaining ?? 0;
        if (remaining === 0) {
          // Enqueue admission reserves drain budget, so this branch is only a
          // defensive safeguard against future internal changes.
          this.#queue.length = 0;
          break;
        }
        const next = this.#queue.shift();
        if (next !== undefined) {
          this.#queueDrainRemaining = remaining - 1;
          this.#apply(next.envelope);
        }
      }
    } finally {
      this.#draining = false;
      this.#queueDrainRemaining = undefined;
    }
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error("Workspace runtime has been disposed.");
    }
  }
}

function summarizeSubscriberCause(cause: unknown): Readonly<{ name: string }> {
  return Object.freeze({
    name: cause instanceof Error && cause.name.length > 0 ? cause.name : "UnknownSubscriberError",
  });
}

function validatedLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function defaultCreateCommandId(): CommandId {
  return commandId(`cmd_${globalThis.crypto.randomUUID()}`);
}

function labelForCommand(command: WorkspaceCommand): string {
  return command.type
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
