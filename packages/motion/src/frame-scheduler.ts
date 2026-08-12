export type FrameRequest = (callback: FrameRequestCallback) => number;
export type FrameCancel = (handle: number) => void;

export interface SurfaceFrameSchedulerOptions {
  readonly requestFrame?: FrameRequest;
  readonly cancelFrame?: FrameCancel;
  readonly surfaceLimit?: number;
  readonly onWriteError?: (surfaceId: string, cause: unknown) => void;
}

/**
 * Coalesces raw pointer/protocol samples into one visual write per surface and
 * animation frame. Newer samples replace older pending samples.
 */
export class SurfaceFrameScheduler {
  readonly #requestFrame: FrameRequest;
  readonly #cancelFrame: FrameCancel;
  readonly #surfaceLimit: number;
  readonly #onWriteError: ((surfaceId: string, cause: unknown) => void) | undefined;
  readonly #pending = new Map<string, (timestamp: number) => void>();
  #frameHandle: number | undefined;
  #disposed = false;

  public constructor(options: SurfaceFrameSchedulerOptions = {}) {
    this.#requestFrame =
      options.requestFrame ??
      ((callback) => {
        if (typeof globalThis.requestAnimationFrame !== "function") {
          throw new Error("requestAnimationFrame is unavailable; inject requestFrame");
        }
        return globalThis.requestAnimationFrame(callback);
      });
    this.#cancelFrame =
      options.cancelFrame ??
      ((handle) => {
        globalThis.cancelAnimationFrame?.(handle);
      });
    const surfaceLimit = options.surfaceLimit ?? 64;
    if (!Number.isSafeInteger(surfaceLimit) || surfaceLimit < 0) {
      throw new RangeError("surfaceLimit must be a non-negative safe integer");
    }
    this.#surfaceLimit = surfaceLimit;
    this.#onWriteError = options.onWriteError;
  }

  public schedule(surfaceId: string, write: (timestamp: number) => void): boolean {
    if (this.#disposed) return false;
    if (!this.#pending.has(surfaceId) && this.#pending.size >= this.#surfaceLimit) return false;
    this.#pending.set(surfaceId, write);
    if (this.#frameHandle === undefined) {
      this.#frameHandle = this.#requestFrame((timestamp) => this.#flush(timestamp));
    }
    return true;
  }

  public cancel(surfaceId: string): void {
    this.#pending.delete(surfaceId);
    if (this.#pending.size === 0 && this.#frameHandle !== undefined) {
      this.#cancelFrame(this.#frameHandle);
      this.#frameHandle = undefined;
    }
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pending.clear();
    if (this.#frameHandle !== undefined) this.#cancelFrame(this.#frameHandle);
    this.#frameHandle = undefined;
  }

  public get pendingSurfaceCount(): number {
    return this.#pending.size;
  }

  #flush(timestamp: number): void {
    this.#frameHandle = undefined;
    const writes = [...this.#pending.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    this.#pending.clear();
    for (const [surfaceId, write] of writes) {
      try {
        write(timestamp);
      } catch (cause) {
        try {
          this.#onWriteError?.(surfaceId, cause);
        } catch {
          // Diagnostics are observational and cannot break later surface writes.
        }
      }
    }
  }
}
