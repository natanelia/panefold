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

export type WorkspaceGroupHeaderLocation = "docked" | "floating";
export type WorkspaceGroupHeaderVariant = "tabs" | "title";

export interface ResolvedWorkspaceGroupHeaderPresentation extends WorkspaceTabPresentation {
  readonly location: WorkspaceGroupHeaderLocation;
  readonly variant: WorkspaceGroupHeaderVariant;
  readonly orientation: "horizontal" | "vertical";
}

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

/**
 * Resolves one semantic group-header treatment before DOM placement. Floating
 * single-group surfaces always use a horizontal titlebar: multiple panels keep
 * their tabs, while one panel is presented as a window title without losing
 * the canonical tab interaction element.
 */
export function resolveGroupHeaderPresentation(
  presentation: WorkspaceTabPresentation,
  options: {
    readonly floating: boolean;
    readonly panelCount: number;
  },
): ResolvedWorkspaceGroupHeaderPresentation {
  if (!options.floating) {
    return {
      ...presentation,
      location: "docked",
      variant: "tabs",
      orientation: tabOrientation(presentation),
    };
  }

  const variant: WorkspaceGroupHeaderVariant = options.panelCount === 1 ? "title" : "tabs";
  const floatingPresentation: WorkspaceTabPresentation = {
    placement: "block-start",
    content: variant === "title" ? "icon-and-label" : presentation.content,
  };
  return {
    ...floatingPresentation,
    location: "floating",
    variant,
    orientation: "horizontal",
  };
}

export function tabOrientation(presentation: WorkspaceTabPresentation): "horizontal" | "vertical" {
  return presentation.placement === "inline-start" || presentation.placement === "inline-end"
    ? "vertical"
    : "horizontal";
}
