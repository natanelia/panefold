import { solveLayout } from "@panefold/geometry";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import {
  nodeId,
  type CommittedTransaction,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import {
  createWorkspace,
  createWorkspaceActions,
  createWorkspacePlans,
  type RuntimeDispatchReceipt,
  type WorkspaceActions,
  type WorkspaceOptions,
  type WorkspacePlans,
  type WorkspaceRuntime,
} from "@panefold/runtime";

import {
  WorkspaceSurface as AdapterWorkspaceSurface,
  type WorkspaceSurfaceProps as AdapterWorkspaceSurfaceProps,
} from "./WorkspaceSurface";
import type { WorkspaceLayoutSolver } from "./geometry";
import {
  createModelWorkspaceCommands,
  projectModelWorkspace,
  type ModelWorkspaceOptions,
} from "./model-adapter";
import { useRuntimeTransactions, WorkspaceRuntimeProvider } from "./runtime-context";
import type { WorkspaceCommandAdapter, WorkspaceProjector } from "./types";

export {
  createModelWorkspaceCommands,
  projectModelWorkspace,
  type ModelWorkspaceOptions,
} from "./model-adapter";

/** The complete model bridge: use one binding per runtime and application policy. */
export interface ModelWorkspaceBindings {
  readonly runtime: WorkspaceRuntime;
  readonly actions: WorkspaceActions;
  readonly plan: WorkspacePlans;
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
    actions: createWorkspaceActions(runtime),
    plan: createWorkspacePlans(runtime),
    projector: (snapshot: WorkspaceSnapshot) => projectModelWorkspace(snapshot, options),
    commands: createModelWorkspaceCommands(() => runtime.getSnapshot(), options),
    layoutSolver,
  });
}

/** Create an in-memory runtime and its complete React bridge. Create/dispose it in an effect. */
export function createModelWorkspaceSession(
  runtimeOptions: WorkspaceOptions,
  options: ModelWorkspaceOptions = {},
): ModelWorkspaceSession {
  const runtime = createWorkspace(runtimeOptions);
  return Object.freeze({
    ...createModelWorkspaceBindings(runtime, options),
    dispose: () => runtime.dispose(),
  });
}

/**
 * Own an in-memory session for this component's lifetime. Returns undefined until
 * the first effect, including during server rendering. Setup is captured on the
 * first render; remount with a different key to replace it. A lazy setup function
 * runs only inside the effect and may run again during Strict Mode's effect replay.
 */
export function useModelWorkspaceSession(
  runtimeOptions: WorkspaceOptions | (() => WorkspaceOptions),
  options: ModelWorkspaceOptions = {},
): ModelWorkspaceSession | undefined {
  const [setup] = useState(() => ({ runtimeOptions, options }));
  const [session, setSession] = useState<ModelWorkspaceSession>();
  useEffect(() => {
    const initial =
      typeof setup.runtimeOptions === "function" ? setup.runtimeOptions() : setup.runtimeOptions;
    const next = createModelWorkspaceSession(initial, setup.options);
    setSession(next);
    return () => next.dispose();
  }, [setup]);
  return session;
}

const ModelWorkspaceContext = createContext<ModelWorkspaceBindings | null>(null);

export interface ModelWorkspaceProviderProps extends PropsWithChildren {
  readonly bindings: ModelWorkspaceBindings;
}

/** Share typed model bindings with application controls without owning their lifetime. */
export function ModelWorkspaceProvider({ bindings, children }: ModelWorkspaceProviderProps) {
  return (
    <ModelWorkspaceContext.Provider value={bindings}>
      <WorkspaceRuntimeProvider runtime={bindings.runtime}>{children}</WorkspaceRuntimeProvider>
    </ModelWorkspaceContext.Provider>
  );
}

function useModelWorkspaceBindings(): ModelWorkspaceBindings {
  const bindings = useContext(ModelWorkspaceContext);
  if (bindings === null) {
    throw new Error(
      "Workspace hooks require WorkspaceProvider or Workspace. Advanced model hooks also accept ModelWorkspaceProvider or ModelWorkspaceSurface.",
    );
  }
  return bindings;
}

/** Access the typed runtime, including dispatch, history, policies and subscriptions. */
export function useModelWorkspaceRuntime(): WorkspaceRuntime {
  return useModelWorkspaceBindings().runtime;
}

/** Access stable, typed application actions for the current model bindings. */
export function useModelWorkspaceActions(): WorkspaceActions {
  return useModelWorkspaceBindings().actions;
}

/** Prepare composable operations without dispatching or changing the current snapshot. */
export function useModelWorkspacePlans(): WorkspacePlans {
  return useModelWorkspaceBindings().plan;
}

/** Subscribe to the complete immutable model snapshot without generic arguments. */
export function useModelWorkspaceSnapshot(): WorkspaceSnapshot {
  const runtime = useModelWorkspaceRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
}

/** Subscribe to the bounded model transaction log, with typed transaction entries. */
export function useModelWorkspaceTransactions(): readonly CommittedTransaction[] {
  return useRuntimeTransactions(useModelWorkspaceRuntime());
}

/** Subscribe to a model selection; equal selections retain their previous identity. */
export function useModelWorkspaceSelector<Value>(
  selector: (snapshot: WorkspaceSnapshot) => Value,
  isEqual: (previous: Value, next: Value) => boolean = Object.is,
): Value {
  const runtime = useModelWorkspaceRuntime();
  return useSyncExternalStoreWithSelector(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
    selector,
    isEqual,
  );
}

export interface ModelWorkspaceSurfaceProps extends Omit<
  AdapterWorkspaceSurfaceProps<WorkspaceSnapshot, WorkspaceCommand, RuntimeDispatchReceipt>,
  "projector" | "commands" | "layoutSolver"
> {
  readonly bindings: ModelWorkspaceBindings;
}

/** Always installs the bindings' model-aware solver along with its provider and commands. */
export function ModelWorkspaceSurface({ bindings, ...props }: ModelWorkspaceSurfaceProps) {
  return (
    <ModelWorkspaceProvider bindings={bindings}>
      <AdapterWorkspaceSurface
        {...props}
        projector={bindings.projector}
        commands={bindings.commands}
        layoutSolver={bindings.layoutSolver}
      />
    </ModelWorkspaceProvider>
  );
}

export interface WorkspaceProviderProps extends PropsWithChildren {
  /** Caller-owned runtime. This provider never disposes it. */
  readonly workspace: WorkspaceRuntime;
  readonly options?: ModelWorkspaceOptions;
}

/** Share an existing model runtime with application controls and workspace surfaces. */
export function WorkspaceProvider({ workspace, options, children }: WorkspaceProviderProps) {
  const bindings = useMemo(
    () => createModelWorkspaceBindings(workspace, options),
    [workspace, options],
  );
  return <ModelWorkspaceProvider bindings={bindings}>{children}</ModelWorkspaceProvider>;
}

export type WorkspaceSurfaceProps = Omit<ModelWorkspaceSurfaceProps, "bindings">;

/** Render the current provider's workspace with model commands and constraints installed. */
export function WorkspaceSurface(props: WorkspaceSurfaceProps) {
  const bindings = useModelWorkspaceBindings();
  return (
    <AdapterWorkspaceSurface
      {...props}
      projector={bindings.projector}
      commands={bindings.commands}
      layoutSolver={bindings.layoutSolver}
    />
  );
}

export interface WorkspaceProps extends PropsWithChildren {
  /** Initial layout/snapshot and runtime limits; remount with a new key to replace them. */
  readonly initial: WorkspaceOptions | (() => WorkspaceOptions);
  /** Initial model integration policy. Render independently configured surfaces as children. */
  readonly options?: ModelWorkspaceOptions;
  /** Rendered during SSR and until the owned runtime is created after mount. */
  readonly fallback?: ReactNode;
}

/**
 * Own an in-memory workspace without adding DOM or choosing its presentation.
 * Compose surfaces, application controls and observers as children in any order.
 */
export function Workspace({ initial, options, fallback = null, children }: WorkspaceProps) {
  const session = useModelWorkspaceSession(initial, options);
  if (session === undefined) return fallback;
  return <ModelWorkspaceProvider bindings={session}>{children}</ModelWorkspaceProvider>;
}
