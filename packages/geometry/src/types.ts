export type LogicalAxis = "inline" | "block";

export interface LogicalRect {
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineSize: number;
  readonly blockSize: number;
}

export interface LogicalPoint {
  readonly inline: number;
  readonly block: number;
}

export interface AxisConstraints {
  /** Lowest usable size. It is violated only by the explicit emergency path. */
  readonly min?: number;
  /** Quality target used before weight-based growth or shrinkage. */
  readonly preferred?: number;
  /** Largest desired size. It is violated only when exact conservation requires it. */
  readonly max?: number;
  readonly grow?: number;
  readonly shrink?: number;
  readonly collapsible?: boolean;
  /** Lower values collapse first. Input order is the stable tie-breaker. */
  readonly collapsePriority?: number;
}

export interface BoxConstraints {
  readonly inline?: AxisConstraints;
  readonly block?: AxisConstraints;
}

export interface AllocationItem {
  readonly key: string;
  readonly weight?: number;
  readonly constraints?: AxisConstraints;
  /** Semantic collapse is applied before constraint-driven emergency collapse. */
  readonly collapsed?: boolean;
}

export type GeometryDiagnosticCode =
  | "INVALID_AVAILABLE_SIZE"
  | "INVALID_CONSTRAINT"
  | "CHILD_COLLAPSED"
  | "HARD_MIN_VIOLATED"
  | "MAX_VIOLATED"
  | "SPLITTER_COMPRESSED"
  | "MISSING_NODE"
  | "MISSING_GROUP"
  | "MISSING_PANEL"
  | "LAYOUT_CYCLE";

export interface GeometryDiagnostic {
  readonly code: GeometryDiagnosticCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly itemKeys?: readonly string[];
}

export interface AxisAllocation {
  /** Integer lengths in the same order as the input items. Collapsed items are zero. */
  readonly sizes: readonly number[];
  /** Original item indexes that remain in layout order. */
  readonly activeIndices: readonly number[];
  /** One length between each pair of active items. */
  readonly splitterSizes: readonly number[];
  readonly collapsedKeys: readonly string[];
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export interface ResolvedSplitter {
  readonly id: string;
  readonly splitNodeId: string;
  readonly axis: LogicalAxis;
  readonly beforeNodeId: string;
  readonly afterNodeId: string;
  readonly rect: LogicalRect;
}

export interface ResolvedLayout {
  readonly rootNodeId: string;
  readonly nodeRects: Readonly<Record<string, LogicalRect>>;
  readonly groupRects: Readonly<Record<string, LogicalRect>>;
  readonly splitters: readonly ResolvedSplitter[];
  readonly collapsedNodeIds: readonly string[];
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export type LogicalEdge = "inline-start" | "inline-end" | "block-start" | "block-end";

export type DropTarget =
  | {
      readonly kind: "inside";
      readonly nodeId: string;
      readonly rect: LogicalRect;
    }
  | {
      readonly kind: "split";
      readonly nodeId: string;
      readonly edge: LogicalEdge;
      readonly rect: LogicalRect;
    };
