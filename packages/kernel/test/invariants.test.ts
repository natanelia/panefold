import fc from "fast-check";
import {
  panelId,
  type EntityTable,
  type PanelRecord,
  type Revision,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { describe, expect, it } from "vitest";

import { validateEntityTable, validateWorkspace } from "../src";
import { fixtureSnapshot, ids } from "./fixtures";

interface TestEntity {
  readonly id: string;
  readonly value: number;
}

function table(entityIds: readonly string[]): EntityTable<string, TestEntity> {
  const sorted = [...entityIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    ids: sorted,
    byId: Object.fromEntries(sorted.map((id, value) => [id, { id, value }])),
  };
}

const codes = (value: EntityTable<string, TestEntity>): readonly string[] =>
  validateEntityTable("entities", value).map((item) => item.code);

describe("entity-table integrity", () => {
  it("accepts every exact canonical workspace entity table", () => {
    const snapshot = fixtureSnapshot();
    expect(validateEntityTable("panels", snapshot.panels)).toEqual([]);
    expect(validateEntityTable("groups", snapshot.groups)).toEqual([]);
    expect(validateEntityTable("nodes", snapshot.nodes)).toEqual([]);
    expect(validateEntityTable("surfaces", snapshot.surfaces)).toEqual([]);
  });

  it("rejects a key that disagrees with entity.id", () => {
    const valid = table(["entity:a", "entity:b"]);
    const mismatched: EntityTable<string, TestEntity> = {
      ...valid,
      byId: {
        ...valid.byId,
        "entity:a": { id: "entity:wrong", value: 0 },
      },
    };
    expect(codes(mismatched)).toContain("ENTITY_ID_KEY_MISMATCH");
  });

  it("rejects a missing keyed value", () => {
    const valid = table(["entity:a", "entity:b"]);
    const missing: EntityTable<string, TestEntity> = {
      ...valid,
      byId: { "entity:b": valid.byId["entity:b"] as TestEntity },
    };
    expect(codes(missing)).toContain("MISSING_TABLE_ENTRY");
  });

  it("rejects an unlisted extra keyed value", () => {
    const valid = table(["entity:a", "entity:b"]);
    const extra: EntityTable<string, TestEntity> = {
      ...valid,
      byId: {
        ...valid.byId,
        "entity:extra": { id: "entity:extra", value: 2 },
      },
    };
    expect(codes(extra)).toContain("EXTRA_TABLE_ENTRY");
  });

  it("rejects duplicate and non-canonically ordered ID inventories", () => {
    const valid = table(["entity:a", "entity:b"]);
    expect(codes({ ...valid, ids: ["entity:a", "entity:a", "entity:b"] })).toContain(
      "DUPLICATE_TABLE_ID",
    );
    expect(codes({ ...valid, ids: [...valid.ids].reverse() })).toContain(
      "NON_CANONICAL_TABLE_ORDER",
    );
  });

  it("integrates table checks into full workspace validation", () => {
    const snapshot = fixtureSnapshot();
    const original = snapshot.panels.byId[ids.panels[0]] as PanelRecord;
    const corrupted: WorkspaceSnapshot = {
      ...snapshot,
      panels: {
        ...snapshot.panels,
        byId: {
          ...snapshot.panels.byId,
          [ids.panels[0]]: {
            ...original,
            id: panelId("panel:wrong-key"),
          },
        },
      },
    };
    expect(validateWorkspace(corrupted)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ENTITY_ID_KEY_MISMATCH",
          path: `panels.byId.${ids.panels[0]}.id`,
        }),
      ]),
    );
  });

  it("checks table perturbations for arbitrary unique inventories", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 1_000_000 }), {
          minLength: 2,
          maxLength: 40,
        }),
        (values) => {
          const valid = table(values.map((value) => `entity:${String(value).padStart(7, "0")}`));
          expect(validateEntityTable("entities", valid)).toEqual([]);

          const first = valid.ids[0] as string;
          const withoutFirst = { ...valid.byId };
          delete withoutFirst[first];
          expect(codes({ ...valid, byId: withoutFirst })).toContain("MISSING_TABLE_ENTRY");

          expect(
            codes({
              ...valid,
              byId: {
                ...valid.byId,
                "entity:extra": { id: "entity:extra", value: -1 },
              },
            }),
          ).toContain("EXTRA_TABLE_ENTRY");

          expect(
            codes({
              ...valid,
              byId: {
                ...valid.byId,
                [first]: { id: "entity:mismatch", value: -1 },
              },
            }),
          ).toContain("ENTITY_ID_KEY_MISMATCH");

          expect(codes({ ...valid, ids: [...valid.ids, first] })).toContain("DUPLICATE_TABLE_ID");
          expect(codes({ ...valid, ids: [...valid.ids].reverse() })).toContain(
            "NON_CANONICAL_TABLE_ORDER",
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("scalar integrity", () => {
  it("rejects a negative revision and non-JSON persisted scalar data", () => {
    const snapshot = fixtureSnapshot();
    const panel = snapshot.panels.byId[ids.panels[0]] as PanelRecord;
    const invalid: WorkspaceSnapshot = {
      ...snapshot,
      revision: -1n as Revision,
      panels: {
        ...snapshot.panels,
        byId: {
          ...snapshot.panels.byId,
          [ids.panels[0]]: {
            ...panel,
            parameters: Number.NaN as never,
          },
        },
      },
      metadata: { invalid: Number.POSITIVE_INFINITY },
    };
    const violations = validateWorkspace(invalid);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_REVISION", path: "revision" }),
        expect.objectContaining({ code: "INVALID_PANEL_PARAMETERS" }),
        expect.objectContaining({ code: "INVALID_METADATA", path: "metadata" }),
      ]),
    );
  });

  it("rejects non-finite panel constraints", () => {
    const snapshot = fixtureSnapshot();
    const panel = snapshot.panels.byId[ids.panels[0]] as PanelRecord;
    const corrupted: WorkspaceSnapshot = {
      ...snapshot,
      panels: {
        ...snapshot.panels,
        byId: {
          ...snapshot.panels.byId,
          [ids.panels[0]]: {
            ...panel,
            constraints: { ...panel.constraints, hardMinInline: Number.POSITIVE_INFINITY },
          },
        },
      },
    };
    expect(validateWorkspace(corrupted)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_PANEL_CONSTRAINT",
          path: `panels.${ids.panels[0]}.constraints.hardMinInline`,
        }),
      ]),
    );
  });
});
