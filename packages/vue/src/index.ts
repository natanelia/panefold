import { onScopeDispose, shallowRef, type ShallowRef } from "vue";
import {
  createWorkspaceAdapter,
  type WorkspaceAdapterDispatchOptions,
  type WorkspaceAdapterPort,
  type WorkspaceAdapterSource,
} from "@panefold/adapter-contract";

export interface VueWorkspaceBinding<TSnapshot, TCommand, TResult, TOptions> {
  readonly snapshot: Readonly<ShallowRef<TSnapshot>>;
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly dispose: () => void;
}

/**
 * Vue-native binding using a shallow ref so immutable snapshots are not
 * recursively proxied. Call `dispose` when using it outside a component scope.
 */
export function createPanefoldVueBinding<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): VueWorkspaceBinding<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  const snapshot = shallowRef(source.getSnapshot()) as ShallowRef<TSnapshot>;
  const unsubscribe = port.subscribe((nextSnapshot) => {
    snapshot.value = nextSnapshot;
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    port.dispose();
  };
  return { snapshot, port, dispatch: port.dispatch, dispose };
}

/** Vue composable that binds disposal to the current effect scope. */
export function usePanefoldWorkspace<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): VueWorkspaceBinding<TSnapshot, TCommand, TResult, TOptions> {
  const binding = createPanefoldVueBinding(source);
  onScopeDispose(binding.dispose);
  return binding;
}
