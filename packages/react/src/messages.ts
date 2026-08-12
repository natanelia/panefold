import type { WorkspaceDispatchStatus } from "./types";

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
});
