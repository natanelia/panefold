import { canonicalSerialize, validateWorkspace } from "@panefold/kernel";
import {
  APPLIED_REMOTE_TRANSACTION_LIMIT,
  cloneAndFreeze,
  createEntityTable,
  freezeWorkspacePatches,
  type AppliedRemoteTransaction,
  type ClosedPanelRecord,
  type Diagnostic,
  type EntityTable,
  type GroupId,
  type GroupRecord,
  type LayoutNode,
  type NodeId,
  type PanelId,
  type PanelRecord,
  type Revision,
  type SurfaceId,
  type SurfaceRecord,
  type WorkspacePatch,
  type WorkspaceSnapshot,
} from "@panefold/model";

/**
 * Mutable command-local storage used only by the independent reducer.
 *
 * The candidate deliberately shares the public model and the reference
 * validator/serializer: those are the specification boundary and comparison
 * oracle, not a semantic decision path. It does not import reference reducer,
 * canonicalizer, diff, patch application, or execution code.
 */
export interface IndependentWorkspaceDraft {
  schemaVersion: number;
  applicationLayoutVersion: number;
  revision: Revision;
  panels: Map<PanelId, PanelRecord>;
  groups: Map<GroupId, GroupRecord>;
  nodes: Map<NodeId, LayoutNode>;
  surfaces: Map<SurfaceId, SurfaceRecord>;
  activation: WorkspaceSnapshot["activation"];
  focusMemory: WorkspaceSnapshot["focusMemory"];
  floatingOrder: SurfaceId[];
  recoverableClosedPanels: ClosedPanelRecord[];
  appliedRemoteTransactions: AppliedRemoteTransaction[];
  metadata: WorkspaceSnapshot["metadata"];
}

export const OPTIMIZED_WEIGHT_TOTAL = 1_000_000;

export function compareIndependentIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tableMap<Id extends string, Entity extends { readonly id: Id }>(
  table: EntityTable<Id, Entity>,
): Map<Id, Entity> {
  return new Map(
    table.ids.map((id) => {
      const value = table.byId[String(id)];
      if (value === undefined) throw new RangeError(`Entity table is missing ${String(id)}`);
      return [id, value];
    }),
  );
}

export function createIndependentDraft(snapshot: WorkspaceSnapshot): IndependentWorkspaceDraft {
  return {
    schemaVersion: snapshot.schemaVersion,
    applicationLayoutVersion: snapshot.applicationLayoutVersion,
    revision: snapshot.revision,
    panels: tableMap(snapshot.panels),
    groups: tableMap(snapshot.groups),
    nodes: tableMap(snapshot.nodes),
    surfaces: tableMap(snapshot.surfaces),
    activation: snapshot.activation,
    focusMemory: snapshot.focusMemory,
    floatingOrder: [...snapshot.floatingOrder],
    recoverableClosedPanels: [...snapshot.recoverableClosedPanels],
    appliedRemoteTransactions: [...snapshot.appliedRemoteTransactions],
    metadata: snapshot.metadata,
  };
}

export function snapshotIndependentDraft(draft: IndependentWorkspaceDraft): WorkspaceSnapshot {
  return Object.freeze({
    schemaVersion: draft.schemaVersion,
    applicationLayoutVersion: draft.applicationLayoutVersion,
    revision: draft.revision,
    panels: createEntityTable<PanelId, PanelRecord>([...draft.panels.values()]),
    groups: createEntityTable<GroupId, GroupRecord>([...draft.groups.values()]),
    nodes: createEntityTable<NodeId, LayoutNode>([...draft.nodes.values()]),
    surfaces: createEntityTable<SurfaceId, SurfaceRecord>([...draft.surfaces.values()]),
    activation: cloneAndFreeze(draft.activation),
    focusMemory: cloneAndFreeze(draft.focusMemory),
    floatingOrder: cloneAndFreeze(draft.floatingOrder),
    recoverableClosedPanels: cloneAndFreeze(draft.recoverableClosedPanels),
    appliedRemoteTransactions: cloneAndFreeze(draft.appliedRemoteTransactions),
    metadata: cloneAndFreeze(draft.metadata),
  });
}

export function findIndependentPanelGroup(
  draft: IndependentWorkspaceDraft,
  panelId: PanelId,
): GroupRecord | undefined {
  return [...draft.groups.values()].find((group) => group.panelIds.includes(panelId));
}

export function findIndependentGroupNode(
  draft: IndependentWorkspaceDraft,
  groupId: GroupId,
): Extract<LayoutNode, { readonly kind: "group" }> | undefined {
  return [...draft.nodes.values()].find(
    (node): node is Extract<LayoutNode, { readonly kind: "group" }> =>
      node.kind === "group" && node.groupId === groupId,
  );
}

export interface IndependentNodeParent {
  readonly node: Extract<LayoutNode, { readonly kind: "split" }>;
  readonly childIndex: number;
}

export function findIndependentNodeParent(
  draft: IndependentWorkspaceDraft,
  nodeId: NodeId,
): IndependentNodeParent | undefined {
  for (const node of draft.nodes.values()) {
    if (node.kind !== "split") continue;
    const childIndex = node.children.indexOf(nodeId);
    if (childIndex >= 0) return { node, childIndex };
  }
  return undefined;
}

export function findIndependentNodeSurface(
  draft: IndependentWorkspaceDraft,
  nodeId: NodeId,
): SurfaceRecord | undefined {
  for (const surface of draft.surfaces.values()) {
    const stack = [surface.rootNodeId];
    const seen = new Set<NodeId>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      if (current === nodeId) return surface;
      seen.add(current);
      const node = draft.nodes.get(current);
      if (node?.kind === "split") stack.push(...node.children);
    }
  }
  return undefined;
}

export function replaceIndependentNodeReference(
  draft: IndependentWorkspaceDraft,
  previousId: NodeId,
  nextId: NodeId,
): boolean {
  const parent = findIndependentNodeParent(draft, previousId);
  if (parent !== undefined) {
    const children = [...parent.node.children];
    children[parent.childIndex] = nextId;
    draft.nodes.set(parent.node.id, { ...parent.node, children });
    return true;
  }
  const surface = [...draft.surfaces.values()].find(
    (candidate) => candidate.rootNodeId === previousId,
  );
  if (surface === undefined) return false;
  draft.surfaces.set(surface.id, { ...surface, rootNodeId: nextId });
  return true;
}

export function detachIndependentNode(draft: IndependentWorkspaceDraft, nodeId: NodeId): boolean {
  const parent = findIndependentNodeParent(draft, nodeId);
  if (parent === undefined) return false;
  draft.nodes.set(parent.node.id, {
    ...parent.node,
    children: parent.node.children.filter((child) => child !== nodeId),
    weights: parent.node.weights.filter((_weight, index) => index !== parent.childIndex),
    collapsedChildIds: parent.node.collapsedChildIds.filter((child) => child !== nodeId),
  });
  return true;
}

export function insertIndependentPanels(
  current: readonly PanelId[],
  inserted: readonly PanelId[],
  beforePanelId?: PanelId,
  afterPanelId?: PanelId,
): readonly PanelId[] | undefined {
  if (beforePanelId !== undefined && afterPanelId !== undefined) return undefined;
  const retained = current.filter((id) => !inserted.includes(id));
  let index = retained.length;
  if (beforePanelId !== undefined) {
    index = retained.indexOf(beforePanelId);
    if (index < 0) return undefined;
  } else if (afterPanelId !== undefined) {
    const anchorIndex = retained.indexOf(afterPanelId);
    if (anchorIndex < 0) return undefined;
    index = anchorIndex + 1;
  }
  return [...retained.slice(0, index), ...inserted, ...retained.slice(index)];
}

export function isIndependentFiniteRect(rect: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

export function hasUniqueValues<Value>(values: readonly Value[]): boolean {
  return new Set(values).size === values.length;
}

/** Independent largest-remainder implementation used by candidate canonicalization. */
export function normalizeIndependentWeights(
  weights: readonly number[],
  total = OPTIMIZED_WEIGHT_TOTAL,
): readonly number[] {
  if (
    weights.length === 0 ||
    !Number.isSafeInteger(total) ||
    total < weights.length ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    return [...weights];
  }
  if (
    weights.every(Number.isSafeInteger) &&
    weights.reduce((sum, weight) => sum + weight, 0) === total
  ) {
    return [...weights];
  }
  const sum = weights.reduce((result, weight) => result + weight, 0);
  if (!Number.isFinite(sum) || sum <= 0) return [...weights];
  const exact = weights.map((weight) => (weight / sum) * total);
  const normalized = exact.map((value) => Math.max(1, Math.floor(value)));
  let remainder = total - normalized.reduce((result, value) => result + value, 0);
  const recipients = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const recipient of recipients) {
    if (remainder <= 0) break;
    normalized[recipient.index] = (normalized[recipient.index] ?? 0) + 1;
    remainder -= 1;
  }
  if (remainder < 0) {
    const donors = normalized
      .map((value, index) => ({ index, value }))
      .sort((left, right) => right.value - left.value || left.index - right.index);
    let excess = -remainder;
    for (const donor of donors) {
      const available = Math.max(0, (normalized[donor.index] ?? 1) - 1);
      const taken = Math.min(excess, available);
      normalized[donor.index] = (normalized[donor.index] ?? 1) - taken;
      excess -= taken;
      if (excess === 0) break;
    }
  }
  return normalized;
}

function canonicalizeGroups(draft: IndependentWorkspaceDraft): void {
  for (const group of draft.groups.values()) {
    if (group.panelIds.length === 0) {
      if (group.placeholder === false) {
        const { placeholder: _placeholder, ...rest } = group;
        void _placeholder;
        draft.groups.set(group.id, rest);
      }
      continue;
    }
    const selectedPanelId = group.panelIds.includes(group.selectedPanelId)
      ? group.selectedPanelId
      : (group.panelIds[0] as PanelId);
    if (selectedPanelId !== group.selectedPanelId || group.placeholder !== undefined) {
      const { placeholder: _placeholder, ...rest } = group;
      void _placeholder;
      draft.groups.set(group.id, { ...rest, selectedPanelId });
    }
  }
}

function canonicalizeNode(
  draft: IndependentWorkspaceDraft,
  nodeId: NodeId,
  path: ReadonlySet<NodeId>,
  diagnostics: Diagnostic[],
): NodeId | undefined {
  const node = draft.nodes.get(nodeId);
  if (node === undefined || path.has(nodeId)) return nodeId;
  if (node.kind === "group") {
    const group = draft.groups.get(node.groupId);
    if (
      group !== undefined &&
      group.panelIds.length === 0 &&
      !group.persistent &&
      (group.placeholder !== true || draft.recoverableClosedPanels.length === 0)
    ) {
      draft.groups.delete(group.id);
      draft.nodes.delete(node.id);
      diagnostics.push({
        code: "EMPTY_GROUP_REMOVED",
        severity: "info",
        message: `Removed empty transient group "${group.id}"`,
      });
      return undefined;
    }
    return node.id;
  }

  const nextPath = new Set(path);
  nextPath.add(nodeId);
  const children: NodeId[] = [];
  const weights: number[] = [];
  const collapsed = new Set<NodeId>();
  node.children.forEach((childId, index) => {
    const canonicalChildId = canonicalizeNode(draft, childId, nextPath, diagnostics);
    if (canonicalChildId === undefined) return;
    const child = draft.nodes.get(canonicalChildId);
    const parentWeight = node.weights[index] ?? 1;
    if (child?.kind === "split" && child.axis === node.axis) {
      const childWeightTotal = child.weights.reduce((sum, value) => sum + value, 0);
      child.children.forEach((grandchildId, grandchildIndex) => {
        children.push(grandchildId);
        const childWeight = child.weights[grandchildIndex] ?? 1;
        weights.push(
          childWeightTotal > 0 ? parentWeight * (childWeight / childWeightTotal) : parentWeight,
        );
        if (
          node.collapsedChildIds.includes(childId) ||
          child.collapsedChildIds.includes(grandchildId)
        ) {
          collapsed.add(grandchildId);
        }
      });
      draft.nodes.delete(child.id);
      diagnostics.push({
        code: "SAME_AXIS_SPLIT_FLATTENED",
        severity: "info",
        message: `Flattened split "${child.id}" into "${node.id}"`,
      });
      return;
    }
    children.push(canonicalChildId);
    weights.push(parentWeight);
    if (node.collapsedChildIds.includes(childId)) collapsed.add(canonicalChildId);
  });

  if (children.length === 0) {
    draft.nodes.delete(node.id);
    return undefined;
  }
  if (children.length === 1) {
    draft.nodes.delete(node.id);
    diagnostics.push({
      code: "SINGLE_CHILD_SPLIT_REMOVED",
      severity: "info",
      message: `Removed single-child split "${node.id}"`,
    });
    return children[0];
  }
  draft.nodes.set(node.id, {
    kind: "split",
    id: node.id,
    axis: node.axis,
    children,
    weights: normalizeIndependentWeights(weights),
    collapsedChildIds: children.filter((child) => collapsed.has(child)),
  });
  return node.id;
}

function canonicalizeSurfaces(draft: IndependentWorkspaceDraft, diagnostics: Diagnostic[]): void {
  const ordered = [...draft.surfaces.values()].sort((left, right) =>
    compareIndependentIds(String(left.id), String(right.id)),
  );
  for (const surface of ordered) {
    const rootNodeId = canonicalizeNode(draft, surface.rootNodeId, new Set(), diagnostics);
    if (rootNodeId === undefined) {
      draft.surfaces.delete(surface.id);
      diagnostics.push({
        code: "EMPTY_SURFACE_REMOVED",
        severity: "info",
        message: `Removed empty surface "${surface.id}"`,
      });
    } else if (rootNodeId !== surface.rootNodeId || surface.minimized === false) {
      const { minimized: _minimized, ...rest } = surface;
      void _minimized;
      draft.surfaces.set(surface.id, {
        ...rest,
        rootNodeId,
        ...(surface.minimized === true ? { minimized: true } : {}),
      });
    }
  }
  const floating = [...draft.surfaces.values()]
    .filter((surface) => surface.kind === "floating")
    .map((surface) => surface.id)
    .sort((left, right) => compareIndependentIds(String(left), String(right)));
  const live = new Set(floating);
  const seen = new Set<SurfaceId>();
  const retained = draft.floatingOrder.filter((id) => {
    if (!live.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  draft.floatingOrder = [...retained, ...floating.filter((id) => !seen.has(id))];
}

function canonicalizeActivation(draft: IndependentWorkspaceDraft): void {
  const currentPanel = draft.activation.activePanelId;
  if (currentPanel !== undefined && draft.panels.has(currentPanel)) {
    const group = findIndependentPanelGroup(draft, currentPanel);
    const node = group === undefined ? undefined : findIndependentGroupNode(draft, group.id);
    const surface = node === undefined ? undefined : findIndependentNodeSurface(draft, node.id);
    if (surface?.minimized !== true) {
      draft.activation = {
        activePanelId: currentPanel,
        ...(surface === undefined ? {} : { activeSurfaceId: surface.id }),
      };
      if (
        draft.focusMemory.panelId === undefined ||
        !draft.panels.has(draft.focusMemory.panelId) ||
        draft.focusMemory.groupId === undefined ||
        !draft.groups.has(draft.focusMemory.groupId)
      ) {
        draft.focusMemory = {
          panelId: currentPanel,
          ...(group === undefined ? {} : { groupId: group.id }),
          fallback: "selected-tab",
        };
      }
      return;
    }
  }
  const group = [...draft.groups.values()]
    .filter((candidate) => {
      if (candidate.panelIds.length === 0) return false;
      const node = findIndependentGroupNode(draft, candidate.id);
      return node !== undefined && findIndependentNodeSurface(draft, node.id)?.minimized !== true;
    })
    .sort((left, right) => compareIndependentIds(String(left.id), String(right.id)))[0];
  if (group === undefined) {
    draft.activation = {};
    draft.focusMemory = { fallback: "workspace-root" };
    return;
  }
  const node = findIndependentGroupNode(draft, group.id);
  const surface = node === undefined ? undefined : findIndependentNodeSurface(draft, node.id);
  draft.activation = {
    activePanelId: group.selectedPanelId,
    ...(surface === undefined ? {} : { activeSurfaceId: surface.id }),
  };
  draft.focusMemory = {
    panelId: group.selectedPanelId,
    groupId: group.id,
    fallback: "selected-tab",
  };
}

export function canonicalizeIndependentDraft(
  draft: IndependentWorkspaceDraft,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  canonicalizeGroups(draft);
  canonicalizeSurfaces(draft, diagnostics);
  canonicalizeActivation(draft);
  draft.recoverableClosedPanels.sort((left, right) =>
    compareIndependentIds(String(left.id), String(right.id)),
  );
  if (draft.appliedRemoteTransactions.length > APPLIED_REMOTE_TRANSACTION_LIMIT) {
    draft.appliedRemoteTransactions = draft.appliedRemoteTransactions.slice(
      -APPLIED_REMOTE_TRANSACTION_LIMIT,
    );
    diagnostics.push({
      code: "REMOTE_TRANSACTION_LEDGER_TRIMMED",
      severity: "info",
      message: `Retained the latest ${APPLIED_REMOTE_TRANSACTION_LIMIT} remote transaction receipts`,
    });
  }
  return diagnostics;
}

function equalCanonical(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function independentTablePatches<
  Id extends string,
  Entity extends { readonly id: Id },
  Kind extends "panel" | "group" | "node" | "surface",
>(kind: Kind, before: EntityTable<Id, Entity>, after: EntityTable<Id, Entity>): WorkspacePatch[] {
  const ids = [...new Set([...before.ids, ...after.ids])].sort((left, right) =>
    compareIndependentIds(String(left), String(right)),
  );
  const patches: WorkspacePatch[] = [];
  for (const id of ids) {
    const previous = before.byId[String(id)];
    const next = after.byId[String(id)];
    if (equalCanonical(previous, next)) continue;
    patches.push({
      kind,
      id,
      ...(previous === undefined ? {} : { before: previous }),
      ...(next === undefined ? {} : { after: next }),
    } as unknown as WorkspacePatch);
  }
  return patches;
}

export function diffIndependentSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): readonly WorkspacePatch[] {
  const patches: WorkspacePatch[] = [
    ...independentTablePatches("panel", before.panels, after.panels),
    ...independentTablePatches("group", before.groups, after.groups),
    ...independentTablePatches("node", before.nodes, after.nodes),
    ...independentTablePatches("surface", before.surfaces, after.surfaces),
  ];
  if (
    before.schemaVersion !== after.schemaVersion ||
    before.applicationLayoutVersion !== after.applicationLayoutVersion
  ) {
    patches.unshift({
      kind: "versions",
      before: {
        schemaVersion: before.schemaVersion,
        applicationLayoutVersion: before.applicationLayoutVersion,
      },
      after: {
        schemaVersion: after.schemaVersion,
        applicationLayoutVersion: after.applicationLayoutVersion,
      },
    });
  }
  const append = <Kind extends WorkspacePatch["kind"]>(
    kind: Kind,
    previous: unknown,
    next: unknown,
  ): void => {
    if (!equalCanonical(previous, next)) {
      patches.push({ kind, before: previous, after: next } as WorkspacePatch);
    }
  };
  append("activation", before.activation, after.activation);
  append("focus-memory", before.focusMemory, after.focusMemory);
  append("floating-order", before.floatingOrder, after.floatingOrder);
  append("closed-panels", before.recoverableClosedPanels, after.recoverableClosedPanels);
  append("remote-transactions", before.appliedRemoteTransactions, after.appliedRemoteTransactions);
  append("metadata", before.metadata, after.metadata);
  return freezeWorkspacePatches(patches);
}

export function validateIndependentCandidate(snapshot: WorkspaceSnapshot): readonly string[] {
  return validateWorkspace(snapshot).map((violation) => violation.message);
}
