import {
  cloneAndFreeze,
  createTransactionCommittedEffectIntent,
  createEntityTable,
  type CommittedTransaction,
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

import { canonicalSerialize } from "./hash";
import { validateWorkspace } from "./invariants";

function matches(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function assertMatch(actual: unknown, expected: unknown, path: string): void {
  if (!matches(actual, expected)) {
    throw new RangeError(`Patch precondition failed at ${path}`);
  }
}

function tableMap<Id extends string, Entity extends { readonly id: Id }>(
  table: EntityTable<Id, Entity>,
): Map<Id, Entity> {
  return new Map(
    table.ids.map((id) => {
      const entity = table.byId[String(id)];
      if (entity === undefined) throw new RangeError(`Entity table is missing ${String(id)}`);
      return [id, entity];
    }),
  );
}

function applyEntityDelta<Id extends string, Entity extends { readonly id: Id }>(
  map: Map<Id, Entity>,
  patch: { readonly id: Id; readonly before?: Entity; readonly after?: Entity },
  kind: string,
): void {
  assertMatch(map.get(patch.id), patch.before, `${kind}.${String(patch.id)}`);
  if (patch.after === undefined) map.delete(patch.id);
  else map.set(patch.id, patch.after);
}

/**
 * Applies a kernel patch set to an immutable snapshot while preserving every
 * untouched top-level table and value by reference. Preconditions make stale
 * or reordered patch streams fail loudly instead of silently corrupting a
 * projection.
 */
export function applyPatches(
  snapshot: WorkspaceSnapshot,
  patches: readonly WorkspacePatch[],
  revision: Revision,
): WorkspaceSnapshot {
  if (revision < 0n) throw new RangeError("Patch revision must be non-negative");

  let panels: Map<PanelId, PanelRecord> | undefined;
  let groups: Map<GroupId, GroupRecord> | undefined;
  let nodes: Map<NodeId, LayoutNode> | undefined;
  let surfaces: Map<SurfaceId, SurfaceRecord> | undefined;
  let activation = snapshot.activation;
  let focusMemory = snapshot.focusMemory;
  let floatingOrder = snapshot.floatingOrder;
  let recoverableClosedPanels = snapshot.recoverableClosedPanels;
  let appliedRemoteTransactions = snapshot.appliedRemoteTransactions;
  let metadata = snapshot.metadata;
  let schemaVersion = snapshot.schemaVersion;
  let applicationLayoutVersion = snapshot.applicationLayoutVersion;

  for (const patch of patches) {
    switch (patch.kind) {
      case "versions":
        assertMatch({ schemaVersion, applicationLayoutVersion }, patch.before, patch.kind);
        schemaVersion = patch.after.schemaVersion;
        applicationLayoutVersion = patch.after.applicationLayoutVersion;
        break;
      case "panel":
        panels ??= tableMap(snapshot.panels);
        applyEntityDelta(panels, patch, patch.kind);
        break;
      case "group":
        groups ??= tableMap(snapshot.groups);
        applyEntityDelta(groups, patch, patch.kind);
        break;
      case "node":
        nodes ??= tableMap(snapshot.nodes);
        applyEntityDelta(nodes, patch, patch.kind);
        break;
      case "surface":
        surfaces ??= tableMap(snapshot.surfaces);
        applyEntityDelta(surfaces, patch, patch.kind);
        break;
      case "activation":
        assertMatch(activation, patch.before, patch.kind);
        activation = patch.after;
        break;
      case "focus-memory":
        assertMatch(focusMemory, patch.before, patch.kind);
        focusMemory = patch.after;
        break;
      case "floating-order":
        assertMatch(floatingOrder, patch.before, patch.kind);
        floatingOrder = patch.after;
        break;
      case "closed-panels":
        assertMatch(recoverableClosedPanels, patch.before, patch.kind);
        recoverableClosedPanels = patch.after;
        break;
      case "remote-transactions":
        assertMatch(appliedRemoteTransactions, patch.before, patch.kind);
        appliedRemoteTransactions = patch.after;
        break;
      case "metadata":
        assertMatch(metadata, patch.before, patch.kind);
        metadata = patch.after;
        break;
    }
  }

  const next: WorkspaceSnapshot = Object.freeze({
    ...snapshot,
    revision,
    schemaVersion,
    applicationLayoutVersion,
    panels:
      panels === undefined
        ? snapshot.panels
        : createEntityTable<PanelId, PanelRecord>([...panels.values()]),
    groups:
      groups === undefined
        ? snapshot.groups
        : createEntityTable<GroupId, GroupRecord>([...groups.values()]),
    nodes:
      nodes === undefined
        ? snapshot.nodes
        : createEntityTable<NodeId, LayoutNode>([...nodes.values()]),
    surfaces:
      surfaces === undefined
        ? snapshot.surfaces
        : createEntityTable<SurfaceId, SurfaceRecord>([...surfaces.values()]),
    activation: cloneAndFreeze(activation),
    focusMemory: cloneAndFreeze(focusMemory),
    floatingOrder: cloneAndFreeze(floatingOrder),
    recoverableClosedPanels: cloneAndFreeze(recoverableClosedPanels),
    appliedRemoteTransactions: cloneAndFreeze(appliedRemoteTransactions),
    metadata: cloneAndFreeze(metadata),
  });
  const violations = validateWorkspace(next);
  if (violations.length > 0) {
    throw new RangeError(`Applied patches violate workspace invariants: ${violations[0]?.message}`);
  }
  return next;
}

export function applyTransaction(
  snapshot: WorkspaceSnapshot,
  transaction: CommittedTransaction,
): WorkspaceSnapshot {
  if (snapshot.revision !== transaction.previousRevision) {
    throw new RangeError(
      `Transaction expects revision ${transaction.previousRevision}, received ${snapshot.revision}`,
    );
  }
  if (transaction.revision !== transaction.previousRevision + 1n) {
    throw new RangeError("Committed transaction revision must advance exactly once");
  }
  if (!Array.isArray(transaction.effects) || transaction.effects.length === 0) {
    throw new RangeError("Committed transaction must carry at least one effect intent");
  }
  for (const [ordinal, effect] of transaction.effects.entries()) {
    const expected = createTransactionCommittedEffectIntent({
      transactionId: transaction.id,
      previousRevision: transaction.previousRevision,
      revision: transaction.revision,
      ordinal,
      commandType: transaction.command.type,
      origin: transaction.origin,
    });
    if (
      effect.id !== expected.id ||
      effect.kind !== expected.kind ||
      effect.class !== expected.class ||
      effect.transactionId !== expected.transactionId ||
      effect.previousRevision !== expected.previousRevision ||
      effect.revision !== expected.revision ||
      effect.ordinal !== expected.ordinal ||
      effect.payload.commandType !== expected.payload.commandType ||
      effect.payload.origin !== expected.payload.origin
    ) {
      throw new RangeError(`Transaction effect intent ${String(ordinal)} has invalid identity`);
    }
  }
  return applyPatches(snapshot, transaction.patches, transaction.revision);
}

/** Reverse-order inverse suitable for rollback projections and differential tests. */
export function invertPatches(patches: readonly WorkspacePatch[]): readonly WorkspacePatch[] {
  return [...patches].reverse().map((patch): WorkspacePatch => {
    switch (patch.kind) {
      case "panel":
      case "group":
      case "node":
      case "surface":
        return {
          kind: patch.kind,
          id: patch.id as never,
          ...(patch.after === undefined ? {} : { before: patch.after as never }),
          ...(patch.before === undefined ? {} : { after: patch.before as never }),
        } as WorkspacePatch;
      case "activation":
      case "versions":
      case "focus-memory":
      case "floating-order":
      case "closed-panels":
      case "remote-transactions":
      case "metadata":
        return { ...patch, before: patch.after, after: patch.before } as WorkspacePatch;
    }
  });
}
