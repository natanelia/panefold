import {
  cloneAndFreeze,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  type PanelCapabilities,
  type PanelConstraints,
  type PanelLifecyclePolicy,
  type PanelRecord,
} from "./entities";
import type { PanelId } from "./ids";
import { isJsonValue, type JsonValue } from "./json";

export interface PanelCodecLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
}

export interface PanelDataDecodeError {
  readonly code:
    | "INVALID_VERSION"
    | "FUTURE_VERSION"
    | "INVALID_JSON"
    | "LIMIT_EXCEEDED"
    | "MIGRATION_MISSING"
    | "MIGRATION_FAILED"
    | "SCHEMA_MISMATCH";
  readonly message: string;
  readonly remediation: readonly string[];
  /** Preserved for application-controlled export or a recoverable placeholder. */
  readonly source: unknown;
}

export type PanelDataDecodeResult<T extends JsonValue> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly sourceVersion: number;
      readonly currentVersion: number;
      readonly migrated: boolean;
    }
  | { readonly ok: false; readonly error: PanelDataDecodeError };

export interface VersionedPanelDataCodec<T extends JsonValue> {
  readonly currentVersion: number;
  readonly decode: (value: unknown, sourceVersion: number) => PanelDataDecodeResult<T>;
  readonly encode: (value: T) => JsonValue;
}

export interface CreateVersionedPanelDataCodecOptions<T extends JsonValue> {
  readonly currentVersion: number;
  readonly validate: (value: JsonValue) => value is T;
  /** Migration keyed by the source version and returning the next version. */
  readonly migrations?: Readonly<Record<number, (value: JsonValue) => JsonValue>>;
  readonly limits?: Partial<PanelCodecLimits>;
}

export interface PanelTypeDefinition<Parameters extends JsonValue, Checkpoint extends JsonValue> {
  readonly type: string;
  readonly version: number;
  readonly parameters: VersionedPanelDataCodec<Parameters>;
  readonly checkpoint: VersionedPanelDataCodec<Checkpoint>;
  readonly capabilities: PanelCapabilities;
  readonly constraints: PanelConstraints;
  readonly lifecycle: PanelLifecyclePolicy;
}

/** Type-erased read/restore view retained by a heterogeneous registry. */
export interface RegisteredPanelTypeDefinition {
  readonly type: string;
  readonly version: number;
  readonly parameters: {
    readonly currentVersion: number;
    readonly decode: (value: unknown, sourceVersion: number) => PanelDataDecodeResult<JsonValue>;
  };
  readonly checkpoint: {
    readonly currentVersion: number;
    readonly decode: (value: unknown, sourceVersion: number) => PanelDataDecodeResult<JsonValue>;
  };
  readonly capabilities: PanelCapabilities;
  readonly constraints: PanelConstraints;
  readonly lifecycle: PanelLifecyclePolicy;
}

export interface DefinePanelOptions<Parameters extends JsonValue, Checkpoint extends JsonValue> {
  readonly type: string;
  readonly version: number;
  readonly parameters: VersionedPanelDataCodec<Parameters>;
  readonly checkpoint: VersionedPanelDataCodec<Checkpoint>;
  readonly capabilities?: PanelCapabilities;
  readonly constraints?: PanelConstraints;
  readonly lifecycle?: PanelLifecyclePolicy;
}

export type InferPanelParameters<Definition> = Definition extends {
  readonly parameters: VersionedPanelDataCodec<infer Parameters>;
}
  ? Parameters
  : never;

export type InferPanelCheckpoint<Definition> = Definition extends {
  readonly checkpoint: VersionedPanelDataCodec<infer Checkpoint>;
}
  ? Checkpoint
  : never;

export interface MissingPanelTypePlaceholder {
  readonly status: "missing-panel-type";
  readonly panel: PanelRecord;
  readonly reason: string;
  readonly recoverable: true;
}

export type ResolvePanelTypeResult =
  | {
      readonly status: "available";
      readonly panel: PanelRecord;
      readonly definition: RegisteredPanelTypeDefinition;
    }
  | MissingPanelTypePlaceholder;

export interface CreatePanelRecordInput {
  readonly id: PanelId;
  readonly type: string;
  readonly parameters: unknown;
  readonly parameterVersion: number;
  readonly title?: string;
  readonly checkpointRef?: string;
}

export type CreatePanelRecordResult =
  | { readonly ok: true; readonly panel: PanelRecord }
  | { readonly ok: false; readonly error: PanelDataDecodeError | MissingPanelTypePlaceholder };

export interface PanelTypeRegistry {
  readonly types: readonly string[];
  readonly definition: (type: string) => RegisteredPanelTypeDefinition | undefined;
  readonly createPanelRecord: (input: CreatePanelRecordInput) => CreatePanelRecordResult;
  readonly decodeCheckpoint: (
    panelType: string,
    value: unknown,
    sourceVersion: number,
  ) => PanelDataDecodeResult<JsonValue> | MissingPanelTypePlaceholder;
  readonly resolvePanel: (panel: PanelRecord) => ResolvePanelTypeResult;
}

const DEFAULT_LIMITS: PanelCodecLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 50_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 2_000,
  maxStringLength: 1_048_576,
});

export function createVersionedPanelDataCodec<T extends JsonValue>(
  options: CreateVersionedPanelDataCodecOptions<T>,
): VersionedPanelDataCodec<T> {
  validateVersion(options.currentVersion);
  const limits = resolveLimits(options.limits);
  const migrations = Object.freeze({ ...(options.migrations ?? {}) });

  return Object.freeze({
    currentVersion: options.currentVersion,
    decode: (source: unknown, sourceVersion: number): PanelDataDecodeResult<T> => {
      if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
        return failure(
          "INVALID_VERSION",
          "Panel data version must be a positive safe integer",
          source,
        );
      }
      if (sourceVersion > options.currentVersion) {
        return failure(
          "FUTURE_VERSION",
          `Panel data version ${String(sourceVersion)} is newer than supported ${String(options.currentVersion)}`,
          source,
        );
      }
      if (!isJsonValue(source)) {
        return failure("INVALID_JSON", "Panel data must contain JSON-safe values", source);
      }
      const limitError = inspectLimits(source, limits);
      if (limitError !== undefined) {
        return failure("LIMIT_EXCEEDED", limitError, source);
      }
      let version = sourceVersion;
      let value: JsonValue = cloneAndFreeze(source);
      while (version < options.currentVersion) {
        const migrate = migrations[version];
        if (migrate === undefined) {
          return failure(
            "MIGRATION_MISSING",
            `No migration is registered from panel data version ${String(version)}`,
            source,
          );
        }
        try {
          value = migrate(value);
        } catch (error) {
          return failure(
            "MIGRATION_FAILED",
            error instanceof Error ? error.message : "Panel data migration failed",
            source,
          );
        }
        if (!isJsonValue(value) || inspectLimits(value, limits) !== undefined) {
          return failure(
            "MIGRATION_FAILED",
            `Migration from version ${String(version)} returned invalid or excessive data`,
            source,
          );
        }
        version += 1;
      }
      if (!options.validate(value)) {
        return failure("SCHEMA_MISMATCH", "Panel data does not match its declared schema", source);
      }
      return Object.freeze({
        ok: true,
        value: cloneAndFreeze(value),
        sourceVersion,
        currentVersion: options.currentVersion,
        migrated: sourceVersion !== options.currentVersion,
      });
    },
    encode: (value: T) => {
      if (!options.validate(value))
        throw new TypeError("Panel data does not match its declared schema");
      const limitError = inspectLimits(value, limits);
      if (limitError !== undefined) throw new RangeError(limitError);
      return cloneAndFreeze(value);
    },
  });
}

export function definePanel<Parameters extends JsonValue, Checkpoint extends JsonValue>(
  options: DefinePanelOptions<Parameters, Checkpoint>,
): PanelTypeDefinition<Parameters, Checkpoint> {
  if (!validType(options.type))
    throw new TypeError("Panel type must be a bounded dotted identifier");
  validateVersion(options.version);
  return Object.freeze({
    type: options.type,
    version: options.version,
    parameters: options.parameters,
    checkpoint: options.checkpoint,
    capabilities: cloneAndFreeze(options.capabilities ?? DEFAULT_PANEL_CAPABILITIES),
    constraints: cloneAndFreeze(options.constraints ?? {}),
    lifecycle: cloneAndFreeze(options.lifecycle ?? DEFAULT_PANEL_LIFECYCLE),
  });
}

export function definePanels<
  Definitions extends Readonly<Record<string, RegisteredPanelTypeDefinition>>,
>(definitions: Definitions): Definitions {
  for (const [key, definition] of Object.entries(definitions)) {
    if (key !== definition.type) {
      throw new TypeError(`Panel registry key ${key} does not match type ${definition.type}`);
    }
  }
  return Object.freeze({ ...definitions }) as Definitions;
}

export function createPanelTypeRegistry(
  definitions: readonly RegisteredPanelTypeDefinition[],
): PanelTypeRegistry {
  const byType = new Map<string, RegisteredPanelTypeDefinition>();
  for (const definition of definitions) {
    if (byType.has(definition.type)) throw new TypeError(`Duplicate panel type ${definition.type}`);
    byType.set(definition.type, definition);
  }
  const types = Object.freeze([...byType.keys()].sort(compare));
  const missing = (type: string, panel?: PanelRecord): MissingPanelTypePlaceholder =>
    Object.freeze({
      status: "missing-panel-type",
      panel:
        panel ??
        (Object.freeze({
          id: "missing:unresolved" as PanelId,
          type,
          typeVersion: 1,
          parameters: null,
          capabilities: DEFAULT_PANEL_CAPABILITIES,
          constraints: {},
          lifecycle: DEFAULT_PANEL_LIFECYCLE,
        }) satisfies PanelRecord),
      reason: `Panel type ${type} is unavailable. Install or restore its provider to recover this panel.`,
      recoverable: true,
    });

  return Object.freeze({
    types,
    definition: (type: string) => byType.get(type),
    createPanelRecord: (input: CreatePanelRecordInput): CreatePanelRecordResult => {
      const definition = byType.get(input.type);
      if (definition === undefined) {
        const preserved: PanelRecord = Object.freeze({
          id: input.id,
          type: input.type,
          typeVersion:
            Number.isSafeInteger(input.parameterVersion) && input.parameterVersion > 0
              ? input.parameterVersion
              : 1,
          parameters: isJsonValue(input.parameters) ? cloneAndFreeze(input.parameters) : null,
          capabilities: DEFAULT_PANEL_CAPABILITIES,
          constraints: {},
          lifecycle: DEFAULT_PANEL_LIFECYCLE,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
        });
        return { ok: false, error: missing(input.type, preserved) };
      }
      const decoded = definition.parameters.decode(input.parameters, input.parameterVersion);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      const panel: PanelRecord = Object.freeze({
        id: input.id,
        type: definition.type,
        typeVersion: definition.version,
        parameters: decoded.value,
        capabilities: definition.capabilities,
        constraints: definition.constraints,
        lifecycle: definition.lifecycle,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
      });
      return { ok: true, panel };
    },
    decodeCheckpoint: (type: string, value: unknown, sourceVersion: number) => {
      const definition = byType.get(type);
      return definition === undefined
        ? missing(type)
        : definition.checkpoint.decode(value, sourceVersion);
    },
    resolvePanel: (panel: PanelRecord): ResolvePanelTypeResult => {
      const definition = byType.get(panel.type);
      return definition === undefined
        ? missing(panel.type, cloneAndFreeze(panel))
        : Object.freeze({ status: "available", panel, definition });
    },
  });
}

function inspectLimits(value: JsonValue, limits: PanelCodecLimits): string | undefined {
  const stack: Array<{ readonly value: JsonValue; readonly depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > limits.maxNodes) return "Panel data node limit exceeded";
    if (current.depth > limits.maxDepth) return "Panel data depth limit exceeded";
    if (typeof current.value === "string" && current.value.length > limits.maxStringLength) {
      return "Panel data string limit exceeded";
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayLength) return "Panel data array limit exceeded";
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      const object = current.value as Readonly<Record<string, JsonValue>>;
      const keys = Object.keys(object);
      if (keys.length > limits.maxObjectKeys) return "Panel data object-key limit exceeded";
      for (const key of keys) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          return "Panel data contains a prototype-sensitive key";
        }
        stack.push({ value: object[key] ?? null, depth: current.depth + 1 });
      }
    }
  }
  return undefined;
}

function failure(
  code: PanelDataDecodeError["code"],
  message: string,
  source: unknown,
): PanelDataDecodeResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message,
      remediation: Object.freeze([
        "Retain the original panel descriptor",
        "Render a recoverable placeholder",
        "Install a compatible panel provider or export the source data",
      ]),
      source: isJsonValue(source) ? cloneAndFreeze(source) : "[INVALID_SOURCE_RETAINED_EXTERNALLY]",
    }),
  });
}

function resolveLimits(overrides: Partial<PanelCodecLimits> | undefined): PanelCodecLimits {
  const limits: PanelCodecLimits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return Object.freeze(limits);
}

function validateVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Panel version must be a positive safe integer");
  }
}

function validType(value: string): boolean {
  return value.length <= 192 && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(value);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
