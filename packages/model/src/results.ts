import type { CommandEnvelope, WorkspaceCommand } from "./commands";
import type { EffectIntent } from "./effects";
import {
  cloneAndFreeze,
  type ActivationState,
  type GroupRecord,
  type LayoutNode,
  type PanelRecord,
  type SurfaceRecord,
  type WorkspaceSnapshot,
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

/**
 * Takes immutable ownership of patch records while retaining payloads already
 * owned by model factories. Non-canonical caller payloads are cloned once.
 */
export function freezeWorkspacePatches(
  patches: readonly WorkspacePatch[],
): readonly WorkspacePatch[] {
  return Object.freeze(
    patches.map((patch): WorkspacePatch => {
      switch (patch.kind) {
        case "versions":
          return Object.freeze({
            kind: patch.kind,
            before: Object.freeze({ ...patch.before }),
            after: Object.freeze({ ...patch.after }),
          });
        case "panel":
        case "group":
        case "node":
        case "surface":
          return Object.freeze({
            kind: patch.kind,
            id: patch.id as never,
            ...(patch.before === undefined
              ? {}
              : { before: cloneAndFreeze(patch.before) as never }),
            ...(patch.after === undefined ? {} : { after: cloneAndFreeze(patch.after) as never }),
          }) as WorkspacePatch;
        case "activation":
        case "focus-memory":
        case "floating-order":
        case "closed-panels":
        case "remote-transactions":
        case "metadata":
          return Object.freeze({
            kind: patch.kind,
            before: cloneAndFreeze(patch.before),
            after: cloneAndFreeze(patch.after),
          }) as WorkspacePatch;
      }
    }),
  );
}

export interface CommittedTransaction {
  readonly id: CommandId;
  readonly origin: CommandEnvelope["origin"];
  readonly label: string;
  readonly previousRevision: Revision;
  readonly revision: Revision;
  readonly command: WorkspaceCommand;
  readonly patches: readonly WorkspacePatch[];
  readonly effects: readonly EffectIntent[];
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
      readonly effects: readonly EffectIntent[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly state: WorkspaceKernelState;
      readonly error: CommandRejection;
    };
