import {
  createContext,
  useContext,
  useMemo,
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
  return useRuntimeTransactions(runtime);
}

interface TransactionSource<Transaction> {
  readonly getTransactions?: () => readonly Transaction[];
  readonly subscribeTransactions?: (listener: () => void) => () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** Shared implementation for generic adapters and the typed model binding. */
export function useRuntimeTransactions<Transaction>(
  runtime: TransactionSource<Transaction>,
): readonly Transaction[] {
  const source = useMemo(() => {
    let previous: readonly Transaction[] = [];
    let dirty = true;
    const getSnapshot = () => {
      if (!dirty) return previous;
      const next = runtime.getTransactions?.() ?? [];
      // Read only after a notification or subscription change. Custom adapters
      // may reconstruct both the array and its entries on every call.
      if (
        next.length !== previous.length ||
        next.some((entry, index) => entry !== previous[index])
      ) {
        previous = [...next];
      }
      dirty = false;
      return previous;
    };
    return {
      getSnapshot,
      subscribe: (listener: () => void) => {
        let active = true;
        const onChange = () => {
          if (!active) return;
          dirty = true;
          listener();
        };
        const unsubscribe =
          runtime.subscribeTransactions === undefined
            ? runtime.subscribe(onChange)
            : runtime.subscribeTransactions(onChange);
        // Attach before reading again to cover changes between render and
        // subscription, including reattachment after an Activity was hidden.
        dirty = true;
        try {
          getSnapshot();
          // Activity can reconnect effects without rerendering the consumer.
          // Notify React after refreshing so a hidden-period change is visible.
          listener();
        } catch (error) {
          active = false;
          unsubscribe();
          throw error;
        }
        return () => {
          active = false;
          dirty = true;
          unsubscribe();
        };
      },
    };
  }, [runtime]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}
