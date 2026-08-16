import type { MotionHandle } from "./types";

export interface BrowserViewTransition {
  readonly ready: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition(): void;
}

export interface ViewTransitionHost {
  startViewTransition?(update: () => void | Promise<void>): BrowserViewTransition;
}

export type ViewTransitionFallbackReason =
  | "unsupported"
  | "start-failed"
  | "ready-rejected"
  | "update-rejected"
  | "finished-rejected"
  | "explicit-skip"
  | "scope-disposed";

export type ProgressiveViewTransitionStatus =
  | "capturing"
  | "animating"
  | "fallback"
  | "completed"
  | "skipped"
  | "disposed"
  | "failed";

export interface ProgressiveViewTransitionDiagnostic {
  readonly reason: ViewTransitionFallbackReason | "commit-rejected" | "fallback-failed";
  readonly cause?: unknown;
}

export interface ProgressiveViewTransitionOptions {
  readonly host: ViewTransitionHost;
  /** Semantic mutation. It is invoked exactly once even if enhancement fails. */
  readonly commit: () => void | Promise<void>;
  /** Optional FLIP or immediate visual fallback after the semantic commit. */
  readonly fallback?: (reason: ViewTransitionFallbackReason) => MotionHandle | void;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: ProgressiveViewTransitionDiagnostic) => void;
}

export interface ProgressiveViewTransitionLease {
  readonly enhancement: "view-transition" | "fallback" | "immediate";
  readonly status: ProgressiveViewTransitionStatus;
  readonly committed: Promise<void>;
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skip(): void;
  dispose(): void;
}

/**
 * Runs a View Transition strictly as progressive enhancement. Browser capture,
 * readiness, skip, and animation failures never suppress the semantic commit.
 */
export function startProgressiveViewTransition(
  options: ProgressiveViewTransitionOptions,
): ProgressiveViewTransitionLease {
  return new ProgressiveViewTransition(options);
}

class ProgressiveViewTransition implements ProgressiveViewTransitionLease {
  readonly #options: ProgressiveViewTransitionOptions;
  readonly #committedDeferred = deferred();
  readonly #readyDeferred = deferred();
  readonly #finishedDeferred = deferred();
  readonly #onAbort: () => void;
  #enhancement: ProgressiveViewTransitionLease["enhancement"] = "immediate";
  #status: ProgressiveViewTransitionStatus = "capturing";
  #transition: BrowserViewTransition | undefined;
  #fallbackHandle: MotionHandle | undefined;
  #commitStarted = false;
  #fallbackStarted = false;
  #browserTransitionSkipped = false;
  #settled = false;

  public constructor(options: ProgressiveViewTransitionOptions) {
    this.#options = options;
    this.#onAbort = () => this.dispose();
    options.signal?.addEventListener("abort", this.#onAbort, { once: true });
    this.#start();
  }

  public get enhancement(): ProgressiveViewTransitionLease["enhancement"] {
    return this.#enhancement;
  }

  public get status(): ProgressiveViewTransitionStatus {
    return this.#status;
  }

  public get committed(): Promise<void> {
    return this.#committedDeferred.promise;
  }

  public get ready(): Promise<void> {
    return this.#readyDeferred.promise;
  }

  public get finished(): Promise<void> {
    return this.#finishedDeferred.promise;
  }

  public skip(): void {
    if (this.#settled || this.#fallbackStarted) return;
    this.#status = "skipped";
    this.#skipBrowserTransition();
    this.#startFallback("explicit-skip");
  }

  public dispose(): void {
    if (this.#settled) return;
    this.#status = "disposed";
    this.#skipBrowserTransition();
    safely(() => this.#fallbackHandle?.cancel());
    safely(() => this.#fallbackHandle?.dispose?.());
    void this.#commitOnce().then(
      () => this.#settle(),
      () => {
        this.#status = "failed";
        this.#settle();
      },
    );
  }

  #start(): void {
    if (this.#options.signal?.aborted === true) {
      this.#startFallback("scope-disposed");
      return;
    }
    const start = this.#options.host.startViewTransition;
    if (start === undefined) {
      this.#startFallback("unsupported");
      return;
    }

    try {
      this.#transition = start.call(this.#options.host, () => this.#commitOnce());
      this.#enhancement = "view-transition";
    } catch (cause) {
      this.#diagnose("start-failed", cause);
      this.#startFallback("start-failed");
      return;
    }

    void this.#transition.ready.then(
      () => {
        if (this.#settled || this.#fallbackStarted) return;
        this.#status = "animating";
        this.#readyDeferred.resolve();
      },
      (cause) => {
        if (this.#settled || this.#fallbackStarted) return;
        this.#diagnose("ready-rejected", cause);
        this.#skipBrowserTransition();
        this.#startFallback("ready-rejected");
      },
    );
    void this.#transition.updateCallbackDone.catch((cause) => {
      if (this.#settled || this.#fallbackStarted) return;
      this.#diagnose("commit-rejected", cause);
      this.#startFallback("update-rejected");
    });
    void this.#transition.finished.then(
      () => {
        if (this.#settled || this.#fallbackStarted) return;
        void this.#commitOnce().then(
          () => {
            if (this.#settled || this.#fallbackStarted) return;
            this.#status = "completed";
            this.#settle();
          },
          () => {
            if (this.#settled || this.#fallbackStarted) return;
            this.#status = "failed";
            this.#settle();
          },
        );
      },
      (cause) => {
        if (this.#settled || this.#fallbackStarted) return;
        this.#diagnose("finished-rejected", cause);
        this.#startFallback("finished-rejected");
      },
    );
  }

  #commitOnce(): Promise<void> {
    if (this.#commitStarted) return this.#committedDeferred.promise;
    this.#commitStarted = true;
    Promise.resolve()
      .then(() => this.#options.commit())
      .then(
        () => this.#committedDeferred.resolve(),
        (cause) => {
          this.#committedDeferred.reject(cause);
          this.#diagnose("commit-rejected", cause);
        },
      );
    return this.#committedDeferred.promise;
  }

  #startFallback(reason: ViewTransitionFallbackReason): void {
    if (this.#fallbackStarted || this.#settled) return;
    this.#fallbackStarted = true;
    this.#enhancement = this.#options.fallback === undefined ? "immediate" : "fallback";
    this.#status = reason === "explicit-skip" ? "skipped" : "fallback";
    this.#readyDeferred.resolve();

    void this.#commitOnce().then(
      () => {
        if (this.#settled) return;
        let handle: MotionHandle | void;
        try {
          handle = this.#options.fallback?.(reason);
        } catch (cause) {
          this.#diagnose("fallback-failed", cause);
          this.#status = "failed";
          this.#settle();
          return;
        }
        if (handle === undefined) {
          this.#status = reason === "explicit-skip" ? "skipped" : "completed";
          this.#settle();
          return;
        }
        this.#fallbackHandle = handle;
        void handle.finished.then(
          () => {
            if (this.#settled) return;
            this.#status = reason === "explicit-skip" ? "skipped" : "completed";
            safely(() => handle.dispose?.());
            this.#settle();
          },
          (cause) => {
            if (this.#settled) return;
            this.#diagnose("fallback-failed", cause);
            safely(() => handle.dispose?.());
            this.#status = "failed";
            this.#settle();
          },
        );
      },
      () => {
        if (this.#settled) return;
        this.#status = "failed";
        this.#settle();
      },
    );
  }

  #skipBrowserTransition(): void {
    if (this.#browserTransitionSkipped) return;
    this.#browserTransitionSkipped = true;
    safely(() => this.#transition?.skipTransition());
  }

  #diagnose(reason: ProgressiveViewTransitionDiagnostic["reason"], cause?: unknown): void {
    try {
      this.#options.onDiagnostic?.({ reason, ...(cause === undefined ? {} : { cause }) });
    } catch {
      // Diagnostics are observational and cannot affect commit or cleanup.
    }
  }

  #settle(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#options.signal?.removeEventListener("abort", this.#onAbort);
    this.#readyDeferred.resolve();
    this.#finishedDeferred.resolve();
  }
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(cause: unknown): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Browser/driver cleanup is best-effort and must not affect semantic state.
  }
}
