import { describe, expect, it } from "vitest";

import {
  createPanelTypeRegistry,
  createVersionedPanelDataCodec,
  definePanel,
  definePanels,
  panelId,
  type InferPanelCheckpoint,
  type InferPanelParameters,
  type JsonValue,
} from "../src";

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const parameters = createVersionedPanelDataCodec({
  currentVersion: 2,
  migrations: {
    1: (value) => ({ mapId: isJsonObject(value) ? (value.id ?? "unknown") : "unknown" }),
  },
  validate: (value): value is { readonly mapId: string } =>
    isJsonObject(value) && typeof value.mapId === "string",
});

const checkpoint = createVersionedPanelDataCodec({
  currentVersion: 1,
  validate: (value): value is { readonly center: readonly [number, number] } =>
    isJsonObject(value) &&
    Array.isArray(value.center) &&
    value.center.length === 2 &&
    value.center.every(Number.isFinite),
});

const mapPanel = definePanel({
  type: "map.canvas",
  version: 3,
  parameters,
  checkpoint,
});

type MapParameters = InferPanelParameters<typeof mapPanel>;
type MapCheckpoint = InferPanelCheckpoint<typeof mapPanel>;

describe("typed panel registry", () => {
  it("infers parameters and checkpoints and migrates bounded input", () => {
    const typedParameters: MapParameters = { mapId: "atlas" };
    const typedCheckpoint: MapCheckpoint = { center: [1, 2] };
    expect(parameters.encode(typedParameters)).toEqual({ mapId: "atlas" });
    expect(checkpoint.encode(typedCheckpoint)).toEqual({ center: [1, 2] });
    const registry = createPanelTypeRegistry([mapPanel]);
    const result = registry.createPanelRecord({
      id: panelId("panel:map"),
      type: "map.canvas",
      parameterVersion: 1,
      parameters: { id: "migrated" },
    });
    expect(result).toMatchObject({
      ok: true,
      panel: { type: "map.canvas", typeVersion: 3, parameters: { mapId: "migrated" } },
    });
    expect(registry.decodeCheckpoint("map.canvas", { center: [1, 2] }, 1)).toMatchObject({
      ok: true,
      migrated: false,
    });
  });

  it("retains unavailable types and rejected source data for recovery", () => {
    const registry = createPanelTypeRegistry([mapPanel]);
    expect(
      registry.createPanelRecord({
        id: panelId("panel:missing"),
        type: "vendor.missing",
        parameterVersion: 1,
        parameters: { private: "preserved" },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        status: "missing-panel-type",
        recoverable: true,
        panel: { type: "vendor.missing", parameters: { private: "preserved" } },
      },
    });
    const rejected = parameters.decode({ mapId: "x".repeat(10) }, 2);
    expect(rejected.ok).toBe(true);
    expect(parameters.decode({ mapId: Number.NaN }, 2)).toMatchObject({
      ok: false,
      error: { code: "INVALID_JSON" },
    });
  });

  it("validates registry identity and migration availability", () => {
    expect(() => definePanels({ wrong: mapPanel })).toThrow(/does not match/u);
    expect(parameters.decode({ mapId: "future" }, 3)).toMatchObject({
      ok: false,
      error: { code: "FUTURE_VERSION" },
    });
    const missingMigration = createVersionedPanelDataCodec({
      currentVersion: 2,
      validate: (value): value is null => value === null,
    });
    expect(missingMigration.decode(null, 1)).toMatchObject({
      ok: false,
      error: { code: "MIGRATION_MISSING" },
    });
  });
});
