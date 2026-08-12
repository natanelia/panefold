import manifestSchema from "../schema/manifest.schema.json";
import { describe, expect, it } from "vitest";

import currentManifest from "../../../conformance/manifest.json";
import { validateConformanceManifest } from "../src";

describe("conformance manifest", () => {
  it("validates the current explicit experimental profiles", () => {
    const audit = validateConformanceManifest(currentManifest);

    expect(audit.valid).toBe(true);
    expect(audit.value?.classification).toBe("experimental");
    expect(audit.value?.profiles).toHaveLength(2);
    expect(audit.issues).toEqual([]);
  });

  it("rejects claim inflation, unknown fields, duplicate values, and invalid dates", () => {
    const audit = validateConformanceManifest({
      engineVersion: "v1",
      classification: "stable",
      generatedAt: "2026-02-30",
      profiles: [
        {
          id: "desktop",
          status: "stable",
          framework: "React",
          browser: "Chromium",
          surfaces: ["main", "main"],
          inputs: ["keyboard"],
          workload: "compact",
          accessibility: ["keyboard-only"],
        },
      ],
      unsupported: [],
      telemetryDefault: "on",
      surprise: true,
    });

    expect(audit.valid).toBe(false);
    expect(audit.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ITEM",
        "INVALID_ENGINE_VERSION",
        "INVALID_GENERATED_DATE",
        "KNOWN_LIMITATIONS_UNRESOLVED",
        "TELEMETRY_DEFAULT_NOT_OFF",
        "UNKNOWN_MANIFEST_FIELD",
      ]),
    );
  });

  it("does not evaluate accessors at the validation boundary", () => {
    const hostile = Object.defineProperty({}, "engineVersion", {
      enumerable: true,
      get: () => {
        throw new Error("must not run");
      },
    });

    expect(validateConformanceManifest(hostile).issues[0]?.code).toBe("INVALID_MANIFEST");
  });

  it("publishes a closed Draft 2020-12 schema aligned with the runtime validator", () => {
    expect(manifestSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(manifestSchema.additionalProperties).toBe(false);
    expect(manifestSchema.required).toEqual(
      expect.arrayContaining([
        "engineVersion",
        "classification",
        "profiles",
        "unsupported",
        "telemetryDefault",
      ]),
    );
    expect(manifestSchema.properties.classification.enum).toEqual([
      "stable",
      "experimental",
      "deprecated",
      "unsupported",
    ]);
  });
});
