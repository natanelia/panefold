import type { WorkspaceDispatchStatus } from "./types";

export type WorkspacePhysicalEdge = "left" | "right" | "above" | "below";

/** Every user-visible string emitted by the reference React projection. */
export interface WorkspaceMessageCatalog {
  workspaceLabel(): string;
  panelGroupFallback(): string;
  groupFallback(): string;
  panelFallback(): string;
  panelRenderFailed(values: { readonly title: string }): string;
  panelRenderRecovery(): string;
  retry(): string;
  resizedWorkspacePanes(): string;
  selectedPanel(values: { readonly title: string }): string;
  activatedPanel(values: { readonly title: string }): string;
  closedPanel(values: { readonly title: string }): string;
  movedPanel(values: { readonly title: string }): string;
  movedPanelTo(values: { readonly title: string; readonly group: string }): string;
  floatedPanel(values: { readonly title: string }): string;
  floatPanel(values: { readonly title: string }): string;
  moveCancelled(): string;
  workspaceRegions(): string;
  currentWorkspaceRegion(): string;
  regionOption(values: { readonly label: string; readonly panelCount: number }): string;
  resizeAdjacentPanes(): string;
  primaryPanePercent(values: { readonly percent: number }): string;
  closePanel(values: { readonly title: string }): string;
  actionsForPanel(values: { readonly title: string }): string;
  panelActions(values: { readonly title: string }): string;
  chooseDestination(): string;
  moveToGroup(values: { readonly group: string }): string;
  movePanelDialog(values: { readonly title: string }): string;
  noAvailableGroup(): string;
  moveInstructions(): string;
  missingRenderer(values: { readonly type: string }): string;
  noWorkspaceLayout(): string;
  emptyWorkspaceInstructions(): string;
  commandQueued(values: { readonly label: string }): string;
  commandRejected(values: { readonly label: string; readonly reason?: string }): string;
  resizeDidNotCommit(values: { readonly status: WorkspaceDispatchStatus }): string;
  /** Optional direct-manipulation strings; omitted methods use the English fallback. */
  splitPanel?(values: {
    readonly title: string;
    readonly edge: WorkspacePhysicalEdge;
    readonly group: string;
  }): string;
  splitEdge?(values: { readonly edge: WorkspacePhysicalEdge }): string;
  openPanelInNewWindow?(values: { readonly title: string }): string;
  openInNewWindow?(): string;
  openedPanelInNewWindow?(values: { readonly title: string }): string;
  couldNotOpenPanelInNewWindow?(values: { readonly title: string }): string;
  newWindowUnavailable?(): string;
  panelNotReadyForNewWindow?(): string;
  panelMoveCancelledNoDestination?(): string;
  panelMoveRejected?(): string;
  workspaceChangedBeforePanelMove?(): string;
  directPanelPlacementUnsupported?(): string;
  panelPlacementUnavailable?(): string;
}

export const ENGLISH_WORKSPACE_MESSAGES = Object.freeze<WorkspaceMessageCatalog>({
  workspaceLabel: () => "Workspace",
  panelGroupFallback: () => "Panel group",
  groupFallback: () => "group",
  panelFallback: () => "panel",
  panelRenderFailed: ({ title }) => `${title} could not be rendered`,
  panelRenderRecovery: () => "The workspace is still safe. Retry or close this panel.",
  retry: () => "Retry",
  resizedWorkspacePanes: () => "Resized workspace panes",
  selectedPanel: ({ title }) => `Selected ${title}`,
  activatedPanel: ({ title }) => `Activated ${title}`,
  closedPanel: ({ title }) => `Closed ${title}`,
  movedPanel: ({ title }) => `Moved ${title}`,
  movedPanelTo: ({ title, group }) => `Moved ${title} to ${group}`,
  floatedPanel: ({ title }) => `Floated ${title}`,
  floatPanel: ({ title }) => `Float ${title}`,
  moveCancelled: () => "Move cancelled",
  workspaceRegions: () => "Workspace regions",
  currentWorkspaceRegion: () => "Current workspace region",
  regionOption: ({ label, panelCount }) => `${label} · ${String(panelCount)}`,
  resizeAdjacentPanes: () => "Resize adjacent workspace panes",
  primaryPanePercent: ({ percent }) =>
    `Primary pane ${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(percent)} percent`,
  closePanel: ({ title }) => `Close ${title}`,
  actionsForPanel: ({ title }) => `Actions for ${title}`,
  panelActions: ({ title }) => `${title} actions`,
  chooseDestination: () => "Choose destination…",
  moveToGroup: ({ group }) => `Move to ${group}`,
  movePanelDialog: ({ title }) => `Move ${title}`,
  noAvailableGroup: () => "No available group",
  moveInstructions: () => "Use arrow keys to preview, Enter to move, or Escape to cancel.",
  missingRenderer: ({ type }) =>
    `Renderer ${type} is unavailable. The panel descriptor and placement remain recoverable.`,
  noWorkspaceLayout: () => "No workspace layout",
  emptyWorkspaceInstructions: () => "Open a panel or restore a workspace preset to begin.",
  commandQueued: ({ label }) => `${label} queued`,
  commandRejected: ({ label, reason }) =>
    reason === undefined ? `${label} was rejected` : `${label} was rejected. ${reason}`,
  resizeDidNotCommit: ({ status }) => `Resize did not commit (${status}).`,
  splitPanel: ({ title, edge, group }) => `Split ${title} ${edge} of ${group}`,
  splitEdge: ({ edge }) => `Split ${edge}`,
  openPanelInNewWindow: ({ title }) => `Open ${title} in a new window`,
  openInNewWindow: () => "Open in new window",
  openedPanelInNewWindow: ({ title }) => `Opened ${title} in a new window`,
  couldNotOpenPanelInNewWindow: ({ title }) => `Could not open ${title} in a new window`,
  newWindowUnavailable: () => "New window is unavailable for this workspace.",
  panelNotReadyForNewWindow: () => "The panel is not ready to move to a new window.",
  panelMoveCancelledNoDestination: () => "Panel move cancelled. No destination was selected.",
  panelMoveRejected: () => "Panel move was rejected.",
  workspaceChangedBeforePanelMove: () => "The workspace changed before the panel could be moved.",
  directPanelPlacementUnsupported: () => "This workspace does not support direct panel placement.",
  panelPlacementUnavailable: () => "The panel placement is no longer available.",
});

export interface ResolvedWorkspaceInteractionMessages {
  readonly movedPanelTo: (values: { readonly title: string; readonly group: string }) => string;
  readonly moveCancelled: () => string;
  readonly splitPanel: (values: {
    readonly title: string;
    readonly edge: WorkspacePhysicalEdge;
    readonly group: string;
  }) => string;
  readonly splitEdge: (values: { readonly edge: WorkspacePhysicalEdge }) => string;
  readonly openPanelInNewWindow: (values: { readonly title: string }) => string;
  readonly openInNewWindow: () => string;
  readonly openedPanelInNewWindow: (values: { readonly title: string }) => string;
  readonly couldNotOpenPanelInNewWindow: (values: { readonly title: string }) => string;
  readonly newWindowUnavailable: () => string;
  readonly panelNotReadyForNewWindow: () => string;
  readonly panelMoveCancelledNoDestination: () => string;
  readonly panelMoveRejected: () => string;
  readonly workspaceChangedBeforePanelMove: () => string;
  readonly directPanelPlacementUnsupported: () => string;
  readonly panelPlacementUnavailable: () => string;
}

export function resolveWorkspaceInteractionMessages(
  catalog: WorkspaceMessageCatalog,
): ResolvedWorkspaceInteractionMessages {
  return {
    movedPanelTo: catalog.movedPanelTo,
    moveCancelled: catalog.moveCancelled,
    splitPanel:
      catalog.splitPanel ?? (({ title, edge, group }) => `Split ${title} ${edge} of ${group}`),
    splitEdge: catalog.splitEdge ?? (({ edge }) => `Split ${edge}`),
    openPanelInNewWindow:
      catalog.openPanelInNewWindow ?? (({ title }) => `Open ${title} in a new window`),
    openInNewWindow: catalog.openInNewWindow ?? (() => "Open in new window"),
    openedPanelInNewWindow:
      catalog.openedPanelInNewWindow ?? (({ title }) => `Opened ${title} in a new window`),
    couldNotOpenPanelInNewWindow:
      catalog.couldNotOpenPanelInNewWindow ??
      (({ title }) => `Could not open ${title} in a new window`),
    newWindowUnavailable:
      catalog.newWindowUnavailable ?? (() => "New window is unavailable for this workspace."),
    panelNotReadyForNewWindow:
      catalog.panelNotReadyForNewWindow ??
      (() => "The panel is not ready to move to a new window."),
    panelMoveCancelledNoDestination:
      catalog.panelMoveCancelledNoDestination ??
      (() => "Panel move cancelled. No destination was selected."),
    panelMoveRejected: catalog.panelMoveRejected ?? (() => "Panel move was rejected."),
    workspaceChangedBeforePanelMove:
      catalog.workspaceChangedBeforePanelMove ??
      (() => "The workspace changed before the panel could be moved."),
    directPanelPlacementUnsupported:
      catalog.directPanelPlacementUnsupported ??
      (() => "This workspace does not support direct panel placement."),
    panelPlacementUnavailable:
      catalog.panelPlacementUnavailable ?? (() => "The panel placement is no longer available."),
  };
}
