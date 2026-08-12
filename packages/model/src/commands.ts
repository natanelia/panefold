import type {
  CommandId,
  ClosedPanelId,
  GroupId,
  NodeId,
  PanelId,
  Revision,
  SurfaceId,
} from "./ids";
import type { LogicalEdge, PanelRecord, Rect, TabPlacement, WorkspaceSnapshot } from "./entities";

export type CommandOrigin =
  | "pointer"
  | "keyboard"
  | "menu"
  | "application"
  | "restore"
  | "remote"
  | "platform"
  | "recovery"
  | "history";

/**
 * `barrier` is reserved for structural platform transitions that cannot be
 * replayed safely from semantic state alone (for example, acquiring a browser
 * window under transient user activation). A successful barrier clears both
 * workspace-history stacks and is not itself added to undo history.
 */
export type CommandHistoryMode = "record" | "barrier";

export interface CommandEnvelope<C extends WorkspaceCommand = WorkspaceCommand> {
  readonly id: CommandId;
  readonly origin: CommandOrigin;
  readonly label: string;
  readonly baseRevision?: Revision;
  readonly history?: CommandHistoryMode;
  readonly command: C;
}

export interface OpenPanelCommand {
  readonly type: "open-panel";
  readonly panel: PanelRecord;
  readonly placement: TabPlacement;
  readonly select?: boolean;
  readonly activate?: boolean;
}

export interface DuplicatePanelCommand {
  readonly type: "duplicate-panel";
  readonly panelId: PanelId;
  readonly duplicatePanelId: PanelId;
  readonly placement?: TabPlacement;
  readonly select?: boolean;
  readonly activate?: boolean;
}

export interface ClosePanelTarget {
  readonly panelId: PanelId;
  readonly closedPanelId: ClosedPanelId;
}

export interface ClosePanelsCommand {
  readonly type: "close-panels";
  readonly targets: readonly ClosePanelTarget[];
}

/** Caller-provided close IDs keep replay deterministic and recoverable. */
export interface CloseOtherPanelsCommand {
  readonly type: "close-other-panels";
  readonly groupId: GroupId;
  readonly exceptPanelId: PanelId;
  readonly targets: readonly ClosePanelTarget[];
}

/** Closes every closable panel after the anchor in current semantic tab order. */
export interface ClosePanelsToRightCommand {
  readonly type: "close-panels-to-right";
  readonly groupId: GroupId;
  readonly panelId: PanelId;
  readonly targets: readonly ClosePanelTarget[];
}

export interface ReopenPanelCommand {
  readonly type: "reopen-panel";
  readonly closedPanelId: ClosedPanelId;
  readonly placement?: TabPlacement;
  readonly select?: boolean;
  readonly activate?: boolean;
}

export interface SelectPanelCommand {
  readonly type: "select-panel";
  readonly panelId: PanelId;
  readonly activate?: boolean;
}

export type FocusPolicy = "keep-focus" | "focus-tab" | "focus-panel-root" | "restore-descendant";

export interface ActivatePanelCommand {
  readonly type: "activate-panel";
  readonly panelId: PanelId;
  readonly focus: FocusPolicy;
}

export interface ReorderPanelsCommand {
  readonly type: "reorder-panels";
  readonly groupId: GroupId;
  readonly panelIds: readonly PanelId[];
  readonly beforePanelId?: PanelId;
  readonly afterPanelId?: PanelId;
}

export interface MovePanelCommand {
  readonly type: "move-panel";
  readonly panelId: PanelId;
  readonly target: TabPlacement;
  readonly select?: boolean;
  readonly activate?: boolean;
}

export interface MoveGroupCommand {
  readonly type: "move-group";
  readonly groupId: GroupId;
  readonly targetGroupId: GroupId;
  readonly edge: LogicalEdge;
  readonly splitNodeId: NodeId;
  readonly ratio: number;
}

export interface SwapGroupsCommand {
  readonly type: "swap-groups";
  readonly firstGroupId: GroupId;
  readonly secondGroupId: GroupId;
}

/**
 * Creates a new group beside a target group and moves the supplied panels into
 * it. IDs are supplied by the caller so replay never depends on randomness.
 */
export interface SplitGroupCommand {
  readonly type: "split-group";
  readonly targetGroupId: GroupId;
  readonly panelIds: readonly PanelId[];
  readonly newGroupId: GroupId;
  readonly newGroupNodeId: NodeId;
  readonly splitNodeId: NodeId;
  readonly edge: LogicalEdge;
  readonly ratio: number;
  readonly region?: string;
}

export interface MergeGroupsCommand {
  readonly type: "merge-groups";
  readonly sourceGroupId: GroupId;
  readonly target: TabPlacement;
}

export interface ResizeSplitCommand {
  readonly type: "resize-split";
  readonly splitNodeId: NodeId;
  readonly weights: readonly number[];
}

export interface EqualizeSplitCommand {
  readonly type: "equalize-split";
  readonly splitNodeId: NodeId;
  readonly childIds?: readonly NodeId[];
}

export interface CollapseChildCommand {
  readonly type: "collapse-child";
  readonly splitNodeId: NodeId;
  readonly childNodeId: NodeId;
  readonly reason?: string;
}

export interface RestoreCollapsedChildCommand {
  readonly type: "restore-collapsed-child";
  readonly splitNodeId: NodeId;
  readonly childNodeId: NodeId;
}

export interface CreateFloatingSurfaceCommand {
  readonly type: "create-floating-surface";
  readonly groupId: GroupId;
  readonly surfaceId: SurfaceId;
  readonly bounds: Rect;
}

export interface MoveFloatingSurfaceCommand {
  readonly type: "move-floating-surface";
  readonly surfaceId: SurfaceId;
  readonly x: number;
  readonly y: number;
}

export interface ResizeFloatingSurfaceCommand {
  readonly type: "resize-floating-surface";
  readonly surfaceId: SurfaceId;
  readonly bounds: Rect;
}

export interface RaiseSurfaceCommand {
  readonly type: "raise-surface";
  readonly surfaceId: SurfaceId;
}

export interface MaximizeSurfaceCommand {
  readonly type: "maximize-surface";
  readonly surfaceId: SurfaceId;
}

export interface RestoreSurfaceCommand {
  readonly type: "restore-surface";
  readonly surfaceId: SurfaceId;
}

export interface MinimizeSurfaceCommand {
  readonly type: "minimize-surface";
  readonly surfaceId: SurfaceId;
}

export interface TransferToBrowserWindowCommand {
  readonly type: "transfer-to-browser-window";
  readonly groupId: GroupId;
  readonly surfaceId: SurfaceId;
  readonly ownerEpoch: number;
  readonly preparedSurfaceToken: string;
  readonly bounds?: Rect;
}

export interface RedockSurfaceCommand {
  readonly type: "redock-surface";
  readonly surfaceId: SurfaceId;
  readonly target: TabPlacement;
  readonly expectedOwnerEpoch?: number;
}

export interface MoveToPictureInPictureCommand {
  readonly type: "move-to-picture-in-picture";
  readonly panelId: PanelId;
  readonly newGroupId: GroupId;
  readonly newGroupNodeId: NodeId;
  readonly surfaceId: SurfaceId;
  readonly ownerEpoch: number;
  readonly capabilityToken: string;
  readonly mode: "move";
  readonly bounds?: Rect;
}

export type WorkspaceMergeMode = "replace" | "merge";

export interface ApplyWorkspacePresetCommand {
  readonly type: "apply-workspace-preset";
  readonly presetId: string;
  readonly snapshot: WorkspaceSnapshot;
  readonly mode: WorkspaceMergeMode;
}

export interface RestoreWorkspaceCommand {
  readonly type: "restore-workspace";
  readonly snapshot: WorkspaceSnapshot;
}

export interface ImportWorkspaceCommand {
  readonly type: "import-workspace";
  /** The operational boundary must decode, migrate, and limit untrusted input first. */
  readonly snapshot: WorkspaceSnapshot;
  readonly mode: WorkspaceMergeMode;
  readonly source: string;
}

export interface ApplyRemoteTransactionCommand {
  readonly type: "apply-remote-transaction";
  readonly transactionId: string;
  readonly actorId: string;
  readonly surfaceId: SurfaceId;
  readonly ownerEpoch: number;
  readonly command: BatchableWorkspaceCommand;
}

export interface RecoverOrphanedSurfaceCommand {
  readonly type: "recover-orphaned-surface";
  readonly surfaceId: SurfaceId;
  readonly expectedOwnerEpoch: number;
  readonly targetGroupId: GroupId;
  readonly edge: LogicalEdge;
  readonly splitNodeId: NodeId;
  readonly ratio: number;
}

export interface UndoWorkspaceOperationCommand {
  readonly type: "undo-workspace-operation";
}

export interface RedoWorkspaceOperationCommand {
  readonly type: "redo-workspace-operation";
}

export interface BatchWorkspaceCommand {
  readonly type: "batch";
  readonly commands: readonly BatchableWorkspaceCommand[];
}

export type DirectWorkspaceCommand =
  | OpenPanelCommand
  | DuplicatePanelCommand
  | ClosePanelsCommand
  | CloseOtherPanelsCommand
  | ClosePanelsToRightCommand
  | ReopenPanelCommand
  | SelectPanelCommand
  | ActivatePanelCommand
  | ReorderPanelsCommand
  | MovePanelCommand
  | MoveGroupCommand
  | SwapGroupsCommand
  | SplitGroupCommand
  | MergeGroupsCommand
  | ResizeSplitCommand
  | EqualizeSplitCommand
  | CollapseChildCommand
  | RestoreCollapsedChildCommand
  | CreateFloatingSurfaceCommand
  | MoveFloatingSurfaceCommand
  | ResizeFloatingSurfaceCommand
  | RaiseSurfaceCommand
  | MaximizeSurfaceCommand
  | RestoreSurfaceCommand
  | MinimizeSurfaceCommand
  | TransferToBrowserWindowCommand
  | RedockSurfaceCommand
  | MoveToPictureInPictureCommand
  | ApplyWorkspacePresetCommand
  | RestoreWorkspaceCommand
  | ImportWorkspaceCommand
  | ApplyRemoteTransactionCommand
  | RecoverOrphanedSurfaceCommand
  | UndoWorkspaceOperationCommand
  | RedoWorkspaceOperationCommand;

export type BatchableWorkspaceCommand = Exclude<
  DirectWorkspaceCommand,
  UndoWorkspaceOperationCommand | RedoWorkspaceOperationCommand | ApplyRemoteTransactionCommand
>;

export type WorkspaceCommand = DirectWorkspaceCommand | BatchWorkspaceCommand;

/** Canonical machine-readable inventory for registries, schemas, and conformance checks. */
export const WORKSPACE_COMMAND_TYPES = [
  "batch",
  "open-panel",
  "duplicate-panel",
  "close-panels",
  "close-other-panels",
  "close-panels-to-right",
  "reopen-panel",
  "select-panel",
  "activate-panel",
  "reorder-panels",
  "move-panel",
  "move-group",
  "split-group",
  "merge-groups",
  "swap-groups",
  "resize-split",
  "equalize-split",
  "collapse-child",
  "restore-collapsed-child",
  "create-floating-surface",
  "move-floating-surface",
  "resize-floating-surface",
  "raise-surface",
  "maximize-surface",
  "restore-surface",
  "minimize-surface",
  "transfer-to-browser-window",
  "redock-surface",
  "move-to-picture-in-picture",
  "apply-workspace-preset",
  "restore-workspace",
  "import-workspace",
  "undo-workspace-operation",
  "redo-workspace-operation",
  "apply-remote-transaction",
  "recover-orphaned-surface",
] as const satisfies readonly WorkspaceCommand["type"][];

export type WorkspaceCommandType = (typeof WORKSPACE_COMMAND_TYPES)[number];

type MissingWorkspaceCommandType = Exclude<WorkspaceCommand["type"], WorkspaceCommandType>;
const COMMAND_TYPE_INVENTORY_IS_EXHAUSTIVE: MissingWorkspaceCommandType extends never
  ? true
  : never = true;
void COMMAND_TYPE_INVENTORY_IS_EXHAUSTIVE;

const WORKSPACE_COMMAND_TYPE_SET: ReadonlySet<string> = new Set(WORKSPACE_COMMAND_TYPES);

export function isWorkspaceCommandType(value: unknown): value is WorkspaceCommandType {
  return typeof value === "string" && WORKSPACE_COMMAND_TYPE_SET.has(value);
}
