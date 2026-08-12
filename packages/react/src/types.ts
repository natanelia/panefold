import type { ComponentType, ReactNode } from "react";

export type WorkspaceDirection = "ltr" | "rtl";
export type WorkspaceAxis = "inline" | "block";
export type WorkspaceCommandOrigin =
  | "pointer"
  | "keyboard"
  | "menu"
  | "application"
  | "restore"
  | "remote"
  | "platform"
  | "recovery"
  | "history";

export interface WorkspacePanelView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly closable?: boolean;
  readonly floatable?: boolean;
  readonly parameters?: unknown;
  readonly lifecyclePolicy?: WorkspacePanelLifecyclePolicy;
}

export interface WorkspacePanelLifecyclePolicy {
  readonly hidden: "keep-alive" | "detach" | "suspend" | "application-managed";
  readonly sameDocumentMove: "preserve-host" | "remount";
  readonly crossDocumentMove: "unsupported" | "checkpoint-remount" | "portal-coupled" | "mirror";
}

export interface WorkspaceGroupView {
  readonly id: string;
  readonly panelIds: readonly string[];
  readonly selectedPanelId: string;
  readonly label?: string;
}

export interface WorkspaceSplitView {
  readonly kind: "split";
  readonly id: string;
  readonly axis: WorkspaceAxis;
  readonly childIds: readonly string[];
  readonly weights: readonly number[];
}

export interface WorkspaceGroupNodeView {
  readonly kind: "group";
  readonly id: string;
  readonly groupId: string;
}

export type WorkspaceNodeView = WorkspaceSplitView | WorkspaceGroupNodeView;

export interface WorkspaceProjection {
  readonly revision: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, WorkspaceNodeView>>;
  readonly groups: Readonly<Record<string, WorkspaceGroupView>>;
  readonly panels: Readonly<Record<string, WorkspacePanelView>>;
  readonly activePanelId?: string;
  readonly activeSurfaceId?: string;
  readonly diagnosticCount?: number;
}

export interface WorkspacePanelRenderProps {
  readonly panel: WorkspacePanelView;
  readonly active: boolean;
  readonly selected: boolean;
  /**
   * `suspended` panels remain mounted in their stable host, but their host is
   * hidden and inert. Panel implementations should pause timers, rendering,
   * media, and remote work while suspended instead of treating this signal as
   * an instruction to discard local state.
   */
  readonly lifecycle: WorkspacePanelLifecycle;
  /** Aborted before the next lifecycle lease is delivered, and on unmount. */
  readonly lifecycleSignal: AbortSignal;
  readonly lifecyclePolicy: WorkspacePanelLifecyclePolicy;
}

export type WorkspacePanelLifecycle = "active" | "visible" | "suspended";
export type WorkspacePanelLifecycleReason =
  "mount" | "activation" | "selection" | "same-document-move" | "policy-change";

export interface WorkspacePanelLifecycleChange {
  readonly panelId: string;
  readonly revision: string;
  readonly current: WorkspacePanelLifecycle;
  readonly previous?: WorkspacePanelLifecycle;
  readonly reason: WorkspacePanelLifecycleReason;
  readonly signal: AbortSignal;
  readonly policy: WorkspacePanelLifecyclePolicy;
}

export interface WorkspacePanelDefinition {
  readonly render: ComponentType<WorkspacePanelRenderProps>;
  readonly icon?: ReactNode;
  readonly onLifecycleChange?: (change: WorkspacePanelLifecycleChange) => void;
}

export type WorkspacePanelRegistry = Readonly<Record<string, WorkspacePanelDefinition>>;

/**
 * Converts a semantic runtime snapshot into the small immutable view required
 * by the DOM renderer. It may derive indexes, but must never mutate the
 * snapshot or become a second source of workspace truth.
 */
export type WorkspaceProjector<TSnapshot> = (snapshot: TSnapshot) => WorkspaceProjection;

/**
 * The renderer deliberately receives command factories instead of learning
 * the model's wire representation. Every interaction still goes through the
 * runtime's semantic dispatch path.
 */
export interface WorkspaceCommandAdapter<TCommand> {
  readonly selectPanel: (panelId: string) => TCommand;
  readonly activatePanel: (panelId: string) => TCommand;
  readonly closePanel: (panelId: string) => TCommand;
  readonly resizeSplit: (splitId: string, weights: readonly number[]) => TCommand;
  readonly movePanel?: (panelId: string, groupId: string) => TCommand;
  readonly floatPanel?: (panelId: string) => TCommand;
}

export interface WorkspaceRuntimeLike<TSnapshot, TCommand, TResult> {
  readonly getSnapshot: () => TSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (
    command: TCommand,
    options?: {
      readonly origin?: WorkspaceCommandOrigin;
      readonly label?: string;
    },
  ) => TResult;
  readonly undo: () => TResult;
  readonly redo: () => TResult;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  readonly getTransactions?: () => readonly unknown[];
  readonly subscribeTransactions?: (listener: () => void) => () => void;
}

export interface WorkspaceAnnouncement {
  readonly id: number;
  readonly message: string;
}

export type WorkspaceDispatchStatus = "committed" | "queued" | "rejected" | "unknown";

export interface WorkspaceDispatchContext<TCommand> {
  readonly command: TCommand;
  readonly label: string;
  readonly origin: WorkspaceCommandOrigin;
}

export interface WorkspaceDispatchOutcome {
  readonly status: WorkspaceDispatchStatus;
  readonly message?: string;
}

/**
 * Interprets an application runtime's receipt without coupling the React
 * adapter to that runtime package. Unknown receipts are silent by default so
 * the renderer can never announce success it has not observed.
 */
export type WorkspaceResultInterpreter<TCommand, TResult> = (
  result: TResult,
  context: WorkspaceDispatchContext<TCommand>,
) => WorkspaceDispatchOutcome;
