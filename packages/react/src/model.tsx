import { solveLayout } from "@panefold/geometry";
import { nodeId, type WorkspaceCommand, type WorkspaceSnapshot } from "@panefold/model";
import {
  createWorkspaceRuntime,
  type RuntimeDispatchReceipt,
  type WorkspaceRuntime,
  type WorkspaceRuntimeOptions,
} from "@panefold/runtime";

import { WorkspaceSurface, type WorkspaceSurfaceProps } from "./WorkspaceSurface";
import type { WorkspaceLayoutSolver } from "./geometry";
import {
  createModelWorkspaceCommands,
  projectModelWorkspace,
  type ModelWorkspaceOptions,
} from "./model-adapter";
import { WorkspaceRuntimeProvider } from "./runtime-context";
import type { WorkspaceCommandAdapter, WorkspaceProjector } from "./types";

export {
  createModelWorkspaceCommands,
  projectModelWorkspace,
  type ModelWorkspaceOptions,
} from "./model-adapter";

/** The complete model bridge: use one binding per runtime and application policy. */
export interface ModelWorkspaceBindings {
  readonly runtime: WorkspaceRuntime;
  readonly projector: WorkspaceProjector<WorkspaceSnapshot>;
  readonly commands: WorkspaceCommandAdapter<WorkspaceCommand>;
  readonly layoutSolver: WorkspaceLayoutSolver<WorkspaceSnapshot>;
}

export interface ModelWorkspaceSession extends ModelWorkspaceBindings {
  /** Dispose the runtime created by this session. Safe to call more than once. */
  readonly dispose: () => void;
}

/** Bind an existing runtime without taking ownership of its lifetime or persistence. */
export function createModelWorkspaceBindings(
  runtime: WorkspaceRuntime,
  options: ModelWorkspaceOptions = {},
): ModelWorkspaceBindings {
  const modelSolver = options.solveLayout ?? solveLayout;
  const layoutSolver: WorkspaceLayoutSolver<WorkspaceSnapshot> = (snapshot, request) =>
    modelSolver(snapshot, nodeId(request.rootNodeId), request.bounds, {
      splitterSize: request.splitterSize,
      splitOverrides: request.splitOverrides,
    });
  return Object.freeze({
    runtime,
    projector: (snapshot: WorkspaceSnapshot) => projectModelWorkspace(snapshot, options),
    commands: createModelWorkspaceCommands(() => runtime.getSnapshot(), options),
    layoutSolver,
  });
}

/** Create an in-memory runtime and its complete React bridge. Create/dispose it in an effect. */
export function createModelWorkspaceSession(
  runtimeOptions: WorkspaceRuntimeOptions,
  options: ModelWorkspaceOptions = {},
): ModelWorkspaceSession {
  const runtime = createWorkspaceRuntime(runtimeOptions);
  return Object.freeze({
    ...createModelWorkspaceBindings(runtime, options),
    dispose: () => runtime.dispose(),
  });
}

export interface ModelWorkspaceSurfaceProps extends Omit<
  WorkspaceSurfaceProps<WorkspaceSnapshot, WorkspaceCommand, RuntimeDispatchReceipt>,
  "projector" | "commands" | "layoutSolver"
> {
  readonly bindings: ModelWorkspaceBindings;
}

/** Always installs the bindings' model-aware solver along with its provider and commands. */
export function ModelWorkspaceSurface({ bindings, ...props }: ModelWorkspaceSurfaceProps) {
  return (
    <WorkspaceRuntimeProvider runtime={bindings.runtime}>
      <WorkspaceSurface
        {...props}
        projector={bindings.projector}
        commands={bindings.commands}
        layoutSolver={bindings.layoutSolver}
      />
    </WorkspaceRuntimeProvider>
  );
}
