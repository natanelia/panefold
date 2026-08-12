export type PluginCapability = "panels" | "commands" | "devtools" | "collaboration" | "mobile";

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly displayName?: string;
  readonly capabilities: readonly PluginCapability[];
}

export interface PanefoldPlugin<TContext> {
  readonly manifest: PluginManifest;
  /**
   * Plugins registered here are trusted same-realm code. This hook is not a
   * security sandbox and must never be used for untrusted dynamic modules.
   */
  readonly activate?: (context: TContext) => void | (() => void);
}

export type PluginRegistrationResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | {
      readonly ok: false;
      readonly code: "INVALID_MANIFEST" | "DUPLICATE_ID" | "CAPABILITY_DENIED";
      readonly message: string;
    };

export type PluginActivationResult =
  | { readonly ok: true; readonly active: boolean }
  | {
      readonly ok: false;
      readonly code: "NOT_FOUND" | "ACTIVATION_FAILED";
      readonly message: string;
    };

export interface TrustedPluginRegistry<TContext> {
  readonly register: (plugin: PanefoldPlugin<TContext>) => PluginRegistrationResult;
  readonly unregister: (pluginId: string) => boolean;
  readonly activate: (pluginId: string, context: TContext) => PluginActivationResult;
  readonly deactivate: (pluginId: string) => boolean;
  readonly list: () => readonly PluginManifest[];
  readonly isActive: (pluginId: string) => boolean;
  readonly dispose: () => void;
}

interface PluginRecord<TContext> {
  readonly plugin: PanefoldPlugin<TContext>;
  active: boolean;
  cleanup: (() => void) | undefined;
}

export function createTrustedPluginRegistry<TContext>(options: {
  readonly allowedCapabilities: readonly PluginCapability[];
}): TrustedPluginRegistry<TContext> {
  const allowed = new Set(options.allowedCapabilities);
  const records = new Map<string, PluginRecord<TContext>>();

  const deactivate = (pluginId: string) => {
    const record = records.get(pluginId);
    if (record === undefined || !record.active) return false;
    record.active = false;
    const cleanup = record.cleanup;
    record.cleanup = undefined;
    cleanup?.();
    return true;
  };

  return {
    register: (plugin) => {
      const validationError = validateManifest(plugin.manifest);
      if (validationError !== undefined) {
        return { ok: false, code: "INVALID_MANIFEST", message: validationError };
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
        cleanup: undefined,
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
      try {
        const cleanup = record.plugin.activate?.(context);
        record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
        record.active = true;
        return { ok: true, active: true };
      } catch (error) {
        return {
          ok: false,
          code: "ACTIVATION_FAILED",
          message: error instanceof Error ? error.message : "Plugin activation failed",
        };
      }
    },
    deactivate,
    list: () =>
      [...records.values()]
        .map((record) => record.plugin.manifest)
        .sort((left, right) => left.id.localeCompare(right.id)),
    isActive: (pluginId) => records.get(pluginId)?.active === true,
    dispose: () => {
      for (const pluginId of [...records.keys()]) deactivate(pluginId);
      records.clear();
    },
  };
}

function validateManifest(manifest: PluginManifest): string | undefined {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(manifest.id)) {
    return "Plugin id must be a lowercase dotted or dashed identifier";
  }
  if (manifest.version.trim().length === 0 || manifest.version.length > 64) {
    return "Plugin version must be a non-empty string no longer than 64 characters";
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    return "Plugin capabilities must be unique";
  }
  return undefined;
}

function freezeManifest(manifest: PluginManifest): PluginManifest {
  return Object.freeze({
    id: manifest.id,
    version: manifest.version,
    capabilities: Object.freeze([...manifest.capabilities]),
    ...(manifest.displayName === undefined ? {} : { displayName: manifest.displayName }),
  });
}
