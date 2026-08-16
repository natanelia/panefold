from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, expected: int | None = None) -> None:
    content = read(path)
    count = content.count(old)
    if expected is not None and count != expected:
        raise RuntimeError(f"Expected {expected} matches in {path}, found {count}: {old!r}")
    if count == 0:
        raise RuntimeError(f"Expected at least one match in {path}: {old!r}")
    write(path, content.replace(old, new))


write(
    "packages/react/src/tab-presentation.ts",
    '''import type {
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
''',
)

replace_once(
    "packages/react/src/messages.ts",
    '  floatPanel(values: { readonly title: string }): string;\n  moveCancelled(): string;',
    '  floatPanel(values: { readonly title: string }): string;\n  /** Optional visual discovery hint for collapsed single-panel chrome. */\n  dragPanelToMove?(values: { readonly title: string }): string;\n  moveCancelled(): string;',
)
replace_once(
    "packages/react/src/messages.ts",
    '  floatPanel: ({ title }) => `Float ${title}`,\n  moveCancelled: () => "Move cancelled",',
    '  floatPanel: ({ title }) => `Float ${title}`,\n  dragPanelToMove: ({ title }) => `Drag to move ${title}`,\n  moveCancelled: () => "Move cancelled",',
)
replace_once(
    "packages/react/src/messages.ts",
    '  readonly movedPanelTo: (values: { readonly title: string; readonly group: string }) => string;\n  readonly moveCancelled: () => string;',
    '  readonly movedPanelTo: (values: { readonly title: string; readonly group: string }) => string;\n  readonly dragPanelToMove: (values: { readonly title: string }) => string;\n  readonly moveCancelled: () => string;',
)
replace_once(
    "packages/react/src/messages.ts",
    '    movedPanelTo: catalog.movedPanelTo,\n    moveCancelled: catalog.moveCancelled,',
    '    movedPanelTo: catalog.movedPanelTo,\n    dragPanelToMove: catalog.dragPanelToMove ?? ENGLISH_WORKSPACE_MESSAGES.dragPanelToMove,\n    moveCancelled: catalog.moveCancelled,',
)

replace_all(
    "packages/react/src/floating-surface.tsx",
    "compactGroupId",
    "headerGroupId",
)
replace_all(
    "packages/react/src/floating-surface.tsx",
    "compactHeader",
    "integratedHeader",
)
replace_all(
    "packages/react/src/floating-surface.tsx",
    "data-compact-header",
    "data-integrated-header",
)
replace_once(
    "packages/react/src/floating-surface.tsx",
    "/** Resolves the titlebar portal owned by a compact single-group floating frame. */",
    "/** Resolves the titlebar portal owned by a single-group floating frame. */",
)
replace_once(
    "packages/react/src/floating-surface.tsx",
    "  const integratedHeader = headerGroupId !== undefined && !minimized;",
    "  const integratedHeader = headerGroupId !== undefined;",
)
replace_once(
    "packages/react/src/floating-surface.tsx",
    '''          {integratedHeader ? (
            <>
              <div ref={setHeaderSlotTarget} className="pf-floating-header-slot" />
              <span className="pf-floating-header-drag-region" aria-hidden="true" />
            </>
          ) : null}''',
    '''          {integratedHeader ? (
            <div ref={setHeaderSlotTarget} className="pf-floating-header-slot" />
          ) : null}
          <span
            className="pf-floating-header-drag-region"
            data-drag-tooltip={messages.moveFloatingSurface({ title })}
            aria-hidden="true"
          >
            <span className="pf-floating-header-drag-grip" />
          </span>''',
)
replace_once(
    "packages/react/src/floating-surface.tsx",
    '        {minimized ? null : <div className="pf-floating-content">{children}</div>}',
    '        <div className="pf-floating-content" hidden={minimized}>\n          {children}\n        </div>',
)

replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    'import { resolveTabPresentation, tabOrientation } from "./tab-presentation";',
    '''import {
  resolveGroupHeaderPresentation,
  resolveTabPresentation,
} from "./tab-presentation";''',
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    '''  const presentation = resolveTabPresentation(tabPresentation, group, projection);
  const orientation =
    floatingHeaderTarget === undefined ? tabOrientation(presentation) : "horizontal";''',
    '''  const presentation = resolveTabPresentation(tabPresentation, group, projection);
  const headerPresentation = resolveGroupHeaderPresentation(presentation, {
    floating: floatingHeaderTarget !== undefined,
    panelCount: groupPanels.length,
  });
  const orientation = headerPresentation.orientation;''',
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    '''      data-tab-placement={presentation.placement}
      data-tab-content={presentation.content}
      data-tab-orientation={orientation}''',
    '''      data-tab-placement={headerPresentation.placement}
      data-tab-content={headerPresentation.content}
      data-tab-orientation={orientation}
      data-header-location={headerPresentation.location}
      data-header-variant={headerPresentation.variant}''',
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    '        <div className="pf-tab-strip">',
    '''        <div
          className="pf-tab-strip"
          data-header-location={headerPresentation.location}
          data-header-variant={headerPresentation.variant}
          data-single-panel={String(groupPanels.length === 1)}
        >''',
)
replace_all(
    "packages/react/src/WorkspaceSurface.tsx",
    "presentation.content",
    "headerPresentation.content",
    expected=2,
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    '''          )}
        </div>,
        floatingHeaderTarget,''',
    '''          )}
          {headerPresentation.location === "docked" &&
          groupPanels.length === 1 &&
          selectedPanel !== undefined ? (
            <span
              className="pf-single-tab-drag-affordance"
              data-workspace-panel-drag-affordance={selectedPanel.id}
              data-tooltip={interactionMessages.dragPanelToMove({
                title: selectedPanel.title,
              })}
              aria-hidden="true"
            />
          ) : null}
        </div>,
        floatingHeaderTarget,''',
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    "            const compactGroupId = singlePanelFloatingGroupId(surface, projection);",
    "            const headerGroupId = floatingSurfaceHeaderGroupId(surface, projection);",
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    "                {...(compactGroupId === undefined ? {} : { compactGroupId })}",
    "                {...(headerGroupId === undefined ? {} : { headerGroupId })}",
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    "                {surface.minimized === true || floatingNode === undefined ? null : (",
    "                {floatingNode === undefined ? null : (",
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    '''/**
 * Undefined keeps the strip inline, null hides it while the compact-header ref
 * resolves, and an element receives the existing strip through a portal.
 */''',
    '''/**
 * Undefined keeps the strip inline, null hides it while the floating-header
 * ref resolves, and an element receives the existing strip through a portal.
 */''',
)
replace_once(
    "packages/react/src/WorkspaceSurface.tsx",
    '''function singlePanelFloatingGroupId(
  surface: WorkspaceFloatingSurfaceView,
  projection: WorkspaceProjection,
): string | undefined {
  const groups = orderedGroups(projection, surface.rootNodeId, false);
  const group = groups.length === 1 ? groups[0] : undefined;
  const panelId = group?.panelIds.length === 1 ? group.panelIds[0] : undefined;
  return group !== undefined && panelId !== undefined && projection.panels[panelId] !== undefined
    ? group.id
    : undefined;
}''',
    '''function floatingSurfaceHeaderGroupId(
  surface: WorkspaceFloatingSurfaceView,
  projection: WorkspaceProjection,
): string | undefined {
  const groups = orderedGroups(projection, surface.rootNodeId, false);
  const group = groups.length === 1 ? groups[0] : undefined;
  return group !== undefined &&
    group.panelIds.length > 0 &&
    group.panelIds.every((panelId) => projection.panels[panelId] !== undefined)
    ? group.id
    : undefined;
}''',
)

replace_once(
    "packages/react/src/styles.css",
    '''  .pf-floating-titlebar[tabindex="0"] {
    cursor: move;
  }

  .pf-floating-titlebar:focus-visible {
    box-shadow: inset 0 0 0 2px var(--pf-focus);
  }

  .pf-floating-titlebar[data-compact-header="true"] {
    gap: 0;
    padding-inline-start: 0;
  }

  .pf-floating-header-slot {
    display: flex;
    flex: 0 1 180px;
    align-self: stretch;
    min-inline-size: 0;
  }

  .pf-floating-header-drag-region {
    flex: 1 1 auto;
    align-self: stretch;
    min-inline-size: 12px;
  }

  .pf-floating-header-slot .pf-tab-strip {
    flex: 1 1 auto;
    min-inline-size: 0;
    border-block-end: 0;
    background: transparent;
  }

  .pf-floating-header-slot .pf-tab-list {
    overflow: hidden;
  }

  .pf-floating-header-slot .pf-tab {
    flex: 1 1 auto;
    min-inline-size: 0;
  }

  .pf-floating-header-slot .pf-tab-controls {
    background: transparent;
  }''',
    '''  .pf-floating-titlebar {
    transition: background-color var(--pf-motion-micro);
  }

  .pf-floating-titlebar[tabindex="0"] {
    cursor: grab;
  }

  .pf-floating-titlebar[tabindex="0"]:active {
    cursor: grabbing;
  }

  .pf-floating-titlebar:hover {
    background: color-mix(in srgb, var(--pf-surface-soft) 62%, var(--pf-surface-raised));
  }

  .pf-floating-surface:has(> .pf-floating-titlebar:hover) {
    border-color: color-mix(in srgb, var(--pf-accent) 72%, var(--pf-border-strong));
  }

  .pf-floating-titlebar:focus-visible {
    box-shadow: inset 0 0 0 2px var(--pf-focus);
  }

  .pf-floating-titlebar[data-integrated-header="true"] {
    gap: 0;
    padding-inline-start: 0;
  }

  .pf-floating-header-slot {
    display: flex;
    flex: 1 1 auto;
    align-self: stretch;
    min-inline-size: 0;
    overflow: hidden;
  }

  .pf-floating-header-drag-region {
    position: relative;
    display: grid;
    flex: 0 1 44px;
    place-items: center;
    align-self: stretch;
    min-inline-size: 24px;
    color: var(--pf-text-muted);
    cursor: grab;
  }

  .pf-floating-header-drag-region:active {
    cursor: grabbing;
  }

  .pf-floating-header-drag-grip {
    inline-size: 15px;
    block-size: 10px;
    opacity: 0.38;
    background: radial-gradient(circle, currentColor 1.15px, transparent 1.35px) 0 0 / 5px 5px;
    transition: opacity var(--pf-motion-micro);
  }

  .pf-floating-header-drag-region:hover .pf-floating-header-drag-grip,
  .pf-floating-header-drag-region:active .pf-floating-header-drag-grip {
    opacity: 0.9;
  }

  .pf-floating-header-drag-region::after {
    content: attr(data-drag-tooltip);
    position: absolute;
    inset-block-start: calc(100% + 7px);
    inset-inline-end: 0;
    z-index: 40;
    inline-size: max-content;
    max-inline-size: 240px;
    padding: 6px 8px;
    border: 1px solid var(--pf-border-strong);
    border-radius: 5px;
    color: var(--pf-text);
    background: var(--pf-surface-raised);
    box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
    font-size: 10px;
    line-height: 1.3;
    opacity: 0;
    pointer-events: none;
    translate: 0 -2px;
    transition:
      opacity var(--pf-motion-micro) 0ms,
      translate var(--pf-motion-micro) 0ms;
  }

  @media (hover: hover) and (pointer: fine) {
    .pf-floating-header-drag-region:hover::after {
      opacity: 1;
      translate: 0 0;
      transition-delay: 700ms;
    }
  }

  .pf-floating-header-slot .pf-tab-strip {
    flex: 1 1 auto;
    min-inline-size: 0;
    border-block-end: 0;
    background: transparent;
  }

  .pf-floating-header-slot .pf-tab-list {
    min-inline-size: 0;
    overflow: hidden;
  }

  .pf-floating-header-slot .pf-tab-strip[data-header-variant="tabs"] .pf-tab {
    flex: 0 1 160px;
    min-inline-size: 72px;
  }

  .pf-floating-header-slot .pf-tab-strip[data-header-variant="title"] .pf-tab {
    flex: 0 1 auto;
    min-inline-size: 0;
    padding-inline: 10px 30px;
    border: 0;
    color: var(--pf-text);
    background: transparent;
    font-weight: 600;
  }

  .pf-floating-header-slot
    .pf-tab-strip[data-header-variant="title"]
    .pf-tab[aria-selected="true"] {
    border: 0;
    color: var(--pf-text);
    background: transparent;
  }

  .pf-floating-header-slot .pf-tab-strip[data-header-variant="title"] .pf-tab-icon {
    color: var(--pf-text-muted);
  }

  .pf-floating-header-slot .pf-tab-controls {
    background: transparent;
  }

  .pf-floating-header-slot .pf-group-drag-region {
    position: relative;
    flex: 0 0 22px;
    min-inline-size: 22px;
    min-block-size: 100%;
  }

  .pf-floating-header-slot .pf-group-drag-region::before {
    content: "";
    position: absolute;
    inset: 50% auto auto 50%;
    inline-size: 3px;
    block-size: 14px;
    border-radius: 999px;
    background: var(--pf-border-strong);
    opacity: 0.5;
    translate: -50% -50%;
  }''',
)
replace_once(
    "packages/react/src/styles.css",
    '''  .pf-tab-strip {
    display: flex;
    flex: 0 0 var(--pf-tab-size);
    min-inline-size: 0;
    background: var(--pf-surface-raised);
    border-block-end: 1px solid var(--pf-border);
  }''',
    '''  .pf-tab-strip {
    position: relative;
    display: flex;
    flex: 0 0 var(--pf-tab-size);
    min-inline-size: 0;
    background: var(--pf-surface-raised);
    border-block-end: 1px solid var(--pf-border);
  }

  .pf-single-tab-drag-affordance {
    display: none;
  }''',
)

write(
    "packages/react/src/hide-single-tab-row.css",
    '''@layer workspace, workspace-single-tab-row;

@layer workspace-single-tab-row {
  :where(.pf-hide-single-tab-row) {
    --pf-single-tab-drag-handle-size: 12px;
    --pf-single-tab-drag-grip-inline-size: 28px;
    --pf-single-tab-drag-grip-block-size: 3px;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group:has(
      > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    ) {
    position: relative;
    transition:
      border-color var(--pf-motion-micro),
      box-shadow var(--pf-motion-micro);
  }

  :where(.pf-hide-single-tab-row)
    .pf-group
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    position: absolute;
    z-index: 7;
    min-inline-size: 0;
    min-block-size: 0;
    padding: 0;
    overflow: visible;
    border: 0;
    background: transparent;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-orientation="horizontal"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    inset-inline: 0;
    flex: none;
    block-size: var(--pf-single-tab-drag-handle-size);
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="block-start"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    inset-block-start: 0;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="block-end"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    inset-block-end: 0;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-orientation="vertical"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    inset-block: 0;
    flex: none;
    inline-size: var(--pf-single-tab-drag-handle-size);
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="inline-start"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    inset-inline-start: 0;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="inline-end"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"] {
    inset-inline-end: 0;
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-list {
    flex: 1 1 auto;
    inline-size: 100%;
    block-size: 100%;
    min-inline-size: 0;
    min-block-size: 0;
    overflow: hidden;
    scrollbar-width: none;
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-list
    > .pf-tab:only-child {
    flex: 1 1 auto;
    inline-size: 100%;
    block-size: 100%;
    min-inline-size: 0;
    min-block-size: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    opacity: 0;
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-list
    > .pf-tab:only-child:not(:focus-visible)
    > .pf-tab-close {
    pointer-events: none;
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-controls {
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    z-index: 9;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--pf-motion-micro);
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="block-end"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-controls {
    inset-block-start: auto;
    inset-block-end: 0;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-orientation="vertical"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-controls {
    inset-block-start: auto;
    inset-block-end: 0;
    flex-direction: column;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="inline-start"]
    > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-controls {
    inset-inline-start: 0;
    inset-inline-end: auto;
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:hover
    > .pf-tab-controls,
  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
    > .pf-tab-controls:is(:hover, :focus-within) {
    opacity: 1;
    pointer-events: auto;
  }

  :where(.pf-hide-single-tab-row) .pf-single-tab-drag-affordance {
    position: absolute;
    inset: 0;
    z-index: 8;
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--pf-text-muted) 72%, transparent);
    pointer-events: none;
  }

  :where(.pf-hide-single-tab-row) .pf-single-tab-drag-affordance::before {
    content: "";
    inline-size: var(--pf-single-tab-drag-grip-inline-size);
    block-size: var(--pf-single-tab-drag-grip-block-size);
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--pf-bg) 45%, transparent);
    opacity: 0.42;
    transition:
      color var(--pf-motion-micro),
      opacity var(--pf-motion-micro),
      scale var(--pf-motion-micro);
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-orientation="vertical"]
    .pf-single-tab-drag-affordance::before {
    inline-size: var(--pf-single-tab-drag-grip-block-size);
    block-size: var(--pf-single-tab-drag-grip-inline-size);
  }

  :where(.pf-hide-single-tab-row) .pf-single-tab-drag-affordance::after {
    content: attr(data-tooltip);
    position: absolute;
    z-index: 40;
    inline-size: max-content;
    max-inline-size: 240px;
    padding: 6px 8px;
    border: 1px solid var(--pf-border-strong);
    border-radius: 5px;
    color: var(--pf-text);
    background: var(--pf-surface-raised);
    box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
    font-size: 10px;
    line-height: 1.3;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--pf-motion-micro) 0ms,
      translate var(--pf-motion-micro) 0ms;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="block-start"]
    .pf-single-tab-drag-affordance::after {
    inset-block-start: calc(100% + 7px);
    inset-inline-start: 50%;
    translate: -50% -2px;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="block-end"]
    .pf-single-tab-drag-affordance::after {
    inset-block-end: calc(100% + 7px);
    inset-inline-start: 50%;
    translate: -50% 2px;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="inline-start"]
    .pf-single-tab-drag-affordance::after {
    inset-block-start: 50%;
    inset-inline-start: calc(100% + 7px);
    translate: -2px -50%;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group[data-tab-placement="inline-end"]
    .pf-single-tab-drag-affordance::after {
    inset-block-start: 50%;
    inset-inline-end: calc(100% + 7px);
    translate: 2px -50%;
  }

  :where(.pf-hide-single-tab-row)
    .pf-group:has(
      > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:hover
    ) {
    border-color: color-mix(in srgb, var(--pf-accent) 66%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pf-accent) 28%, transparent);
  }

  :where(.pf-hide-single-tab-row)
    .pf-group:has(
      > .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
        > .pf-tab-list
        > .pf-tab:active
    ) {
    border-color: var(--pf-accent);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--pf-accent) 42%, transparent);
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:hover
    > .pf-single-tab-drag-affordance::before,
  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:has(
      > .pf-tab-list > .pf-tab:active
    )
    > .pf-single-tab-drag-affordance::before {
    color: var(--pf-accent);
    opacity: 0.95;
    scale: 1.08;
  }

  @media (hover: hover) and (pointer: fine) {
    :where(.pf-hide-single-tab-row)
      .pf-workspace[data-panel-drop-enabled="true"]
      .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]
      > .pf-tab-list:hover
      ~ .pf-single-tab-drag-affordance::after {
      opacity: 1;
      transition-delay: 700ms;
    }

    :where(.pf-hide-single-tab-row)
      .pf-workspace[data-panel-drop-enabled="true"]
      .pf-group[data-tab-placement="block-start"]
      .pf-tab-list:hover
      ~ .pf-single-tab-drag-affordance::after {
      translate: -50% 0;
    }

    :where(.pf-hide-single-tab-row)
      .pf-workspace[data-panel-drop-enabled="true"]
      .pf-group[data-tab-placement="block-end"]
      .pf-tab-list:hover
      ~ .pf-single-tab-drag-affordance::after {
      translate: -50% 0;
    }

    :where(.pf-hide-single-tab-row)
      .pf-workspace[data-panel-drop-enabled="true"]
      .pf-group[data-tab-placement="inline-start"]
      .pf-tab-list:hover
      ~ .pf-single-tab-drag-affordance::after {
      translate: 0 -50%;
    }

    :where(.pf-hide-single-tab-row)
      .pf-workspace[data-panel-drop-enabled="true"]
      .pf-group[data-tab-placement="inline-end"]
      .pf-tab-list:hover
      ~ .pf-single-tab-drag-affordance::after {
      translate: 0 -50%;
    }
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:is(
      :has(> .pf-tab-list > .pf-tab:only-child:focus-visible),
      :has(> .pf-tab-controls :focus-visible)
    ),
  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:is(
      :has(> .pf-tab-list > .pf-tab:only-child:focus-visible),
      :has(> .pf-tab-controls :focus-visible)
    )
    > :is(.pf-tab-list, .pf-tab-controls),
  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:is(
      :has(> .pf-tab-list > .pf-tab:only-child:focus-visible),
      :has(> .pf-tab-controls :focus-visible)
    )
    > .pf-tab-list
    > .pf-tab:only-child {
    all: revert-layer;
  }

  :where(.pf-hide-single-tab-row)
    .pf-tab-strip[data-header-location="docked"][data-single-panel="true"]:focus-within
    > .pf-single-tab-drag-affordance {
    display: none;
  }
}
''',
)

write(
    "packages/react/test/tab-presentation.test.ts",
    '''import { describe, expect, it } from "vitest";

import {
  resolveGroupHeaderPresentation,
  tabOrientation,
} from "../src/tab-presentation";

describe("group header presentation", () => {
  it("preserves docked logical tab placement", () => {
    const presentation = { placement: "inline-end", content: "icon-only" } as const;

    expect(resolveGroupHeaderPresentation(presentation, { floating: false, panelCount: 1 })).toEqual({
      ...presentation,
      location: "docked",
      variant: "tabs",
      orientation: "vertical",
    });
    expect(tabOrientation(presentation)).toBe("vertical");
  });

  it("integrates multiple floating tabs into a horizontal titlebar", () => {
    expect(
      resolveGroupHeaderPresentation(
        { placement: "inline-start", content: "label-only" },
        { floating: true, panelCount: 3 },
      ),
    ).toEqual({
      placement: "block-start",
      content: "label-only",
      location: "floating",
      variant: "tabs",
      orientation: "horizontal",
    });
  });

  it("presents one floating tab as a title while retaining the tab element", () => {
    expect(
      resolveGroupHeaderPresentation(
        { placement: "inline-start", content: "icon-only" },
        { floating: true, panelCount: 1 },
      ),
    ).toEqual({
      placement: "block-start",
      content: "icon-and-label",
      location: "floating",
      variant: "title",
      orientation: "horizontal",
    });
  });
});
''',
)

write(
    "e2e/single-tab-row.spec.ts",
    '''import { expect, test, type Locator, type Page } from "@playwright/test";

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Expected a rendered drag target");
  return box;
}

async function dragTabToGroup(page: Page, tab: Locator, target: string | Locator) {
  await tab.scrollIntoViewIfNeeded();
  const sourceBox = await requiredBox(tab);
  const targetGroup =
    typeof target === "string"
      ? page.locator(`[data-workspace-group="${target}"]`)
      : target;
  const targetBox = await requiredBox(targetGroup);
  const targetNodeId = await targetGroup.getAttribute("data-workspace-node");
  expect(targetNodeId).not.toBeNull();

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  });

  const overlay = page.locator("[data-workspace-panel-drag]");
  await expect(overlay).toHaveAttribute("data-workspace-drop-kind", "center");
  await expect(overlay).toHaveAttribute(
    "data-workspace-drop-target",
    `center:${String(targetNodeId)}`,
  );
  await page.mouse.up();
}

async function floatWorkspacePanel(page: Page) {
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();
  await page.getByRole("menuitem", { name: "Float workspace.ts" }).click();
}

test("shows a discoverable docked drag grip without restoring the tab row", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const workspaceTab = page.getByRole("tab", { name: "workspace.ts" });
  await workspaceTab.click();
  await workspaceTab.locator('[data-workspace-tab-close="notes"]').click();

  const primaryGroup = page.locator('[data-workspace-group="primary"]');
  const appTab = primaryGroup.locator('[data-workspace-panel-tab="map-canvas"]');
  const tabStrip = primaryGroup.locator(":scope > .pf-tab-strip");
  const affordance = tabStrip.locator(".pf-single-tab-drag-affordance");

  await expect(tabStrip).toHaveAttribute("data-header-location", "docked");
  await expect(tabStrip).toHaveAttribute("data-single-panel", "true");
  await expect(appTab).toHaveCSS("opacity", "0");
  await expect(appTab).toHaveCSS("cursor", "grab");
  await expect(affordance).toBeVisible();
  await expect(affordance).toHaveAttribute("data-tooltip", "Drag to move App.tsx");
  expect((await requiredBox(tabStrip)).height).toBeLessThanOrEqual(12);

  await tabStrip.hover({ position: { x: 80, y: 6 } });
  await expect
    .poll(() => primaryGroup.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe("none");
  await page.waitForTimeout(750);
  expect(
    await affordance.evaluate((element) => getComputedStyle(element, "::after").opacity),
  ).toBe("1");
  expect(
    await affordance.evaluate((element) => getComputedStyle(element, "::after").content),
  ).toContain("Drag to move App.tsx");

  await dragTabToGroup(page, appTab, "inspector");

  await expect(
    page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="map-canvas"]'),
  ).toHaveCount(1);
});

test("uses a single floating tab as the persistent window title", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await floatWorkspacePanel(page);

  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const headerStrip = frame.locator(".pf-floating-header-slot > .pf-tab-strip");
  const floatingTab = headerStrip.locator('[data-workspace-panel-tab="notes"]');

  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("data-integrated-header", "true");
  await expect(headerStrip).toHaveAttribute("data-header-location", "floating");
  await expect(headerStrip).toHaveAttribute("data-header-variant", "title");
  await expect(floatingTab).toHaveCSS("opacity", "1");
  await expect(floatingTab).toHaveCSS("border-bottom-style", "none");
  await expect(floatingTab.getByText("workspace.ts")).toBeVisible();
  await expect(frame.locator(".pf-floating-header-drag-grip")).toBeVisible();

  await frame.locator('.pf-floating-controls button[aria-label^="Minimize "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await expect(floatingTab).toBeVisible();
  await expect(frame.locator(".pf-floating-content")).toBeHidden();

  await frame.locator('.pf-floating-controls button[aria-label^="Restore "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "false");
  await dragTabToGroup(page, floatingTab, "inspector");

  await expect(frame).toHaveCount(0);
  await expect(
    page.locator('[data-workspace-group="inspector"] [data-workspace-panel-tab="notes"]'),
  ).toHaveCount(1);
});

test("keeps multiple floating tabs in the titlebar while minimized", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await floatWorkspacePanel(page);

  const frame = page.locator('[data-workspace-floating-surface^="floating:notes:"]');
  const floatingGroup = frame.locator(".pf-floating-content [data-workspace-group]").first();
  const appTab = page.locator(
    '[data-workspace-group="primary"] [data-workspace-panel-tab="map-canvas"]',
  );

  await dragTabToGroup(page, appTab, floatingGroup);

  const headerStrip = frame.locator(".pf-floating-header-slot > .pf-tab-strip");
  await expect(headerStrip).toHaveAttribute("data-header-variant", "tabs");
  await expect(headerStrip.getByRole("tab")).toHaveCount(2);

  await frame.locator('.pf-floating-controls button[aria-label^="Minimize "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "true");
  await expect(headerStrip.getByRole("tab")).toHaveCount(2);
  await headerStrip.getByRole("tab", { name: "App.tsx" }).click();
  await expect(headerStrip.getByRole("tab", { name: "App.tsx" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await frame.locator('.pf-floating-controls button[aria-label^="Restore "]').click();
  await expect(frame).toHaveAttribute("data-minimized", "false");
});

test("keeps the VS Code demo typography and compact header in a browser window", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "workspace.ts" }).click();
  await page.getByRole("button", { name: "Actions for workspace.ts" }).click();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Open in new window" }).click();
  const popup = await popupPromise;

  const shell = popup.locator(".demo-external-app");
  const header = popup.locator(".demo-external-header");
  await expect(header).toBeVisible();
  await expect(popup.locator('link[rel="stylesheet"]')).toHaveCount(1);
  await expect(shell).toHaveCSS("font-size", "12px");
  await expect(header).toHaveCSS("padding-top", "8px");
  await expect(header).toHaveCSS("padding-bottom", "8px");
  await expect(header.locator("strong")).toHaveCSS("font-size", "12px");
  await expect(header.getByRole("button", { name: "Return to main window" })).toHaveCSS(
    "font-size",
    "11px",
  );

  await header.getByRole("button", { name: "Return to main window" }).click();
  await expect(page.getByRole("tab", { name: "workspace.ts" })).toBeVisible();
});
''',
)

print("Applied panel-header architecture and interaction updates.")
