import type {
  GroupRecord,
  LayoutNode,
  NodeId,
  PanelConstraints,
  WorkspaceSnapshot,
} from "@panefold/model";

import { allocateAxis } from "./allocate-axis.js";
import type {
  AxisConstraints,
  BoxConstraints,
  GeometryDiagnostic,
  LogicalAxis,
  LogicalRect,
  ResolvedLayout,
  ResolvedSplitter,
  SplitLayoutOverride,
} from "./types.js";

export interface SolveLayoutOptions {
  readonly splitterSize?: number;
  /** Ephemeral drag/resize state; the committed snapshot is never mutated. */
  readonly splitOverrides?: Readonly<Record<string, SplitLayoutOverride>>;
  readonly resolveGroupConstraints?: (
    group: GroupRecord,
    snapshot: WorkspaceSnapshot,
  ) => BoxConstraints;
}

interface ConstraintContext {
  readonly snapshot: WorkspaceSnapshot;
  readonly splitterSize: number;
  readonly diagnostics: GeometryDiagnostic[];
  readonly memo: Map<string, BoxConstraints>;
  readonly resolving: Set<string>;
  readonly resolveGroupConstraints: (
    group: GroupRecord,
    snapshot: WorkspaceSnapshot,
  ) => BoxConstraints;
  readonly splitOverrides: Readonly<Record<string, SplitLayoutOverride>>;
  readonly resolvedSplitStates: Map<
    string,
    { readonly weights: readonly number[]; readonly collapsedChildIds: readonly NodeId[] }
  >;
}

const UNBOUNDED = Number.POSITIVE_INFINITY;

function axisValue(
  constraints: PanelConstraints,
  axis: LogicalAxis,
  kind: "hardMin" | "preferredMin" | "preferred" | "max",
): number | undefined {
  if (axis === "inline") {
    if (kind === "hardMin") return constraints.hardMinInline;
    if (kind === "preferredMin") return constraints.preferredMinInline;
    if (kind === "preferred") return constraints.preferredInline;
    return constraints.maxInline;
  }

  if (kind === "hardMin") return constraints.hardMinBlock;
  if (kind === "preferredMin") return constraints.preferredMinBlock;
  if (kind === "preferred") return constraints.preferredBlock;
  return constraints.maxBlock;
}

function safeDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function selectedPanelConstraints(
  group: GroupRecord,
  snapshot: WorkspaceSnapshot,
  axis: LogicalAxis,
): AxisConstraints {
  const panels = group.panelIds
    .map((id) => snapshot.panels.byId[String(id)])
    .filter((panel) => panel !== undefined);
  const selected = snapshot.panels.byId[String(group.selectedPanelId)] ?? panels[0];

  if (panels.length === 0 || selected === undefined) return {};

  const min = panels.reduce(
    (current, panel) =>
      Math.max(current, safeDimension(axisValue(panel.constraints, axis, "hardMin"), 0)),
    0,
  );
  const preferredMin = safeDimension(axisValue(selected.constraints, axis, "preferredMin"), min);
  const preferred = Math.max(
    min,
    preferredMin,
    safeDimension(axisValue(selected.constraints, axis, "preferred"), preferredMin),
  );
  const declaredMax = axisValue(selected.constraints, axis, "max");
  const max =
    declaredMax === undefined ? UNBOUNDED : Math.max(min, safeDimension(declaredMax, min));

  return {
    min,
    preferred: Math.min(preferred, max),
    max,
    grow: safeDimension(selected.constraints.grow, 1),
    shrink: safeDimension(selected.constraints.shrink, 1),
    collapsible: panels.every((panel) => panel.constraints.collapsible === true),
    collapsePriority: safeDimension(selected.constraints.collapsePriority, 0),
  };
}

export function defaultGroupConstraints(
  group: GroupRecord,
  snapshot: WorkspaceSnapshot,
): BoxConstraints {
  const selected = snapshot.panels.byId[String(group.selectedPanelId)];
  const preferredAspectRatio = selected?.constraints.preferredAspectRatio;
  return {
    inline: selectedPanelConstraints(group, snapshot, "inline"),
    block: selectedPanelConstraints(group, snapshot, "block"),
    ...(preferredAspectRatio === undefined ||
    !Number.isFinite(preferredAspectRatio) ||
    preferredAspectRatio <= 0
      ? {}
      : { preferredAspectRatio }),
  };
}

function resolveSplitState(
  node: Extract<LayoutNode, { readonly kind: "split" }>,
  context: ConstraintContext,
): { readonly weights: readonly number[]; readonly collapsedChildIds: readonly NodeId[] } {
  const key = String(node.id);
  const cached = context.resolvedSplitStates.get(key);
  if (cached !== undefined) return cached;
  const override = context.splitOverrides[key];
  let weights = node.weights;
  let collapsedChildIds = node.collapsedChildIds;

  if (override?.weights !== undefined) {
    if (
      override.weights.length === node.children.length &&
      override.weights.every((weight) => Number.isFinite(weight) && weight > 0)
    ) {
      weights = override.weights;
    } else {
      context.diagnostics.push({
        code: "INVALID_OVERRIDE",
        message: `Speculative weights for ${key} were ignored because their arity or values are invalid.`,
        nodeId: key,
      });
    }
  }
  if (override?.collapsedChildIds !== undefined) {
    const collapsed = override.collapsedChildIds;
    if (
      new Set(collapsed).size === collapsed.length &&
      collapsed.every((childId) => node.children.some((child) => String(child) === childId)) &&
      collapsed.length < node.children.length
    ) {
      const selected = new Set(collapsed);
      collapsedChildIds = node.children.filter((childId) => selected.has(String(childId)));
    } else {
      context.diagnostics.push({
        code: "INVALID_OVERRIDE",
        message: `Speculative collapse state for ${key} was ignored because it is invalid.`,
        nodeId: key,
      });
    }
  }
  const result = { weights, collapsedChildIds };
  context.resolvedSplitStates.set(key, result);
  return result;
}

function constraintsForAxis(box: BoxConstraints, axis: LogicalAxis): Required<AxisConstraints> {
  const constraints = box[axis] ?? {};
  const min = safeDimension(constraints.min, 0);
  const max =
    constraints.max === undefined || constraints.max === UNBOUNDED
      ? UNBOUNDED
      : Math.max(min, safeDimension(constraints.max, min));
  return {
    min,
    preferred: Math.min(max, Math.max(min, safeDimension(constraints.preferred, min))),
    max,
    grow: safeDimension(constraints.grow, 1),
    shrink: safeDimension(constraints.shrink, 1),
    collapsible: constraints.collapsible ?? false,
    collapsePriority: safeDimension(constraints.collapsePriority, 0),
  };
}

function combineAlongAxis(
  children: readonly BoxConstraints[],
  axis: LogicalAxis,
  splitterSize: number,
): AxisConstraints {
  const parts = children.map((child) => constraintsForAxis(child, axis));
  const splitters = Math.max(0, parts.length - 1) * splitterSize;
  const max = parts.some((part) => !Number.isFinite(part.max))
    ? UNBOUNDED
    : parts.reduce((total, part) => total + part.max, splitters);

  return {
    min: parts.reduce((total, part) => total + part.min, splitters),
    preferred: parts.reduce((total, part) => total + part.preferred, splitters),
    max,
    grow: parts.reduce((total, part) => total + part.grow, 0),
    shrink: parts.reduce((total, part) => total + part.shrink, 0),
    collapsible: parts.length > 0 && parts.every((part) => part.collapsible),
    collapsePriority:
      parts.length === 0 ? 0 : Math.min(...parts.map((part) => part.collapsePriority)),
  };
}

function combineAcrossAxis(
  children: readonly BoxConstraints[],
  axis: LogicalAxis,
): AxisConstraints {
  const parts = children.map((child) => constraintsForAxis(child, axis));
  const finiteMaxima = parts.map((part) => part.max).filter(Number.isFinite);

  return {
    min: parts.reduce((current, part) => Math.max(current, part.min), 0),
    preferred: parts.reduce((current, part) => Math.max(current, part.preferred), 0),
    max: finiteMaxima.length > 0 ? Math.min(...finiteMaxima) : UNBOUNDED,
    grow: parts.reduce((current, part) => Math.max(current, part.grow), 1),
    shrink: parts.reduce((current, part) => Math.max(current, part.shrink), 1),
    collapsible: parts.length > 0 && parts.every((part) => part.collapsible),
    collapsePriority:
      parts.length === 0 ? 0 : Math.min(...parts.map((part) => part.collapsePriority)),
  };
}

function nodeFor(snapshot: WorkspaceSnapshot, id: NodeId): LayoutNode | undefined {
  return snapshot.nodes.byId[String(id)];
}

function deriveConstraints(nodeId: NodeId, context: ConstraintContext): BoxConstraints {
  const key = String(nodeId);
  const cached = context.memo.get(key);
  if (cached !== undefined) return cached;

  if (context.resolving.has(key)) {
    context.diagnostics.push({
      code: "LAYOUT_CYCLE",
      message: `Layout cycle encountered at ${key}.`,
      nodeId: key,
    });
    return {};
  }

  const node = nodeFor(context.snapshot, nodeId);
  if (node === undefined) {
    context.diagnostics.push({
      code: "MISSING_NODE",
      message: `Layout node ${key} is missing.`,
      nodeId: key,
    });
    return {};
  }

  context.resolving.add(key);
  let result: BoxConstraints;

  if (node.kind === "group") {
    const group = context.snapshot.groups.byId[String(node.groupId)];
    if (group === undefined) {
      context.diagnostics.push({
        code: "MISSING_GROUP",
        message: `Group ${String(node.groupId)} referenced by ${key} is missing.`,
        nodeId: key,
      });
      result = {};
    } else {
      for (const panelId of group.panelIds) {
        if (context.snapshot.panels.byId[String(panelId)] === undefined) {
          context.diagnostics.push({
            code: "MISSING_PANEL",
            message: `Panel ${String(panelId)} referenced by group ${String(group.id)} is missing.`,
            nodeId: key,
          });
        }
      }
      result = context.resolveGroupConstraints(group, context.snapshot);
    }
  } else {
    const splitState = resolveSplitState(node, context);
    const collapsed = new Set(splitState.collapsedChildIds.map(String));
    const visibleChildren = node.children.filter((childId) => !collapsed.has(String(childId)));
    const children = visibleChildren.map((childId) => deriveConstraints(childId, context));
    result = {
      inline:
        node.axis === "inline"
          ? combineAlongAxis(children, "inline", context.splitterSize)
          : combineAcrossAxis(children, "inline"),
      block:
        node.axis === "block"
          ? combineAlongAxis(children, "block", context.splitterSize)
          : combineAcrossAxis(children, "block"),
    };
  }

  context.resolving.delete(key);
  context.memo.set(key, result);
  return result;
}

function rectForChild(
  parent: LogicalRect,
  axis: LogicalAxis,
  start: number,
  size: number,
): LogicalRect {
  return axis === "inline"
    ? { ...parent, inlineStart: start, inlineSize: size }
    : { ...parent, blockStart: start, blockSize: size };
}

function zeroRect(parent: LogicalRect, axis: LogicalAxis, start: number): LogicalRect {
  return rectForChild(parent, axis, start, 0);
}

/** Resolve one surface-rooted layout tree entirely in logical coordinates. */
export function solveLayout(
  snapshot: WorkspaceSnapshot,
  rootNodeId: NodeId,
  bounds: LogicalRect,
  options: SolveLayoutOptions = {},
): ResolvedLayout {
  const diagnostics: GeometryDiagnostic[] = [];
  const requestedSplitterSize = options.splitterSize ?? 6;
  const splitterSize = Math.round(safeDimension(requestedSplitterSize, 6));
  if (splitterSize !== requestedSplitterSize) {
    diagnostics.push({
      code: "INVALID_SPLITTER_SIZE",
      message: `Splitter size ${String(requestedSplitterSize)} was replaced with ${splitterSize}.`,
    });
  }
  const constraintContext: ConstraintContext = {
    snapshot,
    splitterSize,
    diagnostics,
    memo: new Map(),
    resolving: new Set(),
    resolveGroupConstraints: options.resolveGroupConstraints ?? defaultGroupConstraints,
    splitOverrides: options.splitOverrides ?? {},
    resolvedSplitStates: new Map(),
  };
  const nodeRects: Record<string, LogicalRect> = {};
  const groupRects: Record<string, LogicalRect> = {};
  const splitters: ResolvedSplitter[] = [];
  const collapsedNodeIds: string[] = [];
  const laidOut = new Set<string>();

  // Build and validate the complete constraint graph before producing geometry.
  deriveConstraints(rootNodeId, constraintContext);

  const visit = (nodeId: NodeId, rect: LogicalRect): void => {
    const key = String(nodeId);
    if (laidOut.has(key)) {
      diagnostics.push({
        code: "LAYOUT_CYCLE",
        message: `Node ${key} was reached more than once while resolving layout.`,
        nodeId: key,
      });
      return;
    }

    const node = nodeFor(snapshot, nodeId);
    if (node === undefined) return;
    laidOut.add(key);
    nodeRects[key] = rect;

    if (node.kind === "group") {
      groupRects[String(node.groupId)] = rect;
      return;
    }

    const available = node.axis === "inline" ? rect.inlineSize : rect.blockSize;
    const splitState = resolveSplitState(node, constraintContext);
    const persistedCollapsed = new Set(splitState.collapsedChildIds.map(String));
    const allocation = allocateAxis(
      node.children.map((childId, index) => {
        const weight = safeDimension(splitState.weights[index], 1) || 1;
        const childBox = deriveConstraints(childId, constraintContext);
        const constraints = constraintsForAxis(childBox, node.axis);
        const aspectPreferred =
          childBox.preferredAspectRatio === undefined
            ? undefined
            : node.axis === "inline"
              ? rect.blockSize * childBox.preferredAspectRatio
              : rect.inlineSize / childBox.preferredAspectRatio;
        return {
          key: String(childId),
          weight,
          collapsed: persistedCollapsed.has(String(childId)),
          constraints: {
            ...constraints,
            ...(aspectPreferred === undefined
              ? {}
              : {
                  preferred: Math.min(constraints.max, Math.max(constraints.min, aspectPreferred)),
                }),
            grow: constraints.grow * weight,
            // A larger canonical weight requests more of the axis. Treat it as
            // growth priority and inverse shrink pressure so increasing a
            // child's weight is monotonic even when preferred sizes overflow.
            shrink: constraints.shrink / weight,
          },
        };
      }),
      available,
      splitterSize,
    );
    diagnostics.push(
      ...allocation.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId: key })),
    );

    const activePositionByIndex = new Map(
      allocation.activeIndices.map((childIndex, activePosition) => [childIndex, activePosition]),
    );
    let cursor = node.axis === "inline" ? rect.inlineStart : rect.blockStart;

    for (const [childIndex, childId] of node.children.entries()) {
      const childSize = allocation.sizes[childIndex] ?? 0;
      const activePosition = activePositionByIndex.get(childIndex);
      if (activePosition === undefined) {
        nodeRects[String(childId)] = zeroRect(rect, node.axis, cursor);
        collapsedNodeIds.push(String(childId));
        continue;
      }

      const childRect = rectForChild(rect, node.axis, cursor, childSize);
      visit(childId, childRect);
      cursor += childSize;

      if (activePosition < allocation.activeIndices.length - 1) {
        const nextIndex = allocation.activeIndices[activePosition + 1];
        const afterNodeId = nextIndex === undefined ? undefined : node.children[nextIndex];
        if (afterNodeId === undefined) {
          throw new RangeError("Axis allocation referenced a child outside the split node.");
        }
        const size = allocation.splitterSizes[activePosition] ?? 0;
        const splitterRect = rectForChild(rect, node.axis, cursor, size);
        splitters.push({
          id: `${key}:splitter:${String(childId)}:${String(afterNodeId)}`,
          splitNodeId: key,
          axis: node.axis,
          beforeNodeId: String(childId),
          afterNodeId: String(afterNodeId),
          rect: splitterRect,
        });
        cursor += size;
      }
    }
  };

  const sanitizeBound = (value: number, kind: "origin" | "size", name: string): number => {
    const safe =
      Number.isFinite(value) && (kind === "origin" || value >= 0) ? Math.round(value) : 0;
    if (safe !== value) {
      diagnostics.push({
        code: "INVALID_BOUNDS",
        message: `${name} ${String(value)} was rounded or clamped to ${safe}.`,
      });
    }
    return safe;
  };
  visit(rootNodeId, {
    inlineStart: sanitizeBound(bounds.inlineStart, "origin", "inlineStart"),
    blockStart: sanitizeBound(bounds.blockStart, "origin", "blockStart"),
    inlineSize: sanitizeBound(bounds.inlineSize, "size", "inlineSize"),
    blockSize: sanitizeBound(bounds.blockSize, "size", "blockSize"),
  });

  return {
    rootNodeId: String(rootNodeId),
    nodeRects,
    groupRects,
    splitters,
    collapsedNodeIds,
    diagnostics,
  };
}
