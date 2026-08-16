import type { WorkspaceDispatchStatus } from "./types";

export type WorkspacePhysicalEdge = "left" | "right" | "above" | "below";
export type WorkspaceFloatingResizeEdge =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-right"
  | "bottom-left";

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
  /** Optional group-container strings; omitted methods use the English fallback. */
  removePanelContainer?(values: { readonly target: string }): string;
  removedPanelContainer?(values: { readonly group: string; readonly target: string }): string;
  movePanelDialog(values: { readonly title: string }): string;
  noAvailableGroup(): string;
  moveInstructions(): string;
  missingRenderer(values: { readonly type: string }): string;
  noWorkspaceLayout(): string;
  emptyWorkspaceInstructions(): string;
  emptyPanelGroupInstructions(values: { readonly group: string }): string;
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
  moveTabBefore?(values: { readonly title: string; readonly anchor: string }): string;
  moveTabAfter?(values: { readonly title: string; readonly anchor: string }): string;
  movedTabBefore?(values: { readonly title: string; readonly anchor: string }): string;
  movedTabAfter?(values: { readonly title: string; readonly anchor: string }): string;
  keptTabPosition?(values: { readonly title: string }): string;
  floatingSurface?(values: { readonly title: string }): string;
  moveFloatingSurface?(values: { readonly title: string }): string;
  movedFloatingSurface?(values: { readonly title: string }): string;
  resizeFloatingSurface?(values: {
    readonly title: string;
    readonly edge: WorkspaceFloatingResizeEdge;
  }): string;
  resizedFloatingSurface?(values: { readonly title: string }): string;
  minimizeFloatingSurface?(values: { readonly title: string }): string;
  minimizedFloatingSurface?(values: { readonly title: string }): string;
  maximizeFloatingSurface?(values: { readonly title: string }): string;
  maximizedFloatingSurface?(values: { readonly title: string }): string;
  restoreFloatingSurface?(values: { readonly title: string }): string;
  restoredFloatingSurface?(values: { readonly title: string }): string;
  redockFloatingSurface?(values: { readonly title: string }): string;
  redockedFloatingSurface?(values: { readonly title: string }): string;
  raisedFloatingSurface?(values: { readonly title: string }): string;
}

export const ENGLISH_WORKSPACE_MESSAGES = Object.freeze({
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
  removePanelContainer: ({ target }) => `Remove panel container (merge into ${target})`,
  removedPanelContainer: ({ group, target }) =>
    `Removed ${group} panel container and moved its tabs to ${target}`,
  movePanelDialog: ({ title }) => `Move ${title}`,
  noAvailableGroup: () => "No available group",
  moveInstructions: () => "Use arrow keys to preview, Enter to move, or Escape to cancel.",
  missingRenderer: ({ type }) =>
    `Renderer ${type} is unavailable. The panel descriptor and placement remain recoverable.`,
  noWorkspaceLayout: () => "No workspace layout",
  emptyWorkspaceInstructions: () => "Open a panel or restore a workspace preset to begin.",
  emptyPanelGroupInstructions: ({ group }) =>
    `${group} is empty. Drag a panel here or choose this group as a move destination.`,
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
  moveTabBefore: ({ title, anchor }) => `Move ${title} tab before ${anchor}`,
  moveTabAfter: ({ title, anchor }) => `Move ${title} tab after ${anchor}`,
  movedTabBefore: ({ title, anchor }) => `Moved ${title} tab before ${anchor}`,
  movedTabAfter: ({ title, anchor }) => `Moved ${title} tab after ${anchor}`,
  keptTabPosition: ({ title }) => `${title} tab kept in place`,
  floatingSurface: ({ title }) => `${title} floating window`,
  moveFloatingSurface: ({ title }) => `Move ${title} floating window`,
  movedFloatingSurface: ({ title }) => `Moved ${title} floating window`,
  resizeFloatingSurface: ({ title, edge }) =>
    `Resize ${title} floating window from ${floatingResizeEdgeLabel(edge)}`,
  resizedFloatingSurface: ({ title }) => `Resized ${title} floating window`,
  minimizeFloatingSurface: ({ title }) => `Minimize ${title} floating window`,
  minimizedFloatingSurface: ({ title }) => `Minimized ${title} floating window`,
  maximizeFloatingSurface: ({ title }) => `Maximize ${title} floating window`,
  maximizedFloatingSurface: ({ title }) => `Maximized ${title} floating window`,
  restoreFloatingSurface: ({ title }) => `Restore ${title} floating window`,
  restoredFloatingSurface: ({ title }) => `Restored ${title} floating window`,
  redockFloatingSurface: ({ title }) => `Dock ${title} in the workspace`,
  redockedFloatingSurface: ({ title }) => `Docked ${title} in the workspace`,
  raisedFloatingSurface: ({ title }) => `Raised ${title} floating window`,
} satisfies WorkspaceMessageCatalog);

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
  readonly moveTabBefore: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly moveTabAfter: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly movedTabBefore: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly movedTabAfter: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly keptTabPosition: (values: { readonly title: string }) => string;
  readonly floatingSurface: (values: { readonly title: string }) => string;
  readonly moveFloatingSurface: (values: { readonly title: string }) => string;
  readonly movedFloatingSurface: (values: { readonly title: string }) => string;
  readonly resizeFloatingSurface: (values: {
    readonly title: string;
    readonly edge: WorkspaceFloatingResizeEdge;
  }) => string;
  readonly resizedFloatingSurface: (values: { readonly title: string }) => string;
  readonly minimizeFloatingSurface: (values: { readonly title: string }) => string;
  readonly minimizedFloatingSurface: (values: { readonly title: string }) => string;
  readonly maximizeFloatingSurface: (values: { readonly title: string }) => string;
  readonly maximizedFloatingSurface: (values: { readonly title: string }) => string;
  readonly restoreFloatingSurface: (values: { readonly title: string }) => string;
  readonly restoredFloatingSurface: (values: { readonly title: string }) => string;
  readonly redockFloatingSurface: (values: { readonly title: string }) => string;
  readonly redockedFloatingSurface: (values: { readonly title: string }) => string;
  readonly raisedFloatingSurface: (values: { readonly title: string }) => string;
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
    moveTabBefore:
      catalog.moveTabBefore ?? (({ title, anchor }) => `Move ${title} tab before ${anchor}`),
    moveTabAfter:
      catalog.moveTabAfter ?? (({ title, anchor }) => `Move ${title} tab after ${anchor}`),
    movedTabBefore:
      catalog.movedTabBefore ?? (({ title, anchor }) => `Moved ${title} tab before ${anchor}`),
    movedTabAfter:
      catalog.movedTabAfter ?? (({ title, anchor }) => `Moved ${title} tab after ${anchor}`),
    keptTabPosition: catalog.keptTabPosition ?? (({ title }) => `${title} tab kept in place`),
    floatingSurface: catalog.floatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.floatingSurface,
    moveFloatingSurface:
      catalog.moveFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.moveFloatingSurface,
    movedFloatingSurface:
      catalog.movedFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.movedFloatingSurface,
    resizeFloatingSurface:
      catalog.resizeFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.resizeFloatingSurface,
    resizedFloatingSurface:
      catalog.resizedFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.resizedFloatingSurface,
    minimizeFloatingSurface:
      catalog.minimizeFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.minimizeFloatingSurface,
    minimizedFloatingSurface:
      catalog.minimizedFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.minimizedFloatingSurface,
    maximizeFloatingSurface:
      catalog.maximizeFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.maximizeFloatingSurface,
    maximizedFloatingSurface:
      catalog.maximizedFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.maximizedFloatingSurface,
    restoreFloatingSurface:
      catalog.restoreFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.restoreFloatingSurface,
    restoredFloatingSurface:
      catalog.restoredFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.restoredFloatingSurface,
    redockFloatingSurface:
      catalog.redockFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.redockFloatingSurface,
    redockedFloatingSurface:
      catalog.redockedFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.redockedFloatingSurface,
    raisedFloatingSurface:
      catalog.raisedFloatingSurface ?? ENGLISH_WORKSPACE_MESSAGES.raisedFloatingSurface,
  };
}

function floatingResizeEdgeLabel(edge: WorkspaceFloatingResizeEdge): string {
  return edge.replace("-", " ");
}
