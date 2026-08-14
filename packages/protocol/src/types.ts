import type { Revision } from "@panefold/model";

export type WorkspaceProtocolKind =
  | "drag"
  | "splitter-resize"
  | "floating-manipulation"
  | "keyboard-move"
  | "close"
  | "suspend-resume"
  | "surface-transfer"
  | "surface-recovery"
  | "persistence-worker"
  | "plugin-load"
  | "view-transition"
  | "coordinator-election";

export interface ProtocolIdentity {
  readonly protocolId: string;
  readonly kind: WorkspaceProtocolKind;
  readonly baseRevision: Revision;
  readonly coordinatorEpoch?: number;
  readonly transactionId?: string;
}

export type ProtocolTerminalReason =
  | "completed"
  | "cancelled"
  | "timed-out"
  | "scope-disposed"
  | "revision-conflict"
  | "capability-lost"
  | "failed-safe";

export interface ProtocolTraceEntry<State extends string = string, Event extends string = string> {
  readonly sequence: number;
  readonly protocolId: string;
  readonly state: State;
  readonly event: Event;
  readonly revision: Revision;
  readonly timestamp: number;
}

export interface ProtocolClock {
  now(): number;
}

/**
 * Injectable one-shot scheduling boundary for protocol deadlines. Implementations
 * must preserve registration order when multiple callbacks share a deadline.
 */
export interface ProtocolScheduler extends ProtocolClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ProtocolScope {
  readonly signal: AbortSignal;
  close(reason?: unknown): void;
}

export function createProtocolScope(parent?: AbortSignal): ProtocolScope {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted === true) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }
  return Object.freeze({
    signal: controller.signal,
    close(reason?: unknown) {
      controller.abort(reason);
      parent?.removeEventListener("abort", abortFromParent);
    },
  });
}
