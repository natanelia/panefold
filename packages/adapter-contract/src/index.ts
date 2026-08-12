export type WorkspaceUnsubscribe = () => void;

export interface WorkspaceAdapterDispatchOptions {
  readonly origin?: string;
  readonly label?: string;
}

/**
 * Minimum contract shared by every framework adapter. Framework state is a
 * projection of this source and never becomes another owner of workspace
 * truth.
 */
export interface WorkspaceAdapterSource<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
> {
  readonly getSnapshot: () => TSnapshot;
  readonly subscribe: (listener: () => void) => WorkspaceUnsubscribe;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
}

export interface WorkspaceAdapterSubscriptionOptions {
  readonly emitCurrent?: boolean;
}

export interface WorkspaceAdapterObserverErrorContext {
  readonly phase: "emit-current" | "update";
}

export interface WorkspaceAdapterOptions {
  /** Observer and reporter failures are isolated from the source runtime. */
  readonly onObserverError?: (
    error: unknown,
    context: WorkspaceAdapterObserverErrorContext,
  ) => void;
}

export interface WorkspaceSelection<TSelection> {
  readonly getSnapshot: () => TSelection;
  readonly subscribe: (
    listener: (selection: TSelection) => void,
    options?: WorkspaceAdapterSubscriptionOptions,
  ) => WorkspaceUnsubscribe;
}

export interface WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions> {
  readonly disposed: boolean;
  readonly getSnapshot: () => TSnapshot;
  readonly subscribe: (
    listener: (snapshot: TSnapshot) => void,
    options?: WorkspaceAdapterSubscriptionOptions,
  ) => WorkspaceUnsubscribe;
  readonly select: <TSelection>(
    selector: (snapshot: TSnapshot) => TSelection,
    equal?: (left: TSelection, right: TSelection) => boolean,
  ) => WorkspaceSelection<TSelection>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly dispose: () => void;
}

export class WorkspaceAdapterDisposedError extends Error {
  public constructor() {
    super("The workspace adapter has been disposed");
    this.name = "WorkspaceAdapterDisposedError";
  }
}

export function createWorkspaceAdapter<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
  options: WorkspaceAdapterOptions = {},
): WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions> {
  let disposed = false;
  let currentSnapshot = source.getSnapshot();
  const listeners = new Set<(snapshot: TSnapshot) => void>();
  const reportObserverError = (error: unknown, context: WorkspaceAdapterObserverErrorContext) => {
    try {
      options.onObserverError?.(error, context);
    } catch {
      // A diagnostic hook is also an observer. It must never reach the source
      // runtime or prevent later subscribers from receiving the snapshot.
    }
  };
  const notify = <T>(
    listener: (value: T) => void,
    value: T,
    phase: WorkspaceAdapterObserverErrorContext["phase"],
  ) => {
    try {
      listener(value);
    } catch (error) {
      reportObserverError(error, { phase });
    }
  };
  const detach = source.subscribe(() => {
    if (disposed) return;
    const nextSnapshot = source.getSnapshot();
    if (Object.is(currentSnapshot, nextSnapshot)) return;
    currentSnapshot = nextSnapshot;
    for (const listener of [...listeners]) notify(listener, nextSnapshot, "update");
  });

  const assertLive = () => {
    if (disposed) throw new WorkspaceAdapterDisposedError();
  };

  const port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions> = {
    get disposed() {
      return disposed;
    },
    getSnapshot: () => {
      assertLive();
      return currentSnapshot;
    },
    subscribe: (listener, options = {}) => {
      assertLive();
      listeners.add(listener);
      if (options.emitCurrent === true) notify(listener, currentSnapshot, "emit-current");
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    select: (selector, equal = Object.is) => ({
      getSnapshot: () => selector(port.getSnapshot()),
      subscribe: (listener, options = {}) => {
        let selection = selector(port.getSnapshot());
        if (options.emitCurrent === true) notify(listener, selection, "emit-current");
        return port.subscribe((snapshot) => {
          const nextSelection = selector(snapshot);
          if (equal(selection, nextSelection)) return;
          selection = nextSelection;
          listener(nextSelection);
        });
      },
    }),
    dispatch: (command, options) => {
      assertLive();
      return options === undefined ? source.dispatch(command) : source.dispatch(command, options);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      detach();
    },
  };

  return port;
}

export interface WorkspaceWritableRef<T> {
  value: T;
}

export interface VueWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly snapshot: WorkspaceWritableRef<TSnapshot>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly dispose: () => void;
}

/**
 * Pass Vue's `shallowRef` as `createRef` to receive native Vue reactivity.
 * The default ref keeps the bridge dependency-free for custom integrations.
 */
export function createVueWorkspaceAdapter<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
  createRef: (initial: TSnapshot) => WorkspaceWritableRef<TSnapshot> = (value) => ({
    value,
  }),
): VueWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  const snapshot = createRef(port.getSnapshot());
  const unsubscribe = port.subscribe((nextSnapshot) => {
    snapshot.value = nextSnapshot;
  });
  return {
    port,
    snapshot,
    dispatch: port.dispatch,
    dispose: () => {
      unsubscribe();
      port.dispose();
    },
  };
}

export interface SvelteWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly subscribe: (listener: (snapshot: TSnapshot) => void) => WorkspaceUnsubscribe;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly dispose: () => void;
}

/** Implements Svelte's dependency-free readable-store protocol. */
export function createSvelteWorkspaceAdapter<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
): SvelteWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  return {
    port,
    subscribe: (listener) => port.subscribe(listener, { emitCurrent: true }),
    dispatch: port.dispatch,
    dispose: port.dispose,
  };
}

export interface WorkspaceWritableSignal<T> {
  (): T;
  set(value: T): void;
}

export interface AngularWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly snapshot: WorkspaceWritableSignal<TSnapshot>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly destroy: () => void;
}

/** Pass Angular's `signal` as `createSignal` to receive a native signal. */
export function createAngularWorkspaceAdapter<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
  createSignal: (initial: TSnapshot) => WorkspaceWritableSignal<TSnapshot> = createPlainSignal,
): AngularWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  const snapshot = createSignal(port.getSnapshot());
  const unsubscribe = port.subscribe((nextSnapshot) => {
    snapshot.set(nextSnapshot);
  });
  return {
    port,
    snapshot,
    dispatch: port.dispatch,
    destroy: () => {
      unsubscribe();
      port.dispose();
    },
  };
}

export interface WorkspaceElementHost {
  readonly setAttribute: (name: string, value: string) => void;
  readonly removeAttribute: (name: string) => void;
  readonly dispatchEvent: (event: Event) => boolean;
}

export class WorkspaceSnapshotEvent<TSnapshot> extends Event {
  public readonly snapshot: TSnapshot;

  public constructor(snapshot: TSnapshot) {
    super("panefold-snapshot");
    this.snapshot = snapshot;
  }
}

export interface WebComponentWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  readonly port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>;
  readonly dispatch: (command: TCommand, options?: TOptions) => TResult;
  readonly disconnect: () => void;
}

/**
 * Connects the standards-based lifecycle of a custom element to Panefold. The
 * element owns only a projection and emits `panefold-snapshot`; canonical state
 * remains in the source runtime.
 */
export function connectWorkspaceElement<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  host: WorkspaceElementHost,
  source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions>,
  snapshotLabel: (snapshot: TSnapshot) => string | undefined = defaultSnapshotLabel,
): WebComponentWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> {
  const port = createWorkspaceAdapter(source);
  let connected = true;
  const project = (snapshot: TSnapshot, announce: boolean) => {
    const label = snapshotLabel(snapshot);
    if (label === undefined) host.removeAttribute("data-panefold-revision");
    else host.setAttribute("data-panefold-revision", label);
    if (announce) host.dispatchEvent(new WorkspaceSnapshotEvent(snapshot));
  };
  host.setAttribute("data-panefold-state", "connected");
  project(port.getSnapshot(), false);
  const unsubscribe = port.subscribe((snapshot) => {
    project(snapshot, true);
  });

  return {
    port,
    dispatch: port.dispatch,
    disconnect: () => {
      if (!connected) return;
      connected = false;
      unsubscribe();
      port.dispose();
      host.setAttribute("data-panefold-state", "disconnected");
      host.removeAttribute("data-panefold-revision");
    },
  };
}

export interface WorkspaceAdapterCertification {
  readonly currentSnapshotDelivered: boolean;
  readonly updateDelivered: boolean;
  readonly unsubscribeStoppedDelivery: boolean;
  readonly passed: boolean;
}

/**
 * A small framework-neutral certification probe. `advance` must synchronously
 * commit one new immutable snapshot through the supplied port.
 */
export function certifyWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions>(
  port: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions>,
  advance: () => void,
): WorkspaceAdapterCertification {
  const initialSnapshot = port.getSnapshot();
  const observed: TSnapshot[] = [];
  const unsubscribe = port.subscribe(
    (snapshot) => {
      observed.push(snapshot);
    },
    { emitCurrent: true },
  );
  advance();
  const updatedSnapshot = port.getSnapshot();
  const currentSnapshotDelivered = Object.is(observed[0], initialSnapshot);
  const updateDelivered = Object.is(observed.at(-1), updatedSnapshot);
  unsubscribe();
  const observedBeforeUnsubscribedAdvance = observed.length;
  advance();
  const unsubscribeStoppedDelivery = observed.length === observedBeforeUnsubscribedAdvance;
  return {
    currentSnapshotDelivered,
    updateDelivered,
    unsubscribeStoppedDelivery,
    passed: currentSnapshotDelivered && updateDelivered && unsubscribeStoppedDelivery,
  };
}

function createPlainSignal<T>(initial: T): WorkspaceWritableSignal<T> {
  let value = initial;
  const signal = (() => value) as WorkspaceWritableSignal<T>;
  signal.set = (nextValue) => {
    value = nextValue;
  };
  return signal;
}

function defaultSnapshotLabel(snapshot: unknown): string | undefined {
  if (typeof snapshot !== "object" || snapshot === null || !("revision" in snapshot)) {
    return undefined;
  }
  const revision = snapshot.revision;
  return typeof revision === "string" ||
    typeof revision === "number" ||
    typeof revision === "bigint"
    ? String(revision)
    : undefined;
}
