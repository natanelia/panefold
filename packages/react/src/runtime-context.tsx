import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";

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

export function useWorkspaceProjection<TSnapshot, TCommand, TResult, TSelection>(
  selector: (snapshot: TSnapshot) => TSelection,
): TSelection {
  const snapshot = useWorkspaceSnapshot<TSnapshot, TCommand, TResult>();
  return useMemo(() => selector(snapshot), [selector, snapshot]);
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
