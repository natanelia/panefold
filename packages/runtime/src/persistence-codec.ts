import { canonicalSerialize, canonicalizeWorkspace, validateWorkspace } from "@panefold/kernel";
import type { CURRENT_WORKSPACE_SCHEMA_VERSION, WorkspaceSnapshot } from "@panefold/model";

export interface WorkspaceEnvelope {
  readonly kernelSchemaVersion: number;
  readonly applicationLayoutVersion: number;
  readonly protocolVersion: number;
  readonly panelTypeVersions: Readonly<Record<string, number>>;
  readonly snapshotRevision: string;
  readonly checksum: string;
  readonly workspace: unknown;
}

export interface PersistenceDecodeLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
}

export const DEFAULT_PERSISTENCE_LIMITS: PersistenceDecodeLimits = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 200_000,
  maxArrayLength: 20_000,
  maxObjectKeys: 20_000,
  maxStringLength: 1_000_000,
});

export type PersistenceCodecErrorCode =
  | "INVALID_ENVELOPE"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_VERSION"
  | "MIGRATION_MISSING"
  | "MIGRATION_FAILED"
  | "CHECKSUM_MISMATCH"
  | "INVALID_WORKSPACE";

export class PersistenceCodecError extends Error {
  public override readonly name = "PersistenceCodecError";

  public constructor(
    public readonly code: PersistenceCodecErrorCode,
    message: string,
    public readonly remediation: readonly string[],
    public readonly originalCause?: unknown,
  ) {
    super(message);
  }
}

export interface WorkspaceMigration {
  readonly id: string;
  readonly scope: "kernel" | "application";
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(workspace: unknown): unknown;
}

export interface WorkspaceMigrationDiagnostic {
  readonly migrationId: string;
  readonly scope: WorkspaceMigration["scope"];
  readonly fromVersion: number;
  readonly toVersion: number;
}

/** Built-in, deterministic migrations for Panefold-owned snapshot fields. */
const CORE_MIGRATION_TARGET_VERSION: typeof CURRENT_WORKSPACE_SCHEMA_VERSION = 2;

export const CORE_WORKSPACE_MIGRATIONS: readonly WorkspaceMigration[] = Object.freeze([
  Object.freeze({
    id: "panefold.kernel.1-to-2.remote-transaction-ledger",
    scope: "kernel" as const,
    fromVersion: 1,
    toVersion: CORE_MIGRATION_TARGET_VERSION,
    migrate(workspace: unknown): unknown {
      if (!isRecord(workspace)) {
        throw new TypeError("Workspace migration input must be an object");
      }
      return {
        ...workspace,
        schemaVersion: CORE_MIGRATION_TARGET_VERSION,
        appliedRemoteTransactions: Array.isArray(workspace.appliedRemoteTransactions)
          ? workspace.appliedRemoteTransactions
          : [],
      };
    },
  }),
]);

export interface ChecksumProvider {
  digest(value: string): Promise<string>;
}

export interface CreateWorkspaceEnvelopeOptions {
  readonly protocolVersion?: number;
  readonly checksum?: ChecksumProvider;
}

export interface DecodeWorkspaceEnvelopeOptions {
  readonly currentKernelSchemaVersion: number;
  readonly currentApplicationLayoutVersion: number;
  readonly currentProtocolVersion: number;
  readonly migrations?: readonly WorkspaceMigration[];
  readonly limits?: Partial<PersistenceDecodeLimits>;
  readonly checksum?: ChecksumProvider;
}

export type DecodeWorkspaceEnvelopeResult =
  | {
      readonly ok: true;
      readonly snapshot: WorkspaceSnapshot;
      readonly diagnostics: readonly WorkspaceMigrationDiagnostic[];
    }
  | { readonly ok: false; readonly error: PersistenceCodecError };

export async function createWorkspaceEnvelope(
  snapshot: WorkspaceSnapshot,
  options: CreateWorkspaceEnvelopeOptions = {},
): Promise<WorkspaceEnvelope> {
  const protocolVersion = options.protocolVersion ?? 1;
  validateVersion(protocolVersion, "protocolVersion");
  const violations = validateWorkspace(snapshot);
  if (violations.length > 0) {
    throw new PersistenceCodecError(
      "INVALID_WORKSPACE",
      `Cannot persist a workspace with ${String(violations.length)} invariant violation(s).`,
      ["Repair or reject the workspace before persistence"],
    );
  }
  const serialized = canonicalSerialize(snapshot);
  const workspace = JSON.parse(serialized) as unknown;
  const checksum = await (options.checksum ?? SHA256_CHECKSUM).digest(
    canonicalSerialize(workspace),
  );
  const panelTypeVersions: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const panelId of snapshot.panels.ids) {
    const panel = snapshot.panels.byId[panelId];
    if (panel !== undefined) {
      panelTypeVersions[panel.type] = Math.max(
        panelTypeVersions[panel.type] ?? 0,
        panel.typeVersion,
      );
    }
  }
  return Object.freeze({
    kernelSchemaVersion: snapshot.schemaVersion,
    applicationLayoutVersion: snapshot.applicationLayoutVersion,
    protocolVersion,
    panelTypeVersions: Object.freeze(panelTypeVersions),
    snapshotRevision: snapshot.revision.toString(),
    checksum,
    workspace,
  });
}

export async function decodeWorkspaceEnvelope(
  input: unknown,
  options: DecodeWorkspaceEnvelopeOptions,
): Promise<DecodeWorkspaceEnvelopeResult> {
  try {
    const limits = resolveLimits(options.limits);
    assertBoundedValue(input, limits);
    const envelope = parseEnvelope(input);
    validateVersion(options.currentKernelSchemaVersion, "currentKernelSchemaVersion");
    validateVersion(options.currentApplicationLayoutVersion, "currentApplicationLayoutVersion");
    validateVersion(options.currentProtocolVersion, "currentProtocolVersion");
    if (envelope.protocolVersion > options.currentProtocolVersion) {
      throw codecFailure(
        "UNSUPPORTED_VERSION",
        `Surface protocol ${String(envelope.protocolVersion)} is newer than supported ${String(options.currentProtocolVersion)}.`,
        ["Open with a compatible Panefold version", "Retain the source envelope unchanged"],
      );
    }
    const actualChecksum = await (options.checksum ?? SHA256_CHECKSUM).digest(
      canonicalSerialize(envelope.workspace),
    );
    if (actualChecksum !== envelope.checksum) {
      throw codecFailure(
        "CHECKSUM_MISMATCH",
        "Persisted workspace checksum did not match its payload.",
        ["Load the last-known-good snapshot", "Export the corrupt artifact for diagnosis"],
      );
    }

    const diagnostics: WorkspaceMigrationDiagnostic[] = [];
    const migrations = [...CORE_WORKSPACE_MIGRATIONS, ...(options.migrations ?? [])];
    let workspace = envelope.workspace;
    workspace = runMigrations(
      workspace,
      "kernel",
      envelope.kernelSchemaVersion,
      options.currentKernelSchemaVersion,
      migrations,
      diagnostics,
    );
    workspace = runMigrations(
      workspace,
      "application",
      envelope.applicationLayoutVersion,
      options.currentApplicationLayoutVersion,
      migrations,
      diagnostics,
    );
    assertBoundedValue(workspace, limits);

    const revived = reviveCanonicalValue(workspace);
    const canonical = canonicalizeWorkspace(revived as WorkspaceSnapshot).snapshot;
    const violations = validateWorkspace(canonical);
    if (violations.length > 0) {
      throw codecFailure(
        "INVALID_WORKSPACE",
        `Decoded workspace violates ${String(violations.length)} invariant(s).`,
        ["Load the last-known-good snapshot", "Inspect migration diagnostics"],
      );
    }
    if (canonical.revision.toString() !== envelope.snapshotRevision) {
      throw codecFailure(
        "INVALID_ENVELOPE",
        "Envelope revision does not match its canonical workspace revision.",
        ["Reject the envelope without replacing the current workspace"],
      );
    }
    return Object.freeze({
      ok: true,
      snapshot: canonical,
      diagnostics: Object.freeze(diagnostics),
    });
  } catch (cause) {
    return Object.freeze({
      ok: false,
      error:
        cause instanceof PersistenceCodecError
          ? cause
          : codecFailure(
              "INVALID_WORKSPACE",
              "Persisted workspace could not be decoded safely.",
              ["Keep the current workspace", "Try the last-known-good snapshot"],
              cause,
            ),
    });
  }
}

export function assertBoundedValue(
  value: unknown,
  limits: PersistenceDecodeLimits = DEFAULT_PERSISTENCE_LIMITS,
): void {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    nodes += 1;
    if (nodes > limits.maxNodes) limitFailure("node count", limits.maxNodes);
    if (frame.depth > limits.maxDepth) limitFailure("depth", limits.maxDepth);
    const current = frame.value;
    if (current === null) {
      bytes += 4;
      if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
      continue;
    }
    if (typeof current === "boolean") {
      bytes += current ? 4 : 5;
      if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalidEnvelope("Non-finite numbers are not allowed");
      bytes += new TextEncoder().encode(
        JSON.stringify(Object.is(current, -0) ? 0 : current),
      ).byteLength;
      if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
      continue;
    }
    if (typeof current === "string") {
      if (current.length > limits.maxStringLength) {
        limitFailure("string length", limits.maxStringLength);
      }
      bytes += new TextEncoder().encode(JSON.stringify(current)).byteLength;
      if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
      continue;
    }
    if (typeof current !== "object") invalidEnvelope(`Unsupported ${typeof current} value`);
    if (seen.has(current)) invalidEnvelope("Cyclic persisted data is not allowed");
    seen.add(current);

    if (Array.isArray(current)) {
      if (current.length > limits.maxArrayLength) {
        limitFailure("array length", limits.maxArrayLength);
      }
      const ownKeys = Reflect.ownKeys(current);
      if (ownKeys.some((key) => typeof key === "symbol")) {
        invalidEnvelope("Symbol keys are not allowed in persisted arrays");
      }
      for (const key of ownKeys) {
        if (typeof key !== "string" || key === "length") continue;
        if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length) {
          invalidEnvelope("Custom properties are not allowed on persisted arrays");
        }
      }
      bytes += 2 + Math.max(0, current.length - 1);
      if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          invalidEnvelope("Sparse or accessor-backed persisted arrays are not allowed");
        }
        stack.push({ value: descriptor.value, depth: frame.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidEnvelope("Persisted objects must have a plain or null prototype");
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const ownKeys = Reflect.ownKeys(current);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      invalidEnvelope("Symbol keys are not allowed in persisted objects");
    }
    const keys = Object.keys(descriptors);
    if (keys.length > limits.maxObjectKeys) {
      limitFailure("object key count", limits.maxObjectKeys);
    }
    bytes += 2 + Math.max(0, keys.length - 1);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        invalidEnvelope(`Unsafe persisted key: ${key}`);
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        invalidEnvelope("Persisted object properties must be enumerable data properties");
      }
      bytes += new TextEncoder().encode(JSON.stringify(key)).byteLength + 1;
      if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
      stack.push({ value: descriptor.value, depth: frame.depth + 1 });
    }
    if (bytes > limits.maxBytes) limitFailure("encoded byte size", limits.maxBytes);
  }
}

export const SHA256_CHECKSUM: ChecksumProvider = Object.freeze({
  async digest(value: string): Promise<string> {
    if (globalThis.crypto?.subtle === undefined) {
      throw new Error("Web Crypto SHA-256 is unavailable");
    }
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  },
});

function parseEnvelope(input: unknown): WorkspaceEnvelope {
  if (!isRecord(input)) invalidEnvelope("Workspace envelope must be an object");
  const kernelSchemaVersion = requiredVersion(input, "kernelSchemaVersion");
  const applicationLayoutVersion = requiredVersion(input, "applicationLayoutVersion");
  const protocolVersion = requiredVersion(input, "protocolVersion");
  const snapshotRevision = input.snapshotRevision;
  const checksum = input.checksum;
  if (typeof snapshotRevision !== "string" || !/^(0|[1-9][0-9]*)$/.test(snapshotRevision)) {
    invalidEnvelope("snapshotRevision must be a non-negative integer string");
  }
  if (typeof checksum !== "string" || checksum.length === 0) {
    invalidEnvelope("checksum must be a non-empty string");
  }
  if (!isRecord(input.panelTypeVersions)) {
    invalidEnvelope("panelTypeVersions must be an object");
  }
  const panelTypeVersions: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [panelType, version] of Object.entries(input.panelTypeVersions)) {
    if (panelType.length === 0) invalidEnvelope("Panel type must not be empty");
    validateVersion(version, `panelTypeVersions.${panelType}`);
    panelTypeVersions[panelType] = version;
  }
  if (!("workspace" in input)) invalidEnvelope("workspace is required");
  return Object.freeze({
    kernelSchemaVersion,
    applicationLayoutVersion,
    protocolVersion,
    panelTypeVersions: Object.freeze(panelTypeVersions),
    snapshotRevision,
    checksum,
    workspace: input.workspace,
  });
}

function runMigrations(
  initial: unknown,
  scope: WorkspaceMigration["scope"],
  sourceVersion: number,
  targetVersion: number,
  migrations: readonly WorkspaceMigration[],
  diagnostics: WorkspaceMigrationDiagnostic[],
): unknown {
  if (sourceVersion > targetVersion) {
    throw codecFailure(
      "UNSUPPORTED_VERSION",
      `${scope} schema ${String(sourceVersion)} is newer than supported ${String(targetVersion)}.`,
      ["Open with a compatible Panefold version", "Retain the source envelope unchanged"],
    );
  }
  let value = initial;
  for (let version = sourceVersion; version < targetVersion; version += 1) {
    const candidates = migrations
      .filter(
        (migration) =>
          migration.scope === scope &&
          migration.fromVersion === version &&
          migration.toVersion === version + 1,
      )
      .sort((left, right) => compareStrings(left.id, right.id));
    const migration = candidates[0];
    if (migration === undefined || candidates.length !== 1) {
      throw codecFailure(
        "MIGRATION_MISSING",
        `Expected exactly one ${scope} migration from ${String(version)} to ${String(version + 1)}.`,
        ["Install the missing migration", "Recover the previous compatible snapshot"],
      );
    }
    try {
      value = migration.migrate(value);
    } catch (cause) {
      throw codecFailure(
        "MIGRATION_FAILED",
        `Migration ${migration.id} failed without modifying the stored source.`,
        ["Retain the source envelope", "Inspect the migration diagnostic"],
        cause,
      );
    }
    diagnostics.push(
      Object.freeze({
        migrationId: migration.id,
        scope,
        fromVersion: version,
        toVersion: version + 1,
      }),
    );
  }
  return value;
}

function reviveCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveCanonicalValue);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$bigint" && typeof value.$bigint === "string") {
    return BigInt(value.$bigint);
  }
  const revived: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) revived[key] = reviveCanonicalValue(child);
  return revived;
}

function resolveLimits(
  input: Partial<PersistenceDecodeLimits> | undefined,
): PersistenceDecodeLimits {
  const resolved = { ...DEFAULT_PERSISTENCE_LIMITS, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  return Object.freeze(resolved);
}

function requiredVersion(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  validateVersion(value, key);
  return value;
}

function validateVersion(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalidEnvelope(`${name} must be a positive safe integer`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function codecFailure(
  code: PersistenceCodecErrorCode,
  message: string,
  remediation: readonly string[],
  originalCause?: unknown,
): PersistenceCodecError {
  return new PersistenceCodecError(code, message, Object.freeze([...remediation]), originalCause);
}

function invalidEnvelope(message: string): never {
  throw codecFailure("INVALID_ENVELOPE", message, [
    "Reject the input without replacing the current workspace",
  ]);
}

function limitFailure(kind: string, limit: number): never {
  throw codecFailure(
    "LIMIT_EXCEEDED",
    `Persisted ${kind} exceeds the configured limit ${String(limit)}.`,
    ["Reject or import a smaller workspace", "Raise the limit only after a security review"],
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
