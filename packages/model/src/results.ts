import type { CommandEnvelope, WorkspaceCommand } from "./commands";
import type {
  ActivationState,
  GroupRecord,
  LayoutNode,
  PanelRecord,
  SurfaceRecord,
  WorkspaceSnapshot,
} from "./entities";
import type { CommandId, GroupId, NodeId, PanelId, Revision, SurfaceId } from "./ids";
import type { JsonObject } from "./json";

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly details?: JsonObject;
}

export type CommandRejectionCode =
  | "REVISION_CONFLICT"
  | "ENTITY_NOT_FOUND"
  | "DUPLICATE_ENTITY"
  | "INVALID_COMMAND"
  | "CAPABILITY_DENIED"
  | "INVARIANT_VIOLATION"
  | "DUPLICATE_TRANSACTION"
  | "HISTORY_EMPTY"
  | "HISTORY_REQUIRED"
  | "UNSUPPORTED_OPERATION";

export interface CommandRejection {
  readonly code: CommandRejectionCode;
  readonly message: string;
  readonly remediation: readonly string[];
  readonly commandId: CommandId;
  readonly revision: Revision;
  readonly details?: JsonObject;
}

export type WorkspacePatch =
  | {
      readonly kind: "versions";
      readonly before: Pick<WorkspaceSnapshot, "schemaVersion" | "applicationLayoutVersion">;
      readonly after: Pick<WorkspaceSnapshot, "schemaVersion" | "applicationLayoutVersion">;
    }
  | {
      readonly kind: "panel";
      readonly id: PanelId;
      readonly before?: PanelRecord;
      readonly after?: PanelRecord;
    }
  | {
      readonly kind: "group";
      readonly id: GroupId;
      readonly before?: GroupRecord;
      readonly after?: GroupRecord;
    }
  | {
      readonly kind: "node";
      readonly id: NodeId;
      readonly before?: LayoutNode;
      readonly after?: LayoutNode;
    }
  | {
      readonly kind: "surface";
      readonly id: SurfaceId;
      readonly before?: SurfaceRecord;
      readonly after?: SurfaceRecord;
    }
  | {
      readonly kind: "activation";
      readonly before: ActivationState;
      readonly after: ActivationState;
    }
  | {
      readonly kind: "focus-memory";
      readonly before: WorkspaceSnapshot["focusMemory"];
      readonly after: WorkspaceSnapshot["focusMemory"];
    }
  | {
      readonly kind: "floating-order";
      readonly before: readonly SurfaceId[];
      readonly after: readonly SurfaceId[];
    }
  | {
      readonly kind: "closed-panels";
      readonly before: WorkspaceSnapshot["recoverableClosedPanels"];
      readonly after: WorkspaceSnapshot["recoverableClosedPanels"];
    }
  | {
      readonly kind: "remote-transactions";
      readonly before: WorkspaceSnapshot["appliedRemoteTransactions"];
      readonly after: WorkspaceSnapshot["appliedRemoteTransactions"];
    }
  | {
      readonly kind: "metadata";
      readonly before: WorkspaceSnapshot["metadata"];
      readonly after: WorkspaceSnapshot["metadata"];
    };

export type EffectIntentClass =
  "prepare" | "post-commit-idempotent" | "compensatable" | "observational";

export interface EffectIntent {
  readonly kind: string;
  readonly class: EffectIntentClass;
  readonly payload: JsonObject;
}

export interface CommittedTransaction {
  readonly id: CommandId;
  readonly origin: CommandEnvelope["origin"];
  readonly label: string;
  readonly previousRevision: Revision;
  readonly revision: Revision;
  readonly command: WorkspaceCommand;
  readonly patches: readonly WorkspacePatch[];
}

export type KernelResult =
  | {
      readonly ok: true;
      readonly next: WorkspaceSnapshot;
      readonly patches: readonly WorkspacePatch[];
      readonly inverse?: WorkspaceCommand;
      readonly effects: readonly EffectIntent[];
      readonly diagnostics: readonly Diagnostic[];
      readonly transaction: CommittedTransaction;
    }
  | {
      readonly ok: false;
      readonly error: CommandRejection;
    };

export interface WorkspaceHistoryEntry {
  readonly envelope: CommandEnvelope;
  readonly inverse: WorkspaceCommand;
}

export interface WorkspaceKernelState {
  readonly snapshot: WorkspaceSnapshot;
  readonly undoStack: readonly WorkspaceHistoryEntry[];
  readonly redoStack: readonly WorkspaceHistoryEntry[];
  readonly historyLimit: number;
}

export type KernelStateResult =
  | {
      readonly ok: true;
      readonly state: WorkspaceKernelState;
      readonly transaction: CommittedTransaction;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly state: WorkspaceKernelState;
      readonly error: CommandRejection;
    };
