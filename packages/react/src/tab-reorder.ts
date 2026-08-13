import type {
  WorkspaceDirection,
  WorkspacePanelReorderPlacement,
  WorkspacePanelView,
} from "./types";

export type TabStripOrientation = "horizontal" | "vertical";

export interface PhysicalTabRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MeasuredTab {
  readonly panel: WorkspacePanelView;
  readonly rect: PhysicalTabRect;
}

export interface TabReorderLabels {
  readonly moveBefore: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly moveAfter: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly movedBefore: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly movedAfter: (values: { readonly title: string; readonly anchor: string }) => string;
  readonly keptPosition: (values: { readonly title: string }) => string;
}

export interface TabReorderShift {
  readonly x: number;
  readonly y: number;
}

export interface TabReorderCandidate {
  readonly id: string;
  readonly insertionIndex: number;
  readonly changed: boolean;
  readonly placement: WorkspacePanelReorderPlacement;
  /** Present-tense label exposed by the visual preview; pointer hover stays silent. */
  readonly label: string;
  /** Past-tense label announced only after the command commits. */
  readonly commitLabel: string;
  readonly indicatorRect: PhysicalTabRect;
  readonly shifts: Readonly<Record<string, TabReorderShift>>;
}

export interface TabReorderIndex<TCommand> {
  readonly panel: WorkspacePanelView;
  readonly groupId: string;
  readonly orientation: TabStripOrientation;
  readonly direction: WorkspaceDirection;
  readonly stripRect: PhysicalTabRect;
  readonly orderedTabs: readonly MeasuredTab[];
  readonly sourceIndex: number;
  readonly sourceRect: PhysicalTabRect;
  readonly slots: readonly TabReorderCandidate[];
  /** Cumulative physical movement of scrollable tab content since measurement. */
  readonly contentTranslation: TabReorderShift;
  readonly createCommand: (
    panelId: string,
    groupId: string,
    placement: WorkspacePanelReorderPlacement,
  ) => TCommand;
}

interface CreateTabReorderIndexOptions<TCommand> {
  readonly panel: WorkspacePanelView;
  readonly groupId: string;
  readonly orderedTabs: readonly MeasuredTab[];
  readonly stripRect: PhysicalTabRect;
  readonly orientation: TabStripOrientation;
  readonly direction: WorkspaceDirection;
  readonly createCommand: (
    panelId: string,
    groupId: string,
    placement: WorkspacePanelReorderPlacement,
  ) => TCommand;
  readonly labels: TabReorderLabels;
}

/**
 * Builds all semantic slots and their visual plans once at drag start. Pointer
 * samples can then select a slot without reading layout or creating commands.
 */
export function createTabReorderIndex<TCommand>(
  options: CreateTabReorderIndexOptions<TCommand>,
): TabReorderIndex<TCommand> | undefined {
  const sourceIndex = options.orderedTabs.findIndex(
    (candidate) => candidate.panel.id === options.panel.id,
  );
  if (
    sourceIndex < 0 ||
    options.orderedTabs.length < 2 ||
    !validRect(options.stripRect) ||
    options.stripRect.width <= 0 ||
    options.stripRect.height <= 0 ||
    options.orderedTabs.some((candidate) => !validRect(candidate.rect))
  ) {
    return undefined;
  }

  const source = options.orderedTabs[sourceIndex];
  if (source === undefined) return undefined;
  const remaining = options.orderedTabs.filter(
    (candidate) => candidate.panel.id !== options.panel.id,
  );
  const slots = Array.from({ length: remaining.length + 1 }, (_unused, insertionIndex) => {
    const before = remaining[insertionIndex];
    const previous = remaining[insertionIndex - 1];
    const placement: WorkspacePanelReorderPlacement =
      before === undefined ? Object.freeze({}) : Object.freeze({ beforePanelId: before.panel.id });
    const changed = insertionIndex !== sourceIndex;
    const label = !changed
      ? options.labels.keptPosition({ title: options.panel.title })
      : before !== undefined
        ? options.labels.moveBefore({
            title: options.panel.title,
            anchor: before.panel.title,
          })
        : options.labels.moveAfter({
            title: options.panel.title,
            anchor: previous?.panel.title ?? options.panel.title,
          });
    const commitLabel = !changed
      ? label
      : before !== undefined
        ? options.labels.movedBefore({ title: options.panel.title, anchor: before.panel.title })
        : options.labels.movedAfter({
            title: options.panel.title,
            anchor: previous?.panel.title ?? options.panel.title,
          });
    return Object.freeze({
      id: `reorder:${options.groupId}:${before === undefined ? "append" : `before:${before.panel.id}`}`,
      insertionIndex,
      changed,
      placement,
      label,
      commitLabel,
      indicatorRect: insertionIndicator(
        options.stripRect,
        remaining,
        insertionIndex,
        options.orientation,
        options.direction,
      ),
      shifts: Object.freeze({}),
    });
  });

  return Object.freeze({
    panel: options.panel,
    groupId: options.groupId,
    orientation: options.orientation,
    direction: options.direction,
    stripRect: Object.freeze({ ...options.stripRect }),
    orderedTabs: Object.freeze([...options.orderedTabs]),
    sourceIndex,
    sourceRect: Object.freeze({ ...source.rect }),
    slots: Object.freeze(slots),
    contentTranslation: Object.freeze({ x: 0, y: 0 }),
    createCommand: options.createCommand,
  });
}

/**
 * Advances a measured index after native scrolling without walking or reading
 * every tab again. The measured arrays retain identity and hit testing applies
 * this O(1) cumulative physical translation.
 */
export function translateTabReorderIndex<TCommand>(
  index: TabReorderIndex<TCommand>,
  translation: TabReorderShift,
): TabReorderIndex<TCommand> {
  if (translation.x === 0 && translation.y === 0) return index;
  return Object.freeze({
    ...index,
    contentTranslation: Object.freeze({
      x: index.contentTranslation.x + translation.x,
      y: index.contentTranslation.y + translation.y,
    }),
  });
}

export function hitTestTabReorder<TCommand>(
  index: TabReorderIndex<TCommand>,
  point: { readonly x: number; readonly y: number },
): TabReorderCandidate | undefined {
  if (!contains(index.stripRect, point)) return undefined;
  const remainingSlots = index.slots;
  if (remainingSlots.length === 0) return undefined;

  // Slot indicators are monotonic in logical tab order. Compare against the
  // halfway point between adjacent indicators, so hit testing is independent
  // of unequal tab widths and works the same way for RTL and vertical rails.
  const pointer = logicalCoordinate(point, index.orientation, index.direction);
  let low = 0;
  let high = remainingSlots.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const current = remainingSlots[middle];
    const next = remainingSlots[middle + 1];
    if (current === undefined || next === undefined) break;
    const boundary =
      (translatedIndicatorCoordinate(index, current.indicatorRect) +
        translatedIndicatorCoordinate(index, next.indicatorRect)) /
      2;
    if (pointer < boundary) high = middle;
    else low = middle + 1;
  }
  const slot = remainingSlots[low] ?? remainingSlots.at(-1);
  return slot;
}

/** Refreshes visual geometry and computes transforms only when the semantic slot changes. */
export function resolveTabReorderCandidate<TCommand>(
  index: TabReorderIndex<TCommand>,
  slot: TabReorderCandidate,
  previous?: TabReorderCandidate,
): TabReorderCandidate {
  return Object.freeze({
    ...slot,
    indicatorRect: visibleIndicatorRect(index, slot.indicatorRect),
    shifts:
      previous?.id === slot.id
        ? previous.shifts
        : siblingShifts(
            index.orderedTabs,
            index.sourceIndex,
            slot.insertionIndex,
            index.sourceRect,
            index.orientation,
            index.direction,
          ),
  });
}

function insertionIndicator(
  strip: PhysicalTabRect,
  remaining: readonly MeasuredTab[],
  insertionIndex: number,
  orientation: TabStripOrientation,
  direction: WorkspaceDirection,
): PhysicalTabRect {
  const next = remaining[insertionIndex];
  const previous = remaining[insertionIndex - 1];
  if (orientation === "vertical") {
    const boundary =
      next?.rect.top ??
      (previous === undefined ? strip.top : previous.rect.top + previous.rect.height);
    return Object.freeze({
      left: strip.left + 4,
      top: boundary - 1.5,
      width: Math.max(0, strip.width - 8),
      height: 3,
    });
  }

  const rawBoundary =
    direction === "rtl"
      ? next === undefined
        ? previous === undefined
          ? strip.left + strip.width
          : previous.rect.left
        : next.rect.left + next.rect.width
      : (next?.rect.left ??
        (previous === undefined ? strip.left : previous.rect.left + previous.rect.width));
  return Object.freeze({
    left: rawBoundary - 1.5,
    top: strip.top + 4,
    width: 3,
    height: Math.max(0, strip.height - 8),
  });
}

function siblingShifts(
  orderedTabs: readonly MeasuredTab[],
  sourceIndex: number,
  insertionIndex: number,
  sourceRect: PhysicalTabRect,
  orientation: TabStripOrientation,
  direction: WorkspaceDirection,
): Readonly<Record<string, TabReorderShift>> {
  const shifts: Record<string, TabReorderShift> = {};
  const mainSize = orientation === "vertical" ? sourceRect.height : sourceRect.width;
  const physicalForward = orientation === "horizontal" && direction === "rtl" ? -1 : 1;
  for (let index = 0; index < orderedTabs.length; index += 1) {
    const candidate = orderedTabs[index];
    if (candidate === undefined || index === sourceIndex) continue;
    let logicalShift = 0;
    if (insertionIndex < sourceIndex && index >= insertionIndex && index < sourceIndex) {
      logicalShift = mainSize;
    }
    if (insertionIndex > sourceIndex && index > sourceIndex && index <= insertionIndex) {
      logicalShift = -mainSize;
    }
    if (logicalShift === 0) continue;
    shifts[candidate.panel.id] = Object.freeze(
      orientation === "vertical"
        ? { x: 0, y: logicalShift }
        : { x: logicalShift * physicalForward, y: 0 },
    );
  }
  return Object.freeze(shifts);
}

function indicatorCoordinate(
  rect: PhysicalTabRect,
  orientation: TabStripOrientation,
  direction: WorkspaceDirection,
): number {
  if (orientation === "vertical") return rect.top + rect.height / 2;
  const center = rect.left + rect.width / 2;
  return direction === "rtl" ? -center : center;
}

function translatedIndicatorCoordinate<TCommand>(
  index: TabReorderIndex<TCommand>,
  rect: PhysicalTabRect,
): number {
  const translation =
    index.orientation === "vertical"
      ? index.contentTranslation.y
      : index.direction === "rtl"
        ? -index.contentTranslation.x
        : index.contentTranslation.x;
  return indicatorCoordinate(rect, index.orientation, index.direction) + translation;
}

function visibleIndicatorRect<TCommand>(
  index: TabReorderIndex<TCommand>,
  rect: PhysicalTabRect,
): PhysicalTabRect {
  if (index.orientation === "vertical") {
    const center = clamp(
      rect.top + rect.height / 2 + index.contentTranslation.y,
      index.stripRect.top,
      index.stripRect.top + index.stripRect.height,
    );
    return Object.freeze({ ...rect, top: center - rect.height / 2 });
  }
  const center = clamp(
    rect.left + rect.width / 2 + index.contentTranslation.x,
    index.stripRect.left,
    index.stripRect.left + index.stripRect.width,
  );
  return Object.freeze({ ...rect, left: center - rect.width / 2 });
}

function logicalCoordinate(
  point: { readonly x: number; readonly y: number },
  orientation: TabStripOrientation,
  direction: WorkspaceDirection,
): number {
  if (orientation === "vertical") return point.y;
  return direction === "rtl" ? -point.x : point.x;
}

function contains(rect: PhysicalTabRect, point: { readonly x: number; readonly y: number }) {
  return (
    point.x >= rect.left &&
    point.x < rect.left + rect.width &&
    point.y >= rect.top &&
    point.y < rect.top + rect.height
  );
}

function validRect(rect: PhysicalTabRect) {
  return (
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
