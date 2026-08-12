import {
  connectWorkspaceElement,
  type WebComponentWorkspaceAdapter,
  type WorkspaceAdapterDispatchOptions,
  type WorkspaceAdapterPort,
  type WorkspaceAdapterSource,
} from "@panefold/adapter-contract";

export class WorkspaceElementNotConnectedError extends Error {
  public constructor() {
    super("The Panefold workspace element is not connected to a runtime");
    this.name = "WorkspaceElementNotConnectedError";
  }
}

export interface PanefoldWorkspaceElement<
  TSnapshot,
  TCommand,
  TResult,
  TOptions,
> extends HTMLElement {
  workspaceSource: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions> | undefined;
  readonly workspacePort: WorkspaceAdapterPort<TSnapshot, TCommand, TResult, TOptions> | undefined;
  dispatchWorkspaceCommand(command: TCommand, options?: TOptions): TResult;
}

export interface PanefoldWorkspaceElementConstructor<TSnapshot, TCommand, TResult, TOptions> {
  new (): PanefoldWorkspaceElement<TSnapshot, TCommand, TResult, TOptions>;
}

/** Factory form keeps importing this package safe during server rendering. */
export function createPanefoldWorkspaceElementClass<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  HTMLElementBase: typeof HTMLElement,
): PanefoldWorkspaceElementConstructor<TSnapshot, TCommand, TResult, TOptions> {
  class PanefoldWorkspaceElementImpl extends HTMLElementBase {
    #source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions> | undefined;
    #adapter: WebComponentWorkspaceAdapter<TSnapshot, TCommand, TResult, TOptions> | undefined;

    public get workspaceSource() {
      return this.#source;
    }

    public set workspaceSource(
      source: WorkspaceAdapterSource<TSnapshot, TCommand, TResult, TOptions> | undefined,
    ) {
      if (Object.is(this.#source, source)) return;
      this.#disconnect();
      this.#source = source;
      if (this.isConnected) this.#connect();
    }

    public get workspacePort() {
      return this.#adapter?.port;
    }

    public connectedCallback() {
      this.#connect();
    }

    public disconnectedCallback() {
      this.#disconnect();
    }

    public dispatchWorkspaceCommand(command: TCommand, options?: TOptions) {
      const adapter = this.#adapter;
      if (adapter === undefined) throw new WorkspaceElementNotConnectedError();
      return options === undefined ? adapter.dispatch(command) : adapter.dispatch(command, options);
    }

    #connect() {
      if (this.#adapter !== undefined || this.#source === undefined) return;
      this.#adapter = connectWorkspaceElement(this, this.#source);
    }

    #disconnect() {
      this.#adapter?.disconnect();
      this.#adapter = undefined;
    }
  }

  return PanefoldWorkspaceElementImpl;
}

export function definePanefoldWorkspaceElement<
  TSnapshot,
  TCommand,
  TResult,
  TOptions = WorkspaceAdapterDispatchOptions,
>(
  options: {
    readonly name?: string;
    readonly registry?: CustomElementRegistry;
    readonly HTMLElementBase?: typeof HTMLElement;
  } = {},
): PanefoldWorkspaceElementConstructor<TSnapshot, TCommand, TResult, TOptions> {
  const name = options.name ?? "panefold-workspace";
  const registry =
    options.registry ?? (typeof customElements === "undefined" ? undefined : customElements);
  const HTMLElementBase =
    options.HTMLElementBase ?? (typeof HTMLElement === "undefined" ? undefined : HTMLElement);
  if (registry === undefined || HTMLElementBase === undefined) {
    throw new Error("A CustomElementRegistry and HTMLElement constructor are required");
  }
  const existing = registry.get(name);
  if (existing !== undefined) {
    return existing as PanefoldWorkspaceElementConstructor<TSnapshot, TCommand, TResult, TOptions>;
  }
  const constructor = createPanefoldWorkspaceElementClass<TSnapshot, TCommand, TResult, TOptions>(
    HTMLElementBase,
  );
  registry.define(name, constructor);
  return constructor;
}
