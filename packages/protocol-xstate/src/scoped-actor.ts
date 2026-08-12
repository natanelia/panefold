import {
  BoundedProtocolTrace,
  createProtocolScope,
  type ProtocolClock,
  type ProtocolIdentity,
  type ProtocolTraceEntry,
} from "@panefold/protocol";

export interface ProtocolActorSnapshot {
  readonly value: unknown;
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

export interface ScopedProtocolActorOptions<Event> {
  readonly identity: ProtocolIdentity;
  readonly actor: ProtocolActorPort<Event>;
  readonly parentSignal?: AbortSignal;
  readonly clock?: ProtocolClock;
  readonly traceLimit?: number;
}

const SYSTEM_CLOCK: ProtocolClock = Object.freeze({ now: () => Date.now() });

/**
 * Experimental ownership boundary for a sparse XState protocol actor. It
 * rejects late/misaddressed envelopes and couples actor stop to an AbortSignal
 * Scope without exposing the raw actor's lifecycle methods.
 */
export class ScopedProtocolActor<Event extends { readonly type: string }> {
  readonly #identity: ProtocolIdentity;
  readonly #actor: ProtocolActorPort<Event>;
  readonly #clock: ProtocolClock;
  readonly #trace: BoundedProtocolTrace<string, string>;
  readonly #scope;
  readonly #onScopeAbort: () => void;
  #started = false;
  #stopped = false;

  public constructor(options: ScopedProtocolActorOptions<Event>) {
    this.#identity = options.identity;
    this.#actor = options.actor;
    this.#clock = options.clock ?? SYSTEM_CLOCK;
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
    this.#actor.start();
  }

  /** Returns false for stale, foreign, or post-disposal events. */
  public send(envelope: AddressedProtocolEvent<Event>): boolean {
    if (!this.active || !sameIdentity(this.#identity, envelope.identity)) return false;
    this.#actor.send(envelope.event);
    const state = serializeState(this.#actor.getSnapshot().value);
    this.#trace.record({
      protocolId: this.#identity.protocolId,
      state,
      event: envelope.event.type,
      revision: this.#identity.baseRevision,
      timestamp: this.#clock.now(),
    });
    return true;
  }

  public getSnapshot(): ProtocolActorSnapshot {
    return this.#actor.getSnapshot();
  }

  public trace(): readonly ProtocolTraceEntry<string, string>[] {
    return this.#trace.snapshot();
  }

  public stop(reason: unknown = "scope-disposed"): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#scope.signal.removeEventListener("abort", this.#onScopeAbort);
    try {
      if (this.#started) this.#actor.stop();
    } finally {
      this.#scope.close(reason);
    }
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
