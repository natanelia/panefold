import { adaptPlanToProfile } from "./tokens";
import type {
  MotionDriver,
  MotionHandle,
  MotionKeyframes,
  MotionLease,
  MotionLeaseStatus,
  MotionPlan,
  MotionProfile,
} from "./types";

interface MotionEntry {
  readonly element: Element;
  readonly plan: MotionPlan;
  readonly lease: ManagedMotionLease;
}

export interface MotionCoordinatorOptions {
  readonly onMotionError?: (input: { readonly plan: MotionPlan; readonly cause: unknown }) => void;
}

export class MotionCoordinator {
  readonly #driver: MotionDriver;
  readonly #running = new Map<string, MotionEntry>();
  readonly #queues = new Map<string, MotionEntry[]>();
  readonly #onMotionError:
    ((input: { readonly plan: MotionPlan; readonly cause: unknown }) => void) | undefined;
  #profile: MotionProfile;

  public constructor(
    driver: MotionDriver,
    profile: MotionProfile = "productive",
    options: MotionCoordinatorOptions = {},
  ) {
    this.#driver = driver;
    this.#profile = profile;
    this.#onMotionError = options.onMotionError;
  }

  public setProfile(profile: MotionProfile): void {
    if (profile === this.#profile) return;
    this.#profile = profile;
    this.finishAll();
  }

  public play(element: Element, rawPlan: MotionPlan): MotionLease {
    let plan = adaptPlanToProfile(rawPlan, this.#profile);
    const key = this.#key(plan);
    const previous = this.#running.get(key);

    if (previous !== undefined) {
      if (plan.interruption === "ignore") return previous.lease;
      if (plan.interruption === "queue") return this.#enqueue(key, element, plan);
      this.#cancelQueue(key);
      if (plan.interruption === "finish") {
        previous.lease.finish();
      } else {
        const sampled = this.#driver.sample?.(element, Object.keys(plan.keyframes));
        if (sampled !== undefined) {
          plan = { ...plan, keyframes: retargetFromSample(sampled, plan.keyframes) };
        }
        previous.lease.cancel();
      }
    }

    const entry = this.#createEntry(key, element, plan, "running");
    this.#start(key, entry);
    return entry.lease;
  }

  public cancelScope(scopeId: string): void {
    this.#forScope(scopeId, (lease) => lease.cancel());
  }

  public skipScope(scopeId: string): void {
    this.#forScope(scopeId, (lease) => lease.skip());
  }

  /** Scope disposal is idempotent and finalizes running and queued leases. */
  public disposeScope(scopeId: string): void {
    this.#forScope(scopeId, (lease) => lease.dispose());
  }

  public cancelAll(): void {
    this.#forEveryLease((lease) => lease.cancel());
  }

  public skipAll(): void {
    this.#forEveryLease((lease) => lease.skip());
  }

  /** Profile changes settle at exact final keyframes instead of freezing mid-flight. */
  public finishAll(): void {
    this.#forEveryLease((lease) => lease.finish());
  }

  public dispose(): void {
    this.#forEveryLease((lease) => lease.dispose());
  }

  public get runningCount(): number {
    return this.#running.size;
  }

  public get queuedCount(): number {
    let count = 0;
    for (const queue of this.#queues.values()) count += queue.length;
    return count;
  }

  #key(plan: MotionPlan): string {
    return `${plan.targetId}:${plan.channel}`;
  }

  #enqueue(key: string, element: Element, plan: MotionPlan): MotionLease {
    const entry = this.#createEntry(key, element, plan, "queued");
    const queue = this.#queues.get(key) ?? [];
    queue.push(entry);
    this.#queues.set(key, queue);
    return entry.lease;
  }

  #createEntry(
    key: string,
    element: Element,
    plan: MotionPlan,
    status: "queued" | "running",
  ): MotionEntry {
    const lease = new ManagedMotionLease(
      status,
      () => applyFinalKeyframes(element, plan.keyframes),
      (terminalLease) => this.#settled(key, terminalLease),
      (cause) => this.#reportError(plan, cause),
    );
    return { element, plan, lease };
  }

  #start(key: string, entry: MotionEntry): void {
    this.#running.set(key, entry);
    let handle: MotionHandle;
    try {
      handle =
        entry.plan.durationMs === 0
          ? instantHandle(entry.element, entry.plan)
          : this.#driver.animate(entry.element, entry.plan);
    } catch (cause) {
      entry.lease.failBeforeStart(cause);
      return;
    }
    entry.lease.start(handle);
  }

  #settled(key: string, lease: ManagedMotionLease): void {
    if (this.#running.get(key)?.lease === lease) {
      this.#running.delete(key);
      this.#startNext(key);
      return;
    }
    const queue = this.#queues.get(key);
    if (queue === undefined) return;
    const next = queue.filter((entry) => entry.lease !== lease);
    if (next.length === 0) this.#queues.delete(key);
    else this.#queues.set(key, next);
  }

  #startNext(key: string): void {
    const queue = this.#queues.get(key);
    if (queue === undefined) return;
    let next: MotionEntry | undefined;
    while (queue.length > 0 && next === undefined) {
      const candidate = queue.shift();
      if (candidate?.lease.status === "queued") next = candidate;
    }
    if (queue.length === 0) this.#queues.delete(key);
    if (next !== undefined) this.#start(key, next);
  }

  #cancelQueue(key: string): void {
    const queue = this.#queues.get(key);
    if (queue === undefined) return;
    this.#queues.delete(key);
    for (const entry of queue) entry.lease.cancel();
  }

  #forScope(scopeId: string, operation: (lease: ManagedMotionLease) => void): void {
    for (const entry of this.#snapshotEntries()) {
      if (entry.plan.scopeId === scopeId) operation(entry.lease);
    }
  }

  #forEveryLease(operation: (lease: ManagedMotionLease) => void): void {
    for (const entry of this.#snapshotEntries()) operation(entry.lease);
  }

  #snapshotEntries(): readonly MotionEntry[] {
    return [
      ...this.#running.values(),
      ...[...this.#queues.values()].flatMap((queue) => [...queue]),
    ];
  }

  #reportError(plan: MotionPlan, cause: unknown): void {
    try {
      this.#onMotionError?.({ plan, cause });
    } catch {
      // Diagnostics are observational and cannot affect final visual state.
    }
  }
}

class ManagedMotionLease implements MotionLease {
  readonly #applyFinal: () => void;
  readonly #onSettled: (lease: ManagedMotionLease) => void;
  readonly #onFailure: (cause: unknown) => void;
  readonly #finished: Promise<void>;
  #resolveFinished: () => void = () => undefined;
  #handle: MotionHandle | undefined;
  #status: MotionLeaseStatus;
  #settled = false;

  public constructor(
    status: "queued" | "running",
    applyFinal: () => void,
    onSettled: (lease: ManagedMotionLease) => void,
    onFailure: (cause: unknown) => void,
  ) {
    this.#status = status;
    this.#applyFinal = applyFinal;
    this.#onSettled = onSettled;
    this.#onFailure = onFailure;
    this.#finished = new Promise<void>((resolve) => {
      this.#resolveFinished = resolve;
    });
  }

  public get finished(): Promise<void> {
    return this.#finished;
  }

  public get status(): MotionLeaseStatus {
    return this.#status;
  }

  public start(handle: MotionHandle): void {
    if (this.#settled) {
      safely(() => handle.dispose?.());
      return;
    }
    this.#status = "running";
    this.#handle = handle;
    void handle.finished.then(
      () => this.#settle("finished"),
      (cause) => {
        this.#applyFinalSafely(cause);
        this.#settle("failed");
      },
    );
  }

  public failBeforeStart(cause: unknown): void {
    if (this.#settled) return;
    this.#applyFinalSafely(cause);
    this.#settle("failed");
  }

  public cancel(): void {
    if (this.#settled) return;
    safely(
      () => this.#handle?.cancel(),
      (cause) => this.#onFailure(cause),
    );
    this.#settle("cancelled");
  }

  public finish(): void {
    if (this.#settled) return;
    if (this.#handle === undefined) this.#applyFinalSafely();
    else
      safely(
        () => this.#handle?.finish(),
        (cause) => this.#applyFinalSafely(cause),
      );
    this.#settle("finished");
  }

  public skip(): void {
    if (this.#settled) return;
    if (this.#handle?.skip !== undefined) {
      safely(
        () => this.#handle?.skip?.(),
        (cause) => this.#onFailure(cause),
      );
    } else {
      safely(
        () => this.#handle?.cancel(),
        (cause) => this.#onFailure(cause),
      );
    }
    this.#applyFinalSafely();
    this.#settle("skipped");
  }

  public dispose(): void {
    if (this.#settled) return;
    safely(
      () => this.#handle?.cancel(),
      (cause) => this.#onFailure(cause),
    );
    this.#settle("disposed");
  }

  #applyFinalSafely(cause?: unknown): void {
    if (cause !== undefined) this.#onFailure(cause);
    safely(this.#applyFinal, (applyCause) => this.#onFailure(applyCause));
  }

  #settle(status: Exclude<MotionLeaseStatus, "queued" | "running">): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#status = status;
    safely(
      () => this.#handle?.dispose?.(),
      (cause) => this.#onFailure(cause),
    );
    this.#resolveFinished();
    this.#onSettled(this);
  }
}

function instantHandle(element: Element, plan: MotionPlan): MotionHandle {
  applyFinalKeyframes(element, plan.keyframes);
  return {
    finished: Promise.resolve(),
    cancel() {},
    finish() {},
    skip() {},
    dispose() {},
  };
}

function applyFinalKeyframes(element: Element, keyframes: MotionKeyframes): void {
  if (!isStylableElement(element)) return;
  for (const [property, value] of Object.entries(keyframes)) {
    const finalValue = Array.isArray(value) ? value.at(-1) : value;
    if (finalValue !== undefined) element.style.setProperty(property, String(finalValue));
  }
}

function isStylableElement(
  element: Element,
): element is Element & { readonly style: CSSStyleDeclaration } {
  const view = element.ownerDocument?.defaultView;
  if (view === null || view === undefined) return false;
  return element instanceof view.HTMLElement || element instanceof view.SVGElement;
}

function retargetFromSample(sampled: MotionKeyframes, target: MotionKeyframes): MotionKeyframes {
  const result: Record<string, MotionKeyframes[string]> = {};
  for (const [property, value] of Object.entries(target)) {
    const start = sampled[property];
    if (start === undefined) {
      result[property] = value;
      continue;
    }
    const startValue = Array.isArray(start) ? start.at(-1) : start;
    const finalValue = Array.isArray(value) ? value.at(-1) : value;
    result[property] =
      finalValue === undefined || startValue === undefined ? value : [startValue, finalValue];
  }
  return Object.freeze(result);
}

function safely(operation: () => void, onError: (cause: unknown) => void = () => undefined): void {
  try {
    operation();
  } catch (cause) {
    onError(cause);
  }
}
