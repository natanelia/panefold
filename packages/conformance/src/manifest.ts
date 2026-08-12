import {
  compareCodeUnits,
  isBoundedString,
  isIdentifier,
  isIsoDate,
  isPlainRecord,
  isSemver,
  issue,
  MAX_RECORDS,
  parseStringArray,
  result,
  unknownKeys,
} from "./internal";
import type {
  AuditResult,
  ConformanceIssue,
  ConformanceManifest,
  SupportClassification,
  SupportProfile,
} from "./types";

const MANIFEST_KEYS = new Set([
  "$schema",
  "engineVersion",
  "classification",
  "generatedAt",
  "profiles",
  "unsupported",
  "knownLimitations",
  "telemetryDefault",
]);

const PROFILE_KEYS = new Set([
  "id",
  "status",
  "framework",
  "browser",
  "surfaces",
  "inputs",
  "workload",
  "accessibility",
  "features",
]);

const CLASSIFICATIONS: ReadonlySet<SupportClassification> = new Set([
  "stable",
  "experimental",
  "deprecated",
  "unsupported",
]);

const PROFILE_STATUSES: ReadonlySet<SupportProfile["status"]> = new Set([
  "stable",
  "experimental",
  "deprecated",
]);

function parseProfile(
  input: unknown,
  path: string,
  issues: ConformanceIssue[],
): SupportProfile | undefined {
  if (!isPlainRecord(input)) {
    issues.push(issue("INVALID_PROFILE", "invalid", path, "Expected a plain profile object."));
    return undefined;
  }
  unknownKeys(input, PROFILE_KEYS).forEach((key) => {
    issues.push(
      issue("UNKNOWN_PROFILE_FIELD", "invalid", `${path}/${key}`, `Unknown profile field: ${key}`),
    );
  });

  const id = input.id;
  const status = input.status;
  const framework = input.framework;
  const browser = input.browser;
  const workload = input.workload;
  if (!isIdentifier(id)) {
    issues.push(
      issue("INVALID_PROFILE_ID", "invalid", `${path}/id`, "Invalid profile identifier."),
    );
  }
  if (typeof status !== "string" || !PROFILE_STATUSES.has(status as SupportProfile["status"])) {
    issues.push(
      issue(
        "INVALID_PROFILE_STATUS",
        "invalid",
        `${path}/status`,
        "Profile status must be stable, experimental, or deprecated.",
      ),
    );
  }
  if (!isBoundedString(framework)) {
    issues.push(
      issue("INVALID_FRAMEWORK", "invalid", `${path}/framework`, "Framework is required."),
    );
  }
  if (!isBoundedString(browser)) {
    issues.push(issue("INVALID_BROWSER", "invalid", `${path}/browser`, "Browser is required."));
  }
  if (!isBoundedString(workload)) {
    issues.push(issue("INVALID_WORKLOAD", "invalid", `${path}/workload`, "Workload is required."));
  }

  const surfaces = parseStringArray(input.surfaces, `${path}/surfaces`, issues, {
    allowEmpty: false,
    identifier: true,
  });
  const inputs = parseStringArray(input.inputs, `${path}/inputs`, issues, {
    allowEmpty: false,
    identifier: true,
  });
  const accessibility =
    input.accessibility === undefined
      ? undefined
      : parseStringArray(input.accessibility, `${path}/accessibility`, issues, {
          allowEmpty: false,
        });
  const features =
    input.features === undefined
      ? undefined
      : parseStringArray(input.features, `${path}/features`, issues, {
          allowEmpty: false,
          identifier: true,
        });

  if (input.accessibility === undefined) {
    issues.push(
      issue(
        "ACCESSIBILITY_PROFILE_UNRESOLVED",
        "unresolved",
        `${path}/accessibility`,
        "The support claim does not identify an accessibility profile (SCP-002).",
      ),
    );
  }
  if (input.features === undefined) {
    issues.push(
      issue(
        "FEATURE_PROFILE_UNRESOLVED",
        "unresolved",
        `${path}/features`,
        "The support claim does not identify its public capability set (SCP-001).",
      ),
    );
  }

  if (
    !isIdentifier(id) ||
    typeof status !== "string" ||
    !PROFILE_STATUSES.has(status as SupportProfile["status"]) ||
    !isBoundedString(framework) ||
    !isBoundedString(browser) ||
    !isBoundedString(workload) ||
    surfaces === undefined ||
    inputs === undefined
  ) {
    return undefined;
  }

  return {
    id,
    status: status as SupportProfile["status"],
    framework,
    browser,
    surfaces,
    inputs,
    workload,
    ...(accessibility === undefined ? {} : { accessibility }),
    ...(features === undefined ? {} : { features }),
  };
}

export function validateConformanceManifest(input: unknown): AuditResult<ConformanceManifest> {
  const issues: ConformanceIssue[] = [];
  if (!isPlainRecord(input)) {
    return result<ConformanceManifest>(undefined, [
      issue("INVALID_MANIFEST", "invalid", "", "Expected a plain conformance manifest object."),
    ]);
  }

  unknownKeys(input, MANIFEST_KEYS).forEach((key) => {
    issues.push(
      issue("UNKNOWN_MANIFEST_FIELD", "invalid", `/${key}`, `Unknown manifest field: ${key}`),
    );
  });

  const schema = input.$schema;
  const engineVersion = input.engineVersion;
  const classification = input.classification;
  const generatedAt = input.generatedAt;
  const telemetryDefault = input.telemetryDefault;

  if (schema !== undefined && !isBoundedString(schema)) {
    issues.push(issue("INVALID_SCHEMA_URI", "invalid", "/$schema", "Schema URI must be a string."));
  }
  if (!isSemver(engineVersion)) {
    issues.push(
      issue("INVALID_ENGINE_VERSION", "invalid", "/engineVersion", "Expected a semantic version."),
    );
  }
  if (
    typeof classification !== "string" ||
    !CLASSIFICATIONS.has(classification as SupportClassification)
  ) {
    issues.push(
      issue(
        "INVALID_CLASSIFICATION",
        "invalid",
        "/classification",
        "Classification must be stable, experimental, deprecated, or unsupported.",
      ),
    );
  }
  if (generatedAt !== undefined && !isIsoDate(generatedAt)) {
    issues.push(
      issue("INVALID_GENERATED_DATE", "invalid", "/generatedAt", "Expected a real ISO date."),
    );
  }
  if (telemetryDefault !== "off") {
    issues.push(
      issue(
        "TELEMETRY_DEFAULT_NOT_OFF",
        "invalid",
        "/telemetryDefault",
        "Library telemetry must be disabled by default (OBS-006).",
      ),
    );
  }

  const profiles: SupportProfile[] = [];
  if (!Array.isArray(input.profiles) || input.profiles.length > MAX_RECORDS) {
    issues.push(
      issue(
        "INVALID_PROFILES",
        "invalid",
        "/profiles",
        `Profiles must be an array with at most ${MAX_RECORDS.toString()} entries.`,
      ),
    );
  } else {
    const ids = new Set<string>();
    input.profiles.forEach((profile, index) => {
      const parsed = parseProfile(profile, `/profiles/${index.toString()}`, issues);
      if (parsed === undefined) return;
      if (ids.has(parsed.id)) {
        issues.push(
          issue(
            "DUPLICATE_PROFILE",
            "invalid",
            `/profiles/${index.toString()}/id`,
            `Duplicate profile: ${parsed.id}`,
          ),
        );
        return;
      }
      ids.add(parsed.id);
      profiles.push(parsed);
    });
  }

  const unsupported = parseStringArray(input.unsupported, "/unsupported", issues, {
    identifier: true,
  });
  const knownLimitations =
    input.knownLimitations === undefined
      ? undefined
      : parseStringArray(input.knownLimitations, "/knownLimitations", issues);

  if (classification === "unsupported" && profiles.length > 0) {
    issues.push(
      issue(
        "UNSUPPORTED_MANIFEST_HAS_PROFILES",
        "invalid",
        "/profiles",
        "An unsupported release classification cannot publish supported profiles.",
      ),
    );
  }
  if (classification !== "unsupported" && profiles.length === 0) {
    issues.push(
      issue(
        "MISSING_SUPPORT_PROFILE",
        "unresolved",
        "/profiles",
        "A supported release claim must identify at least one complete profile.",
      ),
    );
  }
  if (classification === "stable" && input.knownLimitations === undefined) {
    issues.push(
      issue(
        "KNOWN_LIMITATIONS_UNRESOLVED",
        "unresolved",
        "/knownLimitations",
        "A stable release must publish known limitations, including an explicit empty list.",
      ),
    );
  }

  if (
    !isSemver(engineVersion) ||
    typeof classification !== "string" ||
    !CLASSIFICATIONS.has(classification as SupportClassification) ||
    telemetryDefault !== "off" ||
    unsupported === undefined ||
    !Array.isArray(input.profiles) ||
    profiles.length !== input.profiles.length
  ) {
    return result<ConformanceManifest>(undefined, issues);
  }

  const manifest: ConformanceManifest = {
    engineVersion,
    classification: classification as SupportClassification,
    profiles: [...profiles].sort((left, right) => compareCodeUnits(left.id, right.id)),
    unsupported: [...unsupported].sort(compareCodeUnits),
    telemetryDefault: "off",
    ...(typeof schema === "string" ? { $schema: schema } : {}),
    ...(typeof generatedAt === "string" ? { generatedAt } : {}),
    ...(knownLimitations === undefined ? {} : { knownLimitations }),
  };
  return result(manifest, issues);
}
