import { createWorkspaceLayout, type WorkspaceLayoutInput } from "@panefold/model";

import {
  createWorkspaceActions,
  createWorkspacePlans,
  type WorkspaceActions,
  type WorkspacePlans,
} from "./actions";
import {
  createWorkspaceRuntime,
  type WorkspaceRuntime,
  type WorkspaceRuntimeOptions,
} from "./runtime";

type RuntimeTuning = Omit<WorkspaceRuntimeOptions, "initialSnapshot">;

/** Start from a compact layout definition or an already decoded, validated snapshot. */
export type WorkspaceOptions =
  | (WorkspaceLayoutInput & RuntimeTuning & { readonly initialSnapshot?: never })
  | (WorkspaceRuntimeOptions & {
      readonly panels?: never;
      readonly layout?: never;
      readonly surfaceId?: never;
      readonly activePanelId?: never;
      readonly applicationLayoutVersion?: never;
      readonly metadata?: never;
    });

export interface Workspace extends WorkspaceRuntime {
  readonly actions: WorkspaceActions;
  readonly plan: WorkspacePlans;
}

/**
 * Create an in-memory workspace with defaults, action helpers and bounded history.
 * The caller owns dispose(). React's Workspace component manages this lifetime automatically.
 */
export function createWorkspace(options: WorkspaceOptions): Workspace {
  if (
    options.initialSnapshot !== undefined &&
    (options.panels !== undefined || options.layout !== undefined)
  ) {
    throw new TypeError("Provide either panels and layout or initialSnapshot, not both.");
  }
  const initialSnapshot =
    options.initialSnapshot ?? createWorkspaceLayout(options as WorkspaceLayoutInput);
  const runtime = createWorkspaceRuntime({ ...options, initialSnapshot });
  return Object.defineProperties(runtime, {
    actions: { value: createWorkspaceActions(runtime), enumerable: true },
    plan: { value: createWorkspacePlans(runtime), enumerable: true },
  }) as Workspace;
}
