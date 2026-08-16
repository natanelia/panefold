import type { ComponentType, ReactNode } from "react";
import type { LogicalRect } from "@panefold/geometry";

export type WorkspaceDirection = "ltr" | "rtl";
export type WorkspaceAxis = "inline" | "block";
export type WorkspaceLogicalEdge = "inline-start" | "inline-end" | "block-start" | "block-end";
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

export type WorkspaceTabPlacement = "block-start" | "block-end" | "inline-start" | "inline-end";

export type WorkspaceTabContent = "icon-and-label" | "icon-only" | "label-only";

/** View-only tab chrome. Applications decide whether and how this preference is persisted. */
export interface WorkspaceTabPresentation {
  readonly placement: WorkspaceTabPlacement;
  readonly content: WorkspaceTabContent;
}

export type WorkspaceTabPresentationResolver = (
  group: WorkspaceGroupView,
  projection: WorkspaceProjection,
) => WorkspaceTabPresentation;

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

/** Coarse CSS-pixel geometry owned by the semantic floating-surface record. */
export interface WorkspaceFloatingBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Renderer projection for one same-document floating surface. Array order is
 * back-to-front z-order; browser windows use the separate prepared-transfer
 * interface and must never be projected here.
 */
export interface WorkspaceFloatingSurfaceView {
  readonly id: string;
  readonly rootNodeId: string;
  readonly bounds: WorkspaceFloatingBounds;
  readonly maximized: boolean;
  readonly minimized?: boolean;
  readonly label?: string;
}

export interface WorkspaceProjection {
  readonly revision: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, WorkspaceNodeView>>;
  readonly groups: Readonly<Record<string, WorkspaceGroupView>>;
  readonly panels: Readonly<Record<string, WorkspacePanelView>>;
  /** Same-document floating surfaces in canonical back-to-front order. */
  readonly floatingSurfaces?: readonly WorkspaceFloatingSurfaceView[];
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
  | "mount"
  | "activation"
  | "selection"
  | "same-document-move"
  | "policy-change";

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

export interface WorkspacePanelDropRequest {
  /** Projection revision whose geometry and panel context produced this request. */
  readonly revision: string;
  /** Immutable panel value from the previewed projection revision. */
  readonly panel: WorkspacePanelView;
  /** Immutable source group value from the previewed projection revision. */
  readonly sourceGroup: WorkspaceGroupView;
  /** Ordered immutable source panel values from the previewed projection revision. */
  readonly sourcePanels: readonly WorkspacePanelView[];
  /** Immutable target group value from the previewed projection revision. */
  readonly targetGroup: WorkspaceGroupView;
  /** Ordered immutable target panel values from the previewed projection revision. */
  readonly targetPanels: readonly WorkspacePanelView[];
  readonly targetNodeId: string;
  readonly target:
    | { readonly kind: "center"; readonly ratio: 1 }
    | {
        readonly kind: "edge";
        readonly edge: WorkspaceLogicalEdge;
        readonly ratio: number;
      };
}

export interface WorkspaceGroupDropRequest {
  /** Projection revision whose geometry and group context produced this request. */
  readonly revision: string;
  /** Immutable source container and ordered panels from the previewed revision. */
  readonly sourceGroup: WorkspaceGroupView;
  readonly sourcePanels: readonly WorkspacePanelView[];
  readonly sourceNodeId: string;
  /** Immutable target container and ordered panels from the previewed revision. */
  readonly targetGroup: WorkspaceGroupView;
  readonly targetPanels: readonly WorkspacePanelView[];
  readonly targetNodeId: string;
  readonly target:
    | { readonly kind: "swap" }
    | {
        readonly kind: "edge";
        readonly edge: WorkspaceLogicalEdge;
        readonly ratio: number;
      };
}

export interface WorkspaceExternalPanelPosition {
  readonly clientX: number;
  readonly clientY: number;
  readonly screenX: number;
  readonly screenY: number;
}

export interface WorkspaceExternalPanelRequest {
  readonly panel: WorkspacePanelView;
  readonly sourceGroup: WorkspaceGroupView;
  readonly sourcePanels: readonly WorkspacePanelView[];
  /** The panel's stable same-document host. The handler never needs a private DOM query. */
  readonly host: HTMLElement;
  /** Safe source-document parking supplied explicitly for prepare/rollback workflows. */
  readonly parkingElement: HTMLElement;
  /**
   * Cancels the in-flight handoff when the surface unmounts or its configured
   * request deadline expires. Long-running transfer coordinators should
   * forward this signal to every abort-aware operation they start.
   */
  readonly signal: AbortSignal;
  /**
   * Notifies the owner surface after the application has semantically redocked
   * the panel and returned its stable host to the owner document. The surface
   * restores useful panel focus and publishes the application-localized
   * message through its live region.
   */
  readonly notifyReturnedToOwner: (message: string) => void;
  readonly origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard" | "menu">;
  readonly position: WorkspaceExternalPanelPosition;
  readonly pointer?: {
    readonly pointerId: number;
    readonly pointerType: string;
  };
}

export type WorkspaceExternalPanelOutcome =
  | { readonly status: "committed"; readonly message?: string }
  | { readonly status: "rejected"; readonly message?: string };

export type WorkspaceExternalPanelHandler = (
  request: WorkspaceExternalPanelRequest,
) => WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;

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
  /** Creates one relational same-group tab reorder command. */
  readonly reorderPanel?: (
    panelId: string,
    groupId: string,
    placement: WorkspacePanelReorderPlacement,
  ) => TCommand;
  readonly movePanel?: (panelId: string, groupId: string) => TCommand;
  /** Moves every panel into an adjacent group and removes the source container atomically. */
  readonly mergeGroup?: (
    sourceGroupId: string,
    targetGroupId: string,
    selectedPanelId?: string,
  ) => TCommand;
  readonly floatPanel?: (panelId: string) => TCommand;
  /**
   * Floating-surface factories remain model-agnostic. Applications may return
   * an atomic batch that also raises the surface, applies constraints, or
   * records product-specific activation policy; React only previews disposable geometry.
   */
  readonly moveFloatingSurface?: (
    surfaceId: string,
    position: Pick<WorkspaceFloatingBounds, "x" | "y">,
  ) => TCommand;
  readonly resizeFloatingSurface?: (surfaceId: string, bounds: WorkspaceFloatingBounds) => TCommand;
  /** Should also encode application activation policy while preserving DOM focus. */
  readonly raiseFloatingSurface?: (surfaceId: string) => TCommand;
  readonly maximizeFloatingSurface?: (surfaceId: string) => TCommand;
  readonly restoreFloatingSurface?: (surfaceId: string) => TCommand;
  readonly minimizeFloatingSurface?: (surfaceId: string) => TCommand;
  /** The application owns the semantic redock destination and placement policy. */
  readonly redockFloatingSurface?: (surfaceId: string) => TCommand;
  /**
   * Pure, revision-bound direct-manipulation plan. The application owns real
   * topology, IDs, constraints, policy, and command representation. The
   * renderer retains this exact command for pointerup.
   */
  readonly planPanelDrop?: (
    request: WorkspacePanelDropRequest,
    context: WorkspacePanelDropPlanContext,
  ) => WorkspacePanelDropPlan<TCommand> | undefined;
  /**
   * Pure, revision-bound whole-container plan. A center target swaps intact
   * groups; an edge target moves the source group beside the target. The
   * application retains ownership of topology, IDs, constraints, and policy.
   */
  readonly planGroupDrop?: (
    request: WorkspaceGroupDropRequest,
    context: WorkspaceGroupDropPlanContext,
  ) => WorkspaceGroupDropPlan<TCommand> | undefined;
}

export interface WorkspacePanelDropPlanContext {
  /** Resolved root bounds of the same-document surface containing the target. */
  readonly bounds: LogicalRect;
  readonly targetRect: LogicalRect;
  readonly splitterSize: number;
}

export interface WorkspacePanelDropPlan<TCommand> {
  readonly command: TCommand;
  readonly previewRect: LogicalRect;
}

export interface WorkspaceGroupDropPlanContext {
  /** Resolved root bounds of the same-document surface containing the target. */
  readonly bounds: LogicalRect;
  readonly targetRect: LogicalRect;
  readonly splitterSize: number;
}

export interface WorkspaceGroupDropPlan<TCommand> {
  readonly command: TCommand;
  /** Exact resulting rectangle of the moved source container. */
  readonly previewRect: LogicalRect;
}

/**
 * Relational placement for one tab inside its current group. An empty value
 * means append. Applications should reject values that provide both anchors.
 */
export interface WorkspacePanelReorderPlacement {
  readonly beforePanelId?: string;
  readonly afterPanelId?: string;
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
