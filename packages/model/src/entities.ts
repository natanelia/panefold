import type { ClosedPanelId, GroupId, NodeId, PanelId, Revision, SurfaceId } from "./ids";
import type { JsonObject, JsonValue } from "./json";

export type LogicalAxis = "inline" | "block";
export type LogicalEdge = "inline-start" | "inline-end" | "block-start" | "block-end";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PanelConstraints {
  readonly hardMinInline?: number;
  readonly hardMinBlock?: number;
  readonly preferredMinInline?: number;
  readonly preferredMinBlock?: number;
  readonly preferredInline?: number;
  readonly preferredBlock?: number;
  readonly maxInline?: number;
  readonly maxBlock?: number;
  readonly grow?: number;
  readonly shrink?: number;
  readonly collapsible?: boolean;
  readonly collapsePriority?: number;
  readonly preferredAspectRatio?: number;
  readonly resizeDelivery?: "live" | "throttled" | "deferred" | "adaptive";
}

export interface PanelCapabilities {
  readonly closable: boolean;
  readonly floatable: boolean;
  readonly popout: boolean;
  readonly pictureInPicture: boolean;
  readonly singleton: boolean;
}

export interface PanelLifecyclePolicy {
  readonly hidden: "keep-alive" | "detach" | "suspend" | "application-managed";
  readonly sameDocumentMove: "preserve-host" | "remount";
  readonly crossDocumentMove: "unsupported" | "checkpoint-remount" | "portal-coupled" | "mirror";
}

export const DEFAULT_PANEL_CAPABILITIES: PanelCapabilities = Object.freeze({
  closable: true,
  floatable: true,
  popout: false,
  pictureInPicture: false,
  singleton: false,
});

export const DEFAULT_PANEL_LIFECYCLE: PanelLifecyclePolicy = Object.freeze({
  hidden: "keep-alive",
  sameDocumentMove: "preserve-host",
  crossDocumentMove: "unsupported",
});

export interface PanelRecord {
  readonly id: PanelId;
  readonly type: string;
  readonly typeVersion: number;
  readonly title?: string;
  readonly parameters: JsonValue;
  readonly capabilities: PanelCapabilities;
  readonly constraints: PanelConstraints;
  readonly lifecycle: PanelLifecyclePolicy;
  readonly checkpointRef?: string;
}

export interface GroupRecord {
  readonly id: GroupId;
  readonly panelIds: readonly PanelId[];
  readonly selectedPanelId: PanelId;
  readonly region?: string;
  readonly persistent: boolean;
  /**
   * A temporary empty destination retained only when removing it would make
   * recoverable panels impossible to reopen. Canonicalization clears this as
   * soon as the group receives a panel.
   */
  readonly placeholder?: boolean;
}

export interface SplitNode {
  readonly kind: "split";
  readonly id: NodeId;
  readonly axis: LogicalAxis;
  readonly children: readonly NodeId[];
  /** Positive integer proportions. Canonicalization normalizes their sum. */
  readonly weights: readonly number[];
  /** Persisted because collapse and restore are semantic, undoable operations. */
  readonly collapsedChildIds: readonly NodeId[];
}

export interface GroupNode {
  readonly kind: "group";
  readonly id: NodeId;
  readonly groupId: GroupId;
}

export type LayoutNode = SplitNode | GroupNode;

export type SurfaceKind = "main" | "embedded" | "floating" | "browser-window" | "document-pip";

export interface SurfaceCapabilities {
  readonly nestedLayout: boolean;
  readonly floating: boolean;
  readonly popout: boolean;
  readonly alwaysOnTop: boolean;
  readonly freePositioning: boolean;
  readonly crossDocument: boolean;
  readonly multiScreenPlacement: boolean;
}

export const MAIN_SURFACE_CAPABILITIES: SurfaceCapabilities = Object.freeze({
  nestedLayout: true,
  floating: true,
  popout: false,
  alwaysOnTop: false,
  freePositioning: false,
  crossDocument: false,
  multiScreenPlacement: false,
});

export const FLOATING_SURFACE_CAPABILITIES: SurfaceCapabilities = Object.freeze({
  nestedLayout: true,
  floating: true,
  popout: false,
  alwaysOnTop: false,
  freePositioning: true,
  crossDocument: false,
  multiScreenPlacement: false,
});

export const BROWSER_WINDOW_SURFACE_CAPABILITIES: SurfaceCapabilities = Object.freeze({
  nestedLayout: true,
  floating: false,
  popout: true,
  alwaysOnTop: false,
  freePositioning: true,
  crossDocument: true,
  multiScreenPlacement: true,
});

export const PICTURE_IN_PICTURE_SURFACE_CAPABILITIES: SurfaceCapabilities = Object.freeze({
  nestedLayout: false,
  floating: false,
  popout: false,
  alwaysOnTop: true,
  freePositioning: false,
  crossDocument: true,
  multiScreenPlacement: false,
});

export interface SurfaceRecord {
  readonly id: SurfaceId;
  readonly kind: SurfaceKind;
  readonly rootNodeId: NodeId;
  readonly capabilities: SurfaceCapabilities;
  readonly bounds?: Rect;
  readonly restoreBounds?: Rect;
  readonly maximized: boolean;
  readonly minimized?: boolean;
  readonly ownerEpoch?: number;
}

export interface AppliedRemoteTransaction {
  readonly id: string;
  readonly actorId: string;
  readonly surfaceId: SurfaceId;
  readonly ownerEpoch: number;
}

export const APPLIED_REMOTE_TRANSACTION_LIMIT = 4_096;

export interface TabPlacement {
  readonly groupId: GroupId;
  readonly beforePanelId?: PanelId;
  readonly afterPanelId?: PanelId;
}

export interface ClosedPanelRecord {
  readonly id: ClosedPanelId;
  readonly panel: PanelRecord;
  readonly formerPlacement: TabPlacement;
  readonly closedAtRevision: Revision;
}

export interface ActivationState {
  readonly activePanelId?: PanelId;
  readonly activeSurfaceId?: SurfaceId;
}

export type FocusFallback = "panel-root" | "selected-tab" | "group-header" | "workspace-root";

/** Serializable focus hints only. DOM WeakRefs belong to the runtime. */
export interface FocusMemoryDescriptor {
  readonly panelId?: PanelId;
  readonly groupId?: GroupId;
  readonly restorationToken?: string;
  readonly fallback: FocusFallback;
}

export interface EntityTable<Id extends string, Entity extends { readonly id: Id }> {
  readonly ids: readonly Id[];
  readonly byId: Readonly<Record<string, Entity>>;
}

const CANONICAL_IMMUTABLES = new WeakSet<object>();

function freezeGraph(value: object): void {
  const stack = [value];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && "value" in descriptor) {
        const child = descriptor.value as unknown;
        if ((typeof child === "object" && child !== null) || typeof child === "function") {
          stack.push(child as object);
        }
      }
    }
    Object.freeze(current);
    CANONICAL_IMMUTABLES.add(current);
  }
}

/**
 * Takes ownership of plain structured data without retaining any mutable
 * caller reference. Values already produced by this function are returned as
 * is, which preserves structural sharing across kernel revisions.
 */
export function cloneAndFreeze<T>(value: T): T {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return value;
  }
  if (CANONICAL_IMMUTABLES.has(value as object)) return value;
  const clone = structuredClone(value);
  freezeGraph(clone as object);
  return clone;
}

export function createEntityTable<Id extends string, Entity extends { readonly id: Id }>(
  entities: readonly Entity[] = [],
): EntityTable<Id, Entity> {
  const sorted = entities
    .map((entity) => cloneAndFreeze(entity))
    .sort((left, right) => {
      const leftId = String(left.id);
      const rightId = String(right.id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  const byId: Record<string, Entity> = Object.create(null) as Record<string, Entity>;

  for (const entity of sorted) {
    const key = String(entity.id);
    if (Object.hasOwn(byId, key)) {
      throw new TypeError(`Duplicate entity id: ${key}`);
    }
    byId[key] = entity;
  }

  return Object.freeze({
    ids: cloneAndFreeze(sorted.map((entity) => entity.id)),
    byId: Object.freeze(byId),
  });
}

export function getEntity<Id extends string, Entity extends { readonly id: Id }>(
  table: EntityTable<Id, Entity>,
  id: Id,
): Entity | undefined {
  return table.byId[String(id)];
}

export interface WorkspaceSnapshot {
  readonly schemaVersion: number;
  readonly applicationLayoutVersion: number;
  readonly revision: Revision;
  readonly panels: EntityTable<PanelId, PanelRecord>;
  readonly groups: EntityTable<GroupId, GroupRecord>;
  readonly nodes: EntityTable<NodeId, LayoutNode>;
  readonly surfaces: EntityTable<SurfaceId, SurfaceRecord>;
  readonly activation: ActivationState;
  readonly focusMemory: FocusMemoryDescriptor;
  readonly floatingOrder: readonly SurfaceId[];
  readonly recoverableClosedPanels: readonly ClosedPanelRecord[];
  readonly appliedRemoteTransactions: readonly AppliedRemoteTransaction[];
  readonly metadata: JsonObject;
}
