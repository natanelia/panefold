import { onDestroy } from "svelte";
import { readable, type Readable } from "svelte/store";
import {
  createWorkspaceAdapter,
  type WorkspaceAdapterDispatchOptions,
  type WorkspaceAdapterPort,
  type WorkspaceAdapterSource,
} from "@panefold/adapter-contract";

export interface SvelteWorkspaceStore<
  TSnapshot,
  TCommand,
  TResult,
  TOptions,
> extends Readable<TSnapshot> {
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly dispose: () => void;
}

export function createPanefoldWorkspaceStore<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): SvelteWorkspaceStore<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  const store = readable(port.getSnapshot(), (set) => {
    set(port.getSnapshot());
    return port.subscribe(set);
  });
  return {
    subscribe: store.subscribe,
    port,
    dispatch: port.dispatch,
    dispose: port.dispose,
  };
}

/** Svelte component helper that binds store disposal to `onDestroy`. */
export function usePanefoldWorkspace<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): SvelteWorkspaceStore<TSnapshot, TCommand, TResult, TOptions> {
  const store = createPanefoldWorkspaceStore(source);
  onDestroy(store.dispose);
  return store;
}
