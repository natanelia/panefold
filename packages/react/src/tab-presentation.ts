import type {
  WorkspaceGroupView,
  WorkspaceProjection,
  WorkspaceTabPresentation,
  WorkspaceTabPresentationResolver,
} from "./types";

export const DEFAULT_WORKSPACE_TAB_PRESENTATION: WorkspaceTabPresentation = Object.freeze({
  placement: "block-start",
  content: "icon-and-label",
});

export function resolveTabPresentation(
  value: WorkspaceTabPresentation | WorkspaceTabPresentationResolver | undefined,
  group: WorkspaceGroupView,
  projection: WorkspaceProjection,
): WorkspaceTabPresentation {
  return value === undefined
    ? DEFAULT_WORKSPACE_TAB_PRESENTATION
    : typeof value === "function"
      ? value(group, projection)
      : value;
}

export function tabOrientation(presentation: WorkspaceTabPresentation): "horizontal" | "vertical" {
  return presentation.placement === "inline-start" || presentation.placement === "inline-end"
    ? "vertical"
    : "horizontal";
}
