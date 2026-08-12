import type { WorkspaceProtocolKind } from "./types";

export interface ProtocolActorDescriptor {
  readonly kind: WorkspaceProtocolKind;
  readonly actorId: string;
  readonly principalStates: readonly string[];
  readonly adversarialEvents: readonly string[];
  /** The actor layer remains an experimental, internal protocol boundary. */
  readonly stability: "experimental";
}

function descriptor(
  kind: WorkspaceProtocolKind,
  actorId: string,
  principalStates: readonly string[],
  adversarialEvents: readonly string[],
): ProtocolActorDescriptor {
  return Object.freeze({
    kind,
    actorId,
    principalStates: Object.freeze([...principalStates]),
    adversarialEvents: Object.freeze([...adversarialEvents]),
    stability: "experimental",
  });
}

/**
 * Complete public inventory of the bounded protocol actors described by the
 * system design. The catalog is descriptive: it does not keep actors alive or
 * turn protocol context into canonical workspace state.
 */
export const PROTOCOL_ACTOR_CATALOG = Object.freeze({
  drag: descriptor(
    "drag",
    "workspace-drag",
    ["idle", "armed", "dragging", "committing", "settling", "cancelling", "recovering"],
    [
      "threshold",
      "valid-target",
      "pointer-up",
      "cancel",
      "capture-loss",
      "revision-conflict",
      "re-grab",
    ],
  ),
  "splitter-resize": descriptor(
    "splitter-resize",
    "workspace-resize",
    ["idle", "armed", "resizing", "committing", "settling", "cancelling"],
    [
      "pointer-start",
      "keyboard-start",
      "constraint-result",
      "end",
      "cancel",
      "adaptive-delivery-change",
    ],
  ),
  "floating-manipulation": descriptor(
    "floating-manipulation",
    "floating-manipulation",
    ["idle", "manipulating", "snapping", "committing", "settling", "recovering"],
    ["bounds", "snap-acquisition", "snap-release", "viewport-change", "re-grab"],
  ),
  "keyboard-move": descriptor(
    "keyboard-move",
    "keyboard-move",
    ["idle", "choosing-target", "committing", "announcing", "cancelled"],
    ["arrow-navigation", "target-class-cycle", "enter", "escape", "target-invalidation"],
  ),
  close: descriptor(
    "close",
    "panel-close",
    ["open", "requested", "checking-guard", "committing-close", "visual-retirement", "disposed"],
    ["guard-allow", "guard-deny", "guard-timeout", "checkpoint", "close", "undo-preparation"],
  ),
  "suspend-resume": descriptor(
    "suspend-resume",
    "suspend-resume",
    ["mounted", "suspend-requested", "checkpointing", "suspended", "resuming", "failed"],
    [
      "visibility-policy",
      "budget-policy",
      "checkpoint-success",
      "checkpoint-failure",
      "cancel",
      "retry",
    ],
  ),
  "surface-transfer": descriptor(
    "surface-transfer",
    "surface-transfer",
    [
      "source-owned",
      "preparing",
      "bootstrapping",
      "checkpointing",
      "ownership-commit",
      "destination-mount",
      "ready",
      "source-release",
      "compensating",
    ],
    ["popup-blocked", "protocol-mismatch", "destination-close", "source-crash"],
  ),
  "surface-recovery": descriptor(
    "surface-recovery",
    "surface-recovery",
    [
      "healthy",
      "heartbeat-late",
      "disconnected",
      "orphaned",
      "resolving",
      "recovered",
      "failed-safe",
    ],
    ["heartbeat-timeout", "epoch-change", "ownership-proof", "fallback-placement"],
  ),
  "persistence-worker": descriptor(
    "persistence-worker",
    "persistence-worker",
    [
      "idle",
      "batching",
      "writing-journal",
      "checkpointing",
      "compacting",
      "degraded",
      "recovering",
    ],
    ["queue-threshold", "storage-failure", "quota", "checksum", "retry", "shutdown"],
  ),
  "plugin-load": descriptor(
    "plugin-load",
    "plugin-load",
    ["unregistered", "validating", "loading", "registering", "active", "failed", "unloading"],
    [
      "manifest-conflict",
      "version-conflict",
      "renderer-failure",
      "migration-failure",
      "scope-close",
    ],
  ),
  "view-transition": descriptor(
    "view-transition",
    "view-transition",
    [
      "eligible",
      "capturing-old",
      "committing",
      "capturing-new",
      "animating",
      "skipped",
      "completed",
    ],
    ["higher-priority-command", "unsupported", "duplicate-name", "budget-rejection"],
  ),
  "coordinator-election": descriptor(
    "coordinator-election",
    "coordinator-election",
    ["follower", "candidate", "leader", "stale", "stepping-down"],
    ["heartbeat-loss", "epoch-proposal", "conflict", "server-authority"],
  ),
} satisfies Readonly<Record<WorkspaceProtocolKind, ProtocolActorDescriptor>>);

export function protocolActorDescriptor(kind: WorkspaceProtocolKind): ProtocolActorDescriptor {
  return PROTOCOL_ACTOR_CATALOG[kind];
}
