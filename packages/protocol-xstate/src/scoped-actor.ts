import {
  BoundedProtocolTrace,
  createProtocolScope,
  type ProtocolClock,
  type ProtocolIdentity,
  type ProtocolScheduler,
  type ProtocolTraceEntry,
} from "@panefold/protocol";

export interface ProtocolActorSnapshot {
  readonly value: unknown;
  /** Optional lifecycle status exposed by actor implementations such as XState. */
  readonly status?: "active" | "done" | "error" | "stopped";
  readonly error?: unknown;
}

export interface ProtocolActorPort<Event> {
  start(): unknown;
  stop(): unknown;
  send(event: Event): unknown;
  getSnapshot(): ProtocolActorSnapshot;
}

export interface AddressedProtocolEvent<Event> {
  readonly identity: ProtocolIdentity;
  readonly event: Event;
}

export interface ProtocolDeadline<Event> {
  readonly afterMs: number;
  readonly event: Event;
}

export interface ScopedProtocolActorOptions<Event> {
  readonly identity: ProtocolIdentity;
  readonly actor: ProtocolActorPort<Event>;
  readonly parentSignal?: AbortSignal;
  /** Retained for compatibility when only trace timestamps need injection. */
  readonly clock?: ProtocolClock;
  /** Controls both deadline delivery and, unless `clock` is supplied, trace timestamps. */
  readonly scheduler?: ProtocolScheduler;
  /** Delivers one addressed event through `send` after the actor starts. */
  readonly deadline?: ProtocolDeadline<Event>;
  readonly traceLimit?: number;
}

const SYSTEM_SCHEDULER: ProtocolScheduler = Object.freeze({
  now: () => Date.now(),
  setTimeout(callback: () => void, delayMs: number): unknown {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
});

// Browsers and Node clamp larger delays and may fire them almost immediately.
const MAX_PROTOCOL_DEADLINE_MS = 2_147_483_647;

/**
 * Experimental ownership boundary for a sparse XState protocol actor. It
 * rejects late/misaddressed envelopes and couples actor stop to an AbortSignal
 * Scope without exposing the raw actor's lifecycle methods.
 */
export class ScopedProtocolActor<Event extends { readonly type: string }> {
  readonly #identity: ProtocolIdentity;
  readonly #actor: ProtocolActorPort<Event>;
  readonly #clock: ProtocolClock;
  readonly #scheduler: ProtocolScheduler;
  readonly #initialDeadline: ProtocolDeadline<Event> | undefined;
  readonly #trace: BoundedProtocolTrace<string, string>;
  readonly #scope;
  readonly #onScopeAbort: () => void;
  #deadlineHandle: unknown;
  #deadlineToken: object | undefined;
  #deadlinePending = false;
  #started = false;
  #stopped = false;

  public constructor(options: ScopedProtocolActorOptions<Event>) {
    this.#identity = options.identity;
    this.#actor = options.actor;
    this.#scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
    this.#clock = options.clock ?? this.#scheduler;
    this.#initialDeadline = options.deadline;
    if (this.#initialDeadline !== undefined) validateDeadline(this.#initialDeadline);
    this.#trace = new BoundedProtocolTrace(options.traceLimit);
    this.#scope = createProtocolScope(options.parentSignal);
    this.#onScopeAbort = () => this.stop(this.#scope.signal.reason);
    if (this.#scope.signal.aborted) this.stop(this.#scope.signal.reason);
    else this.#scope.signal.addEventListener("abort", this.#onScopeAbort, { once: true });
  }

  public get identity(): ProtocolIdentity {
    return this.#identity;
  }

  public get signal(): AbortSignal {
    return this.#scope.signal;
  }

  public get active(): boolean {
    return this.#started && !this.#stopped;
  }

  public start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    try {
      this.#actor.start();
      const snapshot = this.#actor.getSnapshot();
      if (isTerminalSnapshot(snapshot)) {
        this.stop(terminalReason(snapshot));
        return;
      }
      if (this.#initialDeadline !== undefined) this.#replaceDeadline(this.#initialDeadline);
    } catch (error) {
      // A failed scheduling boundary must not leave a partially started actor
      // alive without the deadline its caller required.
      this.#failClosed(error);
    }
  }

  /** Returns false for stale, foreign, or post-disposal events. */
  public send(envelope: AddressedProtocolEvent<Event>): boolean {
    if (!this.active || !sameIdentity(this.#identity, envelope.identity)) return false;
    try {
      this.#actor.send(envelope.event);
      const snapshot = this.#actor.getSnapshot();
      const state = serializeState(snapshot.value);
      this.#trace.record({
        protocolId: this.#identity.protocolId,
        state,
        event: envelope.event.type,
        revision: this.#identity.baseRevision,
        timestamp: this.#clock.now(),
      });
      if (isTerminalSnapshot(snapshot)) this.stop(terminalReason(snapshot));
      return true;
    } catch (error) {
      this.#failClosed(error);
    }
  }

  public getSnapshot(): ProtocolActorSnapshot {
    try {
      const snapshot = this.#actor.getSnapshot();
      if (this.active && isTerminalSnapshot(snapshot)) this.stop(terminalReason(snapshot));
      return snapshot;
    } catch (error) {
      this.#failClosed(error);
    }
  }

  public trace(): readonly ProtocolTraceEntry<string, string>[] {
    return this.#trace.snapshot();
  }

  /**
   * Replaces the active phase deadline with a new delay measured from this
   * call. Returns false after the actor has terminated or been disposed.
   */
  public scheduleDeadline(deadline: ProtocolDeadline<Event>): boolean {
    validateDeadline(deadline);
    if (!this.active) return false;
    try {
      this.#replaceDeadline(deadline);
      return true;
    } catch (error) {
      this.#failClosed(error);
    }
  }

  /** Cancels the active phase deadline, if any. */
  public cancelDeadline(): boolean {
    if (!this.active || !this.#deadlinePending) return false;
    try {
      this.#clearDeadline();
      return true;
    } catch (error) {
      this.#failClosed(error);
    }
  }

  public stop(reason: unknown = "scope-disposed"): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#scope.signal.removeEventListener("abort", this.#onScopeAbort);
    let failed = false;
    let failure: unknown;
    try {
      this.#clearDeadline();
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      if (this.#started) this.#actor.stop();
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
    try {
      this.#scope.close(reason);
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
    if (failed) throw failure;
  }

  #replaceDeadline(deadline: ProtocolDeadline<Event>): void {
    this.#clearDeadline();
    if (this.#stopped) return;
    const token = {};
    this.#deadlinePending = true;
    this.#deadlineToken = token;
    try {
      const handle = this.#scheduler.setTimeout(() => {
        if (!this.#deadlinePending || this.#deadlineToken !== token) return;
        this.#deadlinePending = false;
        this.#deadlineHandle = undefined;
        this.#deadlineToken = undefined;
        this.send({ identity: this.#identity, event: deadline.event });
      }, deadline.afterMs);
      // A conforming scheduler runs callbacks asynchronously. This guard also
      // keeps state correct for a test double that invokes a zero-delay callback inline.
      if (this.#deadlinePending && this.#deadlineToken === token) this.#deadlineHandle = handle;
    } catch (error) {
      if (this.#deadlineToken === token) {
        this.#deadlinePending = false;
        this.#deadlineHandle = undefined;
        this.#deadlineToken = undefined;
      }
      throw error;
    }
  }

  #clearDeadline(): void {
    if (!this.#deadlinePending) return;
    this.#deadlinePending = false;
    const handle = this.#deadlineHandle;
    this.#deadlineHandle = undefined;
    this.#deadlineToken = undefined;
    this.#scheduler.clearTimeout(handle);
  }

  #failClosed(error: unknown): never {
    try {
      this.stop(error);
    } catch {
      // Preserve the boundary failure that forced closure. `stop` has already
      // attempted deadline cleanup, raw actor stop, and scope closure independently.
    }
    throw error;
  }
}

export function createScopedProtocolActor<Event extends { readonly type: string }>(
  options: ScopedProtocolActorOptions<Event>,
): ScopedProtocolActor<Event> {
  return new ScopedProtocolActor(options);
}

function sameIdentity(expected: ProtocolIdentity, received: ProtocolIdentity): boolean {
  return (
    expected.protocolId === received.protocolId &&
    expected.kind === received.kind &&
    expected.baseRevision === received.baseRevision &&
    expected.coordinatorEpoch === received.coordinatorEpoch &&
    expected.transactionId === received.transactionId
  );
}

function serializeState(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable-state]";
  }
}

function isTerminalSnapshot(snapshot: ProtocolActorSnapshot): boolean {
  return snapshot.status === "done" || snapshot.status === "error" || snapshot.status === "stopped";
}

function terminalReason(snapshot: ProtocolActorSnapshot): unknown {
  if (snapshot.status === "error") return snapshot.error ?? "failed-safe";
  if (snapshot.status === "stopped") return "scope-disposed";
  return "completed";
}

function validateDeadline<Event>(deadline: ProtocolDeadline<Event>): void {
  if (
    !Number.isSafeInteger(deadline.afterMs) ||
    deadline.afterMs < 0 ||
    deadline.afterMs > MAX_PROTOCOL_DEADLINE_MS
  ) {
    throw new RangeError(
      `Protocol deadline afterMs must be an integer from 0 to ${String(MAX_PROTOCOL_DEADLINE_MS)}`,
    );
  }
}
