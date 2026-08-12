export type PluginCapability = "panels" | "commands" | "devtools" | "collaboration" | "mobile";

export interface PluginManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly engineRange: string;
  readonly protocolVersion: number;
  readonly displayName?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly panelTypes: readonly string[];
  readonly commands: readonly string[];
  readonly persistedNamespaces: readonly string[];
}

export interface PluginResourceScope {
  readonly signal: AbortSignal;
  readonly addCleanup: (cleanup: () => void) => void;
}

export interface PanefoldPlugin<TContext> {
  readonly manifest: PluginManifest;
  /**
   * This registry is for trusted same-realm code. The bounded resource scope
   * provides deterministic cleanup but does not turn same-realm JavaScript
   * into a security sandbox. Use the isolated-frame host for untrusted code.
   */
  readonly activate?: (
    context: Readonly<TContext>,
    scope: PluginResourceScope,
  ) => void | (() => void);
}

export type PluginRegistrationResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | {
      readonly ok: false;
      readonly code:
        | "INVALID_MANIFEST"
        | "DUPLICATE_ID"
        | "CAPABILITY_DENIED"
        | "ENGINE_INCOMPATIBLE"
        | "PROTOCOL_INCOMPATIBLE";
      readonly message: string;
    };

export type PluginActivationResult =
  | { readonly ok: true; readonly active: boolean }
  | {
      readonly ok: false;
      readonly code: "NOT_FOUND" | "ACTIVATION_FAILED";
      readonly message: string;
    };

export type PluginContributionKind = "panel" | "command" | "persisted-namespace";

export interface ResolvedPluginContribution {
  readonly kind: PluginContributionKind;
  readonly id: string;
  readonly pluginId: string;
}

export interface PluginConflictDiagnostic {
  readonly kind: PluginContributionKind;
  readonly id: string;
  readonly winnerPluginId: string;
  readonly rejectedPluginIds: readonly string[];
}

export interface PluginContributionResolution {
  readonly contributions: readonly ResolvedPluginContribution[];
  readonly conflicts: readonly PluginConflictDiagnostic[];
}

export interface PluginDiagnostic {
  readonly pluginId: string;
  readonly phase: "activation" | "cleanup";
  readonly message: string;
}

export interface TrustedPluginRegistry<TContext> {
  readonly register: (plugin: PanefoldPlugin<TContext>) => PluginRegistrationResult;
  readonly unregister: (pluginId: string) => boolean;
  readonly activate: (pluginId: string, context: Readonly<TContext>) => PluginActivationResult;
  readonly deactivate: (pluginId: string) => boolean;
  readonly list: () => readonly PluginManifest[];
  readonly resolveContributions: () => PluginContributionResolution;
  readonly diagnostics: () => readonly PluginDiagnostic[];
  readonly isActive: (pluginId: string) => boolean;
  readonly dispose: () => void;
}

interface PluginRecord<TContext> {
  readonly plugin: PanefoldPlugin<TContext>;
  active: boolean;
  scope: MutablePluginScope | undefined;
}

interface MutablePluginScope extends PluginResourceScope {
  readonly close: () => readonly string[];
}

export interface TrustedPluginRegistryOptions {
  readonly allowedCapabilities: readonly PluginCapability[];
  readonly engineVersion: string;
  readonly protocolVersion: number;
  readonly diagnosticLimit?: number;
}

export function createTrustedPluginRegistry<TContext>(
  options: TrustedPluginRegistryOptions,
): TrustedPluginRegistry<TContext> {
  validateVersion(options.engineVersion, "engineVersion");
  if (!Number.isSafeInteger(options.protocolVersion) || options.protocolVersion < 1) {
    throw new RangeError("protocolVersion must be a positive safe integer");
  }
  const diagnosticLimit = options.diagnosticLimit ?? 128;
  if (!Number.isSafeInteger(diagnosticLimit) || diagnosticLimit < 1 || diagnosticLimit > 10_000) {
    throw new RangeError("diagnosticLimit must be an integer from 1 to 10,000");
  }
  const allowed = new Set(options.allowedCapabilities);
  const records = new Map<string, PluginRecord<TContext>>();
  const diagnostics: PluginDiagnostic[] = [];

  const recordDiagnostic = (diagnostic: PluginDiagnostic) => {
    diagnostics.push(Object.freeze(diagnostic));
    while (diagnostics.length > diagnosticLimit) diagnostics.shift();
  };

  const deactivate = (pluginId: string) => {
    const record = records.get(pluginId);
    if (record === undefined || !record.active) return false;
    record.active = false;
    const scope = record.scope;
    record.scope = undefined;
    for (const message of scope?.close() ?? []) {
      recordDiagnostic({ pluginId, phase: "cleanup", message });
    }
    return true;
  };

  const registry: TrustedPluginRegistry<TContext> = {
    register: (plugin) => {
      const validationError = validateManifest(plugin.manifest);
      if (validationError !== undefined) {
        return { ok: false, code: "INVALID_MANIFEST", message: validationError };
      }
      if (!engineSatisfies(options.engineVersion, plugin.manifest.engineRange)) {
        return {
          ok: false,
          code: "ENGINE_INCOMPATIBLE",
          message: `Plugin requires engine ${plugin.manifest.engineRange}; current engine is ${options.engineVersion}`,
        };
      }
      if (plugin.manifest.protocolVersion !== options.protocolVersion) {
        return {
          ok: false,
          code: "PROTOCOL_INCOMPATIBLE",
          message: `Plugin protocol ${String(plugin.manifest.protocolVersion)} does not match ${String(options.protocolVersion)}`,
        };
      }
      if (records.has(plugin.manifest.id)) {
        return {
          ok: false,
          code: "DUPLICATE_ID",
          message: `Plugin ${plugin.manifest.id} is already registered`,
        };
      }
      const denied = plugin.manifest.capabilities.find((capability) => !allowed.has(capability));
      if (denied !== undefined) {
        return {
          ok: false,
          code: "CAPABILITY_DENIED",
          message: `Capability ${denied} is not enabled for this registry`,
        };
      }
      const manifest = freezeManifest(plugin.manifest);
      records.set(manifest.id, {
        plugin: {
          manifest,
          ...(plugin.activate === undefined ? {} : { activate: plugin.activate }),
        },
        active: false,
        scope: undefined,
      });
      return { ok: true, manifest };
    },
    unregister: (pluginId) => {
      deactivate(pluginId);
      return records.delete(pluginId);
    },
    activate: (pluginId, context) => {
      const record = records.get(pluginId);
      if (record === undefined) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `Plugin ${pluginId} is not registered`,
        };
      }
      if (record.active) return { ok: true, active: true };
      const scope = createScope();
      try {
        const cleanup = record.plugin.activate?.(context, scope);
        if (typeof cleanup === "function") scope.addCleanup(cleanup);
        record.scope = scope;
        record.active = true;
        return { ok: true, active: true };
      } catch (error) {
        for (const message of scope.close()) {
          recordDiagnostic({ pluginId, phase: "cleanup", message });
        }
        const message = error instanceof Error ? error.message : "Plugin activation failed";
        recordDiagnostic({ pluginId, phase: "activation", message });
        return { ok: false, code: "ACTIVATION_FAILED", message };
      }
    },
    deactivate,
    list: () =>
      Object.freeze(
        [...records.values()]
          .map((record) => record.plugin.manifest)
          .sort((left, right) => compare(left.id, right.id)),
      ),
    resolveContributions: () => resolveContributions([...records.values()]),
    diagnostics: () => Object.freeze([...diagnostics]),
    isActive: (pluginId) => records.get(pluginId)?.active === true,
    dispose: () => {
      for (const pluginId of [...records.keys()].sort(compare)) deactivate(pluginId);
      records.clear();
    },
  };
  return Object.freeze(registry);
}

function validateManifest(manifest: PluginManifest): string | undefined {
  if (manifest.schemaVersion !== 1) return "Unsupported plugin manifest schema version";
  if (!validIdentifier(manifest.id))
    return "Plugin id must be a lowercase dotted or dashed identifier";
  try {
    validateVersion(manifest.version, "Plugin version");
    validateRange(manifest.engineRange);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid plugin version metadata";
  }
  if (!Number.isSafeInteger(manifest.protocolVersion) || manifest.protocolVersion < 1) {
    return "Plugin protocolVersion must be a positive safe integer";
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    return "Plugin capabilities must be unique";
  }
  for (const [name, values] of [
    ["panelTypes", manifest.panelTypes],
    ["commands", manifest.commands],
    ["persistedNamespaces", manifest.persistedNamespaces],
  ] as const) {
    if (values.length > 512) return `${name} exceeds the 512-entry limit`;
    if (new Set(values).size !== values.length) return `${name} must contain unique identifiers`;
    if (!values.every(validContributionIdentifier)) return `${name} contains an invalid identifier`;
  }
  return undefined;
}

function freezeManifest(manifest: PluginManifest): PluginManifest {
  return Object.freeze({
    schemaVersion: 1,
    id: manifest.id,
    version: manifest.version,
    engineRange: manifest.engineRange,
    protocolVersion: manifest.protocolVersion,
    capabilities: Object.freeze([...manifest.capabilities]),
    panelTypes: Object.freeze([...manifest.panelTypes]),
    commands: Object.freeze([...manifest.commands]),
    persistedNamespaces: Object.freeze([...manifest.persistedNamespaces]),
    ...(manifest.displayName === undefined ? {} : { displayName: manifest.displayName }),
  });
}

function resolveContributions<TContext>(
  records: readonly PluginRecord<TContext>[],
): PluginContributionResolution {
  const candidates: ResolvedPluginContribution[] = [];
  for (const record of records) {
    for (const id of record.plugin.manifest.panelTypes) {
      candidates.push({ kind: "panel", id, pluginId: record.plugin.manifest.id });
    }
    for (const id of record.plugin.manifest.commands) {
      candidates.push({ kind: "command", id, pluginId: record.plugin.manifest.id });
    }
    for (const id of record.plugin.manifest.persistedNamespaces) {
      candidates.push({ kind: "persisted-namespace", id, pluginId: record.plugin.manifest.id });
    }
  }
  candidates.sort((left, right) =>
    compare(
      `${left.kind}:${left.id}:${left.pluginId}`,
      `${right.kind}:${right.id}:${right.pluginId}`,
    ),
  );
  const groups = new Map<string, ResolvedPluginContribution[]>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id}`;
    const group = groups.get(key) ?? [];
    group.push(Object.freeze(candidate));
    groups.set(key, group);
  }
  const contributions: ResolvedPluginContribution[] = [];
  const conflicts: PluginConflictDiagnostic[] = [];
  for (const group of groups.values()) {
    const winner = group[0];
    if (winner === undefined) continue;
    contributions.push(winner);
    if (group.length > 1) {
      conflicts.push(
        Object.freeze({
          kind: winner.kind,
          id: winner.id,
          winnerPluginId: winner.pluginId,
          rejectedPluginIds: Object.freeze(group.slice(1).map((entry) => entry.pluginId)),
        }),
      );
    }
  }
  return Object.freeze({
    contributions: Object.freeze(contributions),
    conflicts: Object.freeze(conflicts),
  });
}

function createScope(): MutablePluginScope {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let closed = false;
  return Object.freeze({
    signal: controller.signal,
    addCleanup: (cleanup: () => void) => {
      if (closed) throw new Error("Plugin resource scope is already closed");
      cleanups.push(cleanup);
    },
    close: () => {
      if (closed) return Object.freeze([]);
      closed = true;
      controller.abort("plugin-deactivated");
      const errors: string[] = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Plugin cleanup failed");
        }
      }
      cleanups.length = 0;
      return Object.freeze(errors);
    },
  });
}

function engineSatisfies(engineVersion: string, range: string): boolean {
  const engine = parseVersion(engineVersion);
  if (range === "*") return true;
  if (range.startsWith("^")) {
    const minimum = parseVersion(range.slice(1));
    return engine[0] === minimum[0] && compareVersion(engine, minimum) >= 0;
  }
  if (range.startsWith("~")) {
    const minimum = parseVersion(range.slice(1));
    return (
      engine[0] === minimum[0] && engine[1] === minimum[1] && compareVersion(engine, minimum) >= 0
    );
  }
  return compareVersion(engine, parseVersion(range)) === 0;
}

function validateRange(range: string): void {
  if (range === "*") return;
  parseVersion(range.startsWith("^") || range.startsWith("~") ? range.slice(1) : range);
}

function validateVersion(version: string, label: string): void {
  try {
    parseVersion(version);
  } catch {
    throw new TypeError(`${label} must be a major.minor.patch semantic version`);
  }
}

function parseVersion(version: string): readonly [number, number, number] {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.exec(
    version,
  );
  if (match === null) throw new TypeError("Invalid semantic version");
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!parsed.every(Number.isSafeInteger))
    throw new TypeError("Semantic version exceeds safe integer bounds");
  return parsed;
}

function compareVersion(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function validIdentifier(value: string): boolean {
  return value.length <= 128 && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(value);
}

function validContributionIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 192 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
