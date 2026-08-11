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

export interface CommandEnvelope<C extends WorkspaceCommand = WorkspaceCommand> {
  readonly id: CommandId;
  readonly origin: CommandOrigin;
  readonly label: string;
  readonly baseRevision?: Revision;
  readonly command: C;
}

export interface OpenPanelCommand {
  readonly type: "open-panel";
  readonly panel: PanelRecord;
  readonly placement: TabPlacement;
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

export interface MaximizeSurfaceCommand {
  readonly type: "maximize-surface";
  readonly surfaceId: SurfaceId;
}

export interface RestoreSurfaceCommand {
  readonly type: "restore-surface";
  readonly surfaceId: SurfaceId;
}

export interface RedockSurfaceCommand {
  readonly type: "redock-surface";
  readonly surfaceId: SurfaceId;
  readonly target: TabPlacement;
}

export interface RestoreWorkspaceCommand {
  readonly type: "restore-workspace";
  readonly snapshot: WorkspaceSnapshot;
}

export interface UndoWorkspaceOperationCommand {
  readonly type: "undo-workspace-operation";
}

export interface RedoWorkspaceOperationCommand {
  readonly type: "redo-workspace-operation";
}

export type WorkspaceCommand =
  | OpenPanelCommand
  | ClosePanelsCommand
  | ReopenPanelCommand
  | SelectPanelCommand
  | ActivatePanelCommand
  | ReorderPanelsCommand
  | MovePanelCommand
  | SplitGroupCommand
  | MergeGroupsCommand
  | ResizeSplitCommand
  | EqualizeSplitCommand
  | CreateFloatingSurfaceCommand
  | MoveFloatingSurfaceCommand
  | ResizeFloatingSurfaceCommand
  | MaximizeSurfaceCommand
  | RestoreSurfaceCommand
  | RedockSurfaceCommand
  | RestoreWorkspaceCommand
  | UndoWorkspaceOperationCommand
  | RedoWorkspaceOperationCommand;
