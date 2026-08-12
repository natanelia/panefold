import {
  DestroyRef,
  InjectionToken,
  inject,
  signal,
  type Provider,
  type Signal,
} from "@angular/core";
import {
  createWorkspaceAdapter,
  type WorkspaceAdapterDispatchOptions,
  type WorkspaceAdapterPort,
  type WorkspaceAdapterSource,
} from "@panefold/adapter-contract";

type UnknownSource = WorkspaceAdapterSource<unknown, unknown, unknown, unknown>;

export const PANEFOLD_WORKSPACE_SOURCE = new InjectionToken<UnknownSource>(
  "PANEFOLD_WORKSPACE_SOURCE",
);

export interface AngularWorkspaceBinding<TSnapshot, TCommand, TResult, TOptions> {
  readonly snapshot: Signal<TSnapshot>;
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly dispose: () => void;
}

export function providePanefoldWorkspace<TSnapshot, TCommand, TResult, TOptions>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): Provider {
  return {
    provide: PANEFOLD_WORKSPACE_SOURCE,
    useValue: source,
  };
}

/** Angular-native signal binding for services or manual lifecycle ownership. */
export function createPanefoldAngularBinding<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): AngularWorkspaceBinding<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  const snapshot = signal<TSnapshot>(port.getSnapshot());
  const unsubscribe = port.subscribe((nextSnapshot) => {
    snapshot.set(nextSnapshot);
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    port.dispose();
  };
  return {
    snapshot: snapshot.asReadonly(),
    port,
    dispatch: port.dispatch,
    dispose,
  };
}

/** Angular injection-context helper that binds disposal to `DestroyRef`. */
export function injectPanefoldWorkspace<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(): AngularWorkspaceBinding<TSnapshot, TCommand, TResult, TOptions> {
  const source = inject(PANEFOLD_WORKSPACE_SOURCE) as unknown as WorkspaceAdapterSource<
    TSnapshot,
    TCommand,
    TResult,
    TOptions
  >;
  const binding = createPanefoldAngularBinding(source);
  inject(DestroyRef).onDestroy(binding.dispose);
  return binding;
}
