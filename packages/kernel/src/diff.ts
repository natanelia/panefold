import { type EntityTable, type WorkspacePatch, type WorkspaceSnapshot } from "@panefold/model";
import { canonicalSerialize } from "./hash";
import { compareCanonicalStrings } from "./internal";

const equal = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return canonicalSerialize(left) === canonicalSerialize(right);
};

function tablePatches<
  Id extends string,
  Entity extends { readonly id: Id },
  Kind extends "panel" | "group" | "node" | "surface",
>(kind: Kind, before: EntityTable<Id, Entity>, after: EntityTable<Id, Entity>): WorkspacePatch[] {
  const ids = [...new Set([...before.ids, ...after.ids])].sort((left, right) =>
    compareCanonicalStrings(String(left), String(right)),
  );
  const patches: WorkspacePatch[] = [];
  for (const id of ids) {
    const previous = before.byId[String(id)];
    const next = after.byId[String(id)];
    if (equal(previous, next)) continue;
    // The generic relationship is deliberately contained here. Each branch
    // constructs the exact discriminated public patch shape.
    switch (kind) {
      case "panel":
        patches.push({
          kind,
          id: id as never,
          ...(previous === undefined ? {} : { before: previous as never }),
          ...(next === undefined ? {} : { after: next as never }),
        });
        break;
      case "group":
        patches.push({
          kind,
          id: id as never,
          ...(previous === undefined ? {} : { before: previous as never }),
          ...(next === undefined ? {} : { after: next as never }),
        });
        break;
      case "node":
        patches.push({
          kind,
          id: id as never,
          ...(previous === undefined ? {} : { before: previous as never }),
          ...(next === undefined ? {} : { after: next as never }),
        });
        break;
      case "surface":
        patches.push({
          kind,
          id: id as never,
          ...(previous === undefined ? {} : { before: previous as never }),
          ...(next === undefined ? {} : { after: next as never }),
        });
        break;
    }
  }
  return patches;
}

export function diffSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): readonly WorkspacePatch[] {
  const patches: WorkspacePatch[] = [
    ...tablePatches("panel", before.panels, after.panels),
    ...tablePatches("group", before.groups, after.groups),
    ...tablePatches("node", before.nodes, after.nodes),
    ...tablePatches("surface", before.surfaces, after.surfaces),
  ];

  if (!equal(before.activation, after.activation)) {
    patches.push({
      kind: "activation",
      before: before.activation,
      after: after.activation,
    });
  }
  if (!equal(before.focusMemory, after.focusMemory)) {
    patches.push({
      kind: "focus-memory",
      before: before.focusMemory,
      after: after.focusMemory,
    });
  }
  if (!equal(before.floatingOrder, after.floatingOrder)) {
    patches.push({
      kind: "floating-order",
      before: before.floatingOrder,
      after: after.floatingOrder,
    });
  }
  if (!equal(before.recoverableClosedPanels, after.recoverableClosedPanels)) {
    patches.push({
      kind: "closed-panels",
      before: before.recoverableClosedPanels,
      after: after.recoverableClosedPanels,
    });
  }
  if (!equal(before.metadata, after.metadata)) {
    patches.push({
      kind: "metadata",
      before: before.metadata,
      after: after.metadata,
    });
  }
  return patches;
}
