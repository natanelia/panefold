import { assign, createActor, setup } from "xstate";

export interface PluginLoadContext {
  readonly pluginId: string | undefined;
  readonly version: string | undefined;
  readonly failureKind:
    | "manifest"
    | "version"
    | "load"
    | "registration"
    | "renderer"
    | "migration"
    | undefined;
  readonly failure: string | undefined;
}

export type PluginLoadEvent =
  | { readonly type: "REGISTER"; readonly pluginId: string; readonly version: string }
  | { readonly type: "VALIDATED" | "LOADED" | "REGISTERED" | "UNLOAD" | "UNLOADED" | "RETRY" }
  | { readonly type: "SCOPE_CLOSED" }
  | {
      readonly type:
        | "MANIFEST_CONFLICT"
        | "VERSION_CONFLICT"
        | "LOAD_FAILED"
        | "REGISTRATION_FAILED"
        | "RENDERER_FAILED"
        | "MIGRATION_FAILED";
      readonly message: string;
    };

export const pluginLoadMachine = setup({
  types: {
    context: {} as PluginLoadContext,
    events: {} as PluginLoadEvent,
  },
  actions: {
    register: assign(({ event }) =>
      event.type === "REGISTER"
        ? {
            pluginId: event.pluginId,
            version: event.version,
            failureKind: undefined,
            failure: undefined,
          }
        : {},
    ),
    fail: assign(({ event }) => {
      if (!("message" in event)) return {};
      const failureKind: NonNullable<PluginLoadContext["failureKind"]> = {
        MANIFEST_CONFLICT: "manifest",
        VERSION_CONFLICT: "version",
        LOAD_FAILED: "load",
        REGISTRATION_FAILED: "registration",
        RENDERER_FAILED: "renderer",
        MIGRATION_FAILED: "migration",
      }[event.type] as NonNullable<PluginLoadContext["failureKind"]>;
      return { failureKind, failure: event.message };
    }),
    clear: assign({ failureKind: undefined, failure: undefined }),
    reset: assign({
      pluginId: undefined,
      version: undefined,
      failureKind: undefined,
      failure: undefined,
    }),
  },
}).createMachine({
  id: "plugin-load",
  initial: "unregistered",
  context: {
    pluginId: undefined,
    version: undefined,
    failureKind: undefined,
    failure: undefined,
  },
  states: {
    unregistered: {
      entry: "reset",
      on: { REGISTER: { target: "validating", actions: "register" } },
    },
    validating: {
      on: {
        VALIDATED: { target: "loading" },
        MANIFEST_CONFLICT: { target: "failed", actions: "fail" },
        VERSION_CONFLICT: { target: "failed", actions: "fail" },
        SCOPE_CLOSED: { target: "unloading" },
      },
    },
    loading: {
      on: {
        LOADED: { target: "registering" },
        LOAD_FAILED: { target: "failed", actions: "fail" },
        MIGRATION_FAILED: { target: "failed", actions: "fail" },
        SCOPE_CLOSED: { target: "unloading" },
      },
    },
    registering: {
      on: {
        REGISTERED: { target: "active" },
        REGISTRATION_FAILED: { target: "failed", actions: "fail" },
        SCOPE_CLOSED: { target: "unloading" },
      },
    },
    active: {
      on: {
        UNLOAD: { target: "unloading" },
        SCOPE_CLOSED: { target: "unloading" },
        RENDERER_FAILED: { target: "failed", actions: "fail" },
        MIGRATION_FAILED: { target: "failed", actions: "fail" },
      },
    },
    failed: {
      on: {
        RETRY: { target: "validating", actions: "clear" },
        UNLOAD: { target: "unloading" },
        SCOPE_CLOSED: { target: "unloading" },
      },
    },
    unloading: {
      on: { UNLOADED: { target: "unregistered" } },
    },
  },
});

export function createPluginLoadActor() {
  return createActor(pluginLoadMachine);
}
