import {
  nextRevision,
  type CommandEnvelope,
  type CommandRejection,
  type KernelResult,
  type KernelStateResult,
  type WorkspaceCommand,
  type WorkspaceHistoryEntry,
  type WorkspaceKernelState,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { canonicalizeWorkspace } from "./canonicalize";
import { diffSnapshots } from "./diff";
import { validateWorkspace } from "./invariants";
import { reduceWorkspace } from "./reducer";

function rejection(
  snapshot: WorkspaceSnapshot,
  envelope: CommandEnvelope,
  code: CommandRejection["code"],
  message: string,
  remediation: readonly string[],
): KernelResult {
  return {
    ok: false,
    error: {
      code,
      message,
      remediation,
      commandId: envelope.id,
      revision: snapshot.revision,
    },
  };
}

function withRevision(
  snapshot: WorkspaceSnapshot,
  revision: WorkspaceSnapshot["revision"],
): WorkspaceSnapshot {
  return Object.freeze({ ...snapshot, revision });
}

export function executeCommand(
  snapshot: WorkspaceSnapshot,
  envelope: CommandEnvelope,
): KernelResult {
  if (envelope.baseRevision !== undefined && envelope.baseRevision !== snapshot.revision) {
    return rejection(
      snapshot,
      envelope,
      "REVISION_CONFLICT",
      `Command is based on revision ${envelope.baseRevision}, but current revision is ${snapshot.revision}`,
      ["Re-read the workspace and replan the command"],
    );
  }
  if (envelope.label.trim().length === 0) {
    return rejection(
      snapshot,
      envelope,
      "INVALID_COMMAND",
      "Every semantic command requires a human-readable label",
      ["Provide a concise operation label"],
    );
  }
  if (
    envelope.command.type === "undo-workspace-operation" ||
    envelope.command.type === "redo-workspace-operation"
  ) {
    return rejection(
      snapshot,
      envelope,
      "HISTORY_REQUIRED",
      "Undo and redo require a WorkspaceKernelState",
      ["Use dispatchKernelState"],
    );
  }

  const reduced = reduceWorkspace(snapshot, envelope.command);
  if (!reduced.ok) {
    return rejection(
      snapshot,
      envelope,
      reduced.error.code,
      reduced.error.message,
      reduced.error.remediation,
    );
  }
  const canonical = canonicalizeWorkspace(reduced.snapshot);
  const violations = validateWorkspace(canonical.snapshot);
  if (violations.length > 0) {
    return rejection(
      snapshot,
      envelope,
      "INVARIANT_VIOLATION",
      `Command would violate ${violations.length} workspace invariant${violations.length === 1 ? "" : "s"}: ${violations[0]?.message ?? "unknown violation"}`,
      ["Keep the current valid workspace", "Inspect the invariant diagnostics"],
    );
  }

  const next = withRevision(canonical.snapshot, nextRevision(snapshot.revision));
  const patches = diffSnapshots(snapshot, next);
  const inverse: WorkspaceCommand = {
    type: "restore-workspace",
    snapshot,
  };
  const transaction = {
    id: envelope.id,
    origin: envelope.origin,
    label: envelope.label,
    previousRevision: snapshot.revision,
    revision: next.revision,
    command: envelope.command,
    patches,
  } as const;

  return {
    ok: true,
    next,
    patches,
    inverse,
    effects: [],
    diagnostics: [...reduced.diagnostics, ...canonical.diagnostics],
    transaction,
  };
}

function stateFailure(state: WorkspaceKernelState, result: KernelResult): KernelStateResult {
  if (result.ok) throw new TypeError("Expected a rejected kernel result");
  return { ok: false, state, error: result.error };
}

function historyEmpty(
  state: WorkspaceKernelState,
  envelope: CommandEnvelope,
  operation: "undo" | "redo",
): KernelStateResult {
  return {
    ok: false,
    state,
    error: {
      code: "HISTORY_EMPTY",
      message: `There is no workspace operation to ${operation}`,
      remediation: ["Perform a reversible workspace operation first"],
      commandId: envelope.id,
      revision: state.snapshot.revision,
    },
  };
}

function dispatchUndo(state: WorkspaceKernelState, envelope: CommandEnvelope): KernelStateResult {
  const entry = state.undoStack.at(-1);
  if (entry === undefined) return historyEmpty(state, envelope, "undo");
  const undoEnvelope: CommandEnvelope = {
    id: envelope.id,
    origin: "history",
    label: `Undo ${entry.envelope.label}`,
    baseRevision: state.snapshot.revision,
    command: entry.inverse,
  };
  const result = executeCommand(state.snapshot, undoEnvelope);
  if (!result.ok) return stateFailure(state, result);
  return {
    ok: true,
    state: Object.freeze({
      ...state,
      snapshot: result.next,
      undoStack: Object.freeze(state.undoStack.slice(0, -1)),
      redoStack: Object.freeze([...state.redoStack, entry]),
    }),
    transaction: result.transaction,
    diagnostics: result.diagnostics,
  };
}

function dispatchRedo(state: WorkspaceKernelState, envelope: CommandEnvelope): KernelStateResult {
  const entry = state.redoStack.at(-1);
  if (entry === undefined) return historyEmpty(state, envelope, "redo");
  const redoEnvelope: CommandEnvelope = {
    id: envelope.id,
    origin: "history",
    label: `Redo ${entry.envelope.label}`,
    baseRevision: state.snapshot.revision,
    command: entry.envelope.command,
  };
  const result = executeCommand(state.snapshot, redoEnvelope);
  if (!result.ok) return stateFailure(state, result);
  const inverse = result.inverse;
  if (inverse === undefined) {
    return stateFailure(
      state,
      rejection(
        state.snapshot,
        envelope,
        "UNSUPPORTED_OPERATION",
        "The redone command did not provide an inverse",
        ["Do not add it to reversible history"],
      ),
    );
  }
  const nextEntry: WorkspaceHistoryEntry = {
    envelope: entry.envelope,
    inverse,
  };
  return {
    ok: true,
    state: Object.freeze({
      ...state,
      snapshot: result.next,
      undoStack: Object.freeze([...state.undoStack, nextEntry].slice(-state.historyLimit)),
      redoStack: Object.freeze(state.redoStack.slice(0, -1)),
    }),
    transaction: result.transaction,
    diagnostics: result.diagnostics,
  };
}

export function dispatchKernelState(
  state: WorkspaceKernelState,
  envelope: CommandEnvelope,
): KernelStateResult {
  if (envelope.command.type === "undo-workspace-operation") {
    return dispatchUndo(state, envelope);
  }
  if (envelope.command.type === "redo-workspace-operation") {
    return dispatchRedo(state, envelope);
  }

  const result = executeCommand(state.snapshot, envelope);
  if (!result.ok) return stateFailure(state, result);
  const inverse = result.inverse;
  const nextUndo =
    inverse === undefined || state.historyLimit === 0
      ? state.undoStack
      : [...state.undoStack, { envelope, inverse } satisfies WorkspaceHistoryEntry].slice(
          -state.historyLimit,
        );

  return {
    ok: true,
    state: Object.freeze({
      ...state,
      snapshot: result.next,
      undoStack: Object.freeze(nextUndo),
      redoStack: Object.freeze([]),
    }),
    transaction: result.transaction,
    diagnostics: result.diagnostics,
  };
}
