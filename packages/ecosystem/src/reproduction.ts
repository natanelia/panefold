import { canonicalJson } from "./authentication";

export interface ReproductionLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
}

export interface ReproductionInput {
  readonly engineVersion: string;
  readonly schemaVersion: number;
  readonly category: "expected-error" | "invariant-defect" | "protocol-defect" | "renderer-defect";
  readonly code: string;
  readonly message: string;
  readonly revision?: string;
  readonly transactionId?: string;
  readonly snapshot?: unknown;
  readonly commands?: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
  readonly environment?: Readonly<Record<string, unknown>>;
}

export interface RedactedReproduction {
  readonly format: "panefold-reproduction";
  readonly formatVersion: 1;
  readonly engineVersion: string;
  readonly schemaVersion: number;
  readonly category: ReproductionInput["category"];
  readonly code: string;
  readonly message: string;
  readonly revision?: string;
  readonly transactionId?: string;
  readonly snapshot?: unknown;
  readonly commands?: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
  readonly environment?: Readonly<Record<string, unknown>>;
  readonly truncations: readonly string[];
}

const DEFAULT_LIMITS: ReproductionLimits = Object.freeze({
  maxDepth: 24,
  maxNodes: 5_000,
  maxArrayLength: 500,
  maxObjectKeys: 256,
  maxStringLength: 2_048,
});

const REDACTED_KEYS =
  /(?:title|parameter|checkpoint|secret|token|nonce|password|authorization|cookie|payload|content|document|applicationData)$/iu;

/**
 * Produces a deterministic, JSON-safe defect attachment. Sensitive values are
 * removed by key before limits are applied; callers must opt in to richer
 * application projections separately.
 */
export function createRedactedReproduction(
  input: ReproductionInput,
  limitOverrides: Partial<ReproductionLimits> = {},
): RedactedReproduction {
  const limits = resolveLimits(limitOverrides);
  const state = { nodes: 0, truncations: [] as string[] };
  const project = (value: unknown, path: string) => redactValue(value, path, 0, limits, state);
  const output: RedactedReproduction = {
    format: "panefold-reproduction",
    formatVersion: 1,
    engineVersion: boundedString(input.engineVersion, limits.maxStringLength),
    schemaVersion: input.schemaVersion,
    category: input.category,
    code: boundedString(input.code, limits.maxStringLength),
    message: boundedString(input.message, limits.maxStringLength),
    ...(input.revision === undefined ? {} : { revision: boundedString(input.revision, 128) }),
    ...(input.transactionId === undefined
      ? {}
      : { transactionId: boundedString(input.transactionId, 128) }),
    ...(input.snapshot === undefined ? {} : { snapshot: project(input.snapshot, "$.snapshot") }),
    ...(input.commands === undefined
      ? {}
      : { commands: project(input.commands, "$.commands") as readonly unknown[] }),
    ...(input.diagnostics === undefined
      ? {}
      : { diagnostics: project(input.diagnostics, "$.diagnostics") as readonly unknown[] }),
    ...(input.environment === undefined
      ? {}
      : {
          environment: project(input.environment, "$.environment") as Readonly<
            Record<string, unknown>
          >,
        }),
    truncations: Object.freeze(state.truncations),
  };
  return deepFreeze(output);
}

export function serializeRedactedReproduction(reproduction: RedactedReproduction): string {
  return `${canonicalJson(reproduction)}\n`;
}

function redactValue(
  value: unknown,
  path: string,
  depth: number,
  limits: ReproductionLimits,
  state: { nodes: number; truncations: string[] },
): unknown {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) return truncated(path, "node-limit", state);
  if (depth > limits.maxDepth) return truncated(path, "depth-limit", state);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[INVALID_NUMBER]";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return boundedString(value, limits.maxStringLength);
  if (typeof value !== "object") return `[UNSERIALIZABLE_${typeof value}]`;

  if (Array.isArray(value)) {
    const length = Math.min(value.length, limits.maxArrayLength);
    if (length < value.length) state.truncations.push(`${path}:array-limit`);
    return Object.freeze(
      value
        .slice(0, length)
        .map((entry, index) =>
          redactValue(entry, `${path}[${String(index)}]`, depth + 1, limits, state),
        ),
    );
  }

  const source = value as Record<string, unknown>;
  const output = Object.create(null) as Record<string, unknown>;
  const keys = Object.keys(source).sort(compare);
  const length = Math.min(keys.length, limits.maxObjectKeys);
  if (length < keys.length) state.truncations.push(`${path}:object-key-limit`);
  for (const key of keys.slice(0, length)) {
    output[key] = REDACTED_KEYS.test(key)
      ? "[REDACTED]"
      : redactValue(source[key], `${path}.${key}`, depth + 1, limits, state);
  }
  return Object.freeze(output);
}

function truncated(path: string, reason: string, state: { truncations: string[] }): string {
  state.truncations.push(`${path}:${reason}`);
  return `[TRUNCATED_${reason.toUpperCase()}]`;
}

function boundedString(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function resolveLimits(overrides: Partial<ReproductionLimits>): ReproductionLimits {
  const limits: ReproductionLimits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
      throw new RangeError(`${key} must be an integer from 1 to 1,000,000`);
    }
  }
  return Object.freeze(limits);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
