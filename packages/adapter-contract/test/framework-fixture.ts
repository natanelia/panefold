import type { WorkspaceAdapterSource } from "../src";

export interface FrameworkFixtureSnapshot {
  readonly revision: number;
  readonly selected: string;
}

export interface FrameworkFixtureCommand {
  readonly selected: string;
}

export class FrameworkFixtureRuntime implements WorkspaceAdapterSource<
  FrameworkFixtureSnapshot,
  FrameworkFixtureCommand,
  FrameworkFixtureSnapshot
> {
  readonly #listeners = new Set<() => void>();
  #snapshot: FrameworkFixtureSnapshot = { revision: 0, selected: "alpha" };

  public get listenerCount() {
    return this.#listeners.size;
  }

  public readonly getSnapshot = () => this.#snapshot;

  public readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  public readonly dispatch = (command: FrameworkFixtureCommand) => {
    this.#snapshot = {
      revision: this.#snapshot.revision + 1,
      selected: command.selected,
    };
    for (const listener of [...this.#listeners]) listener();
    return this.#snapshot;
  };
}
