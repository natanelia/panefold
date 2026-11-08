import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { WorkspaceRuntimeLike } from "./types";

type UnknownRuntime = WorkspaceRuntimeLike<unknown, unknown, unknown>;

const RuntimeContext = createContext<UnknownRuntime | null>(null);

export interface WorkspaceRuntimeProviderProps<
  TSnapshot,
  TCommand,
  TResult,
> extends PropsWithChildren {
  readonly runtime: WorkspaceRuntimeLike<TSnapshot, TCommand, TResult>;
}

export function WorkspaceRuntimeProvider<TSnapshot, TCommand, TResult>({
  runtime,
  children,
}: WorkspaceRuntimeProviderProps<TSnapshot, TCommand, TResult>) {
  return (
    <RuntimeContext.Provider value={runtime as UnknownRuntime}>{children}</RuntimeContext.Provider>
  );
}

export function useWorkspaceRuntime<TSnapshot, TCommand, TResult>() {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("useWorkspaceRuntime must be used inside WorkspaceRuntimeProvider");
  }

  return runtime as WorkspaceRuntimeLike<TSnapshot, TCommand, TResult>;
}

export function useWorkspaceSnapshot<TSnapshot, TCommand, TResult>() {
  const runtime = useWorkspaceRuntime<TSnapshot, TCommand, TResult>();
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
}

/**
 * Read a selection without rerendering for unrelated workspace changes.
 * Selectors and equality checks must be pure. Object selections can supply an
 * equality check to retain their previous value when its contents are unchanged.
 */
export function useWorkspaceProjection<TSnapshot, TCommand, TResult, TSelection>(
  selector: (snapshot: TSnapshot) => TSelection,
  isEqual: (previous: TSelection, next: TSelection) => boolean = Object.is,
): TSelection {
  const runtime = useWorkspaceRuntime<TSnapshot, TCommand, TResult>();
  return useSyncExternalStoreWithSelector(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
    selector,
    isEqual,
  );
}

export function useWorkspaceTransactions<TSnapshot, TCommand, TResult>() {
  const runtime = useWorkspaceRuntime<TSnapshot, TCommand, TResult>();
  const [transactions, setTransactions] = useState<readonly unknown[]>(
    () => runtime.getTransactions?.() ?? [],
  );

  useEffect(() => {
    const subscribe = runtime.subscribeTransactions ?? runtime.subscribe;
    return subscribe(() => {
      setTransactions(runtime.getTransactions?.() ?? []);
    });
  }, [runtime]);

  return transactions;
}
