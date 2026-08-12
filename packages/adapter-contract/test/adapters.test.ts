// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  WorkspaceAdapterDisposedError,
  WorkspaceSnapshotEvent,
  certifyWorkspaceAdapter,
  connectWorkspaceElement,
  createAngularWorkspaceAdapter,
  createSvelteWorkspaceAdapter,
  createVueWorkspaceAdapter,
  createWorkspaceAdapter,
  type WorkspaceAdapterPort,
  type WorkspaceAdapterSource,
} from "../src";

interface Snapshot {
  readonly revision: number;
  readonly selected: string;
}

interface Command {
  readonly selected: string;
}

class FixtureRuntime implements WorkspaceAdapterSource<Snapshot, Command, Snapshot> {
  readonly #listeners = new Set<() => void>();
  #snapshot: Snapshot = { revision: 0, selected: "alpha" };

  public readonly getSnapshot = () => this.#snapshot;

  public readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  public readonly dispatch = (command: Command) => {
    this.#snapshot = {
      revision: this.#snapshot.revision + 1,
      selected: command.selected,
    };
    for (const listener of [...this.#listeners]) listener();
    return this.#snapshot;
  };
}

type FixturePort = WorkspaceAdapterPort<Snapshot, Command, Snapshot, unknown>;

describe("shared adapter certification", () => {
  const factories: ReadonlyArray<{
    readonly name: string;
    readonly create: (runtime: FixtureRuntime) => {
      readonly port: FixturePort;
      readonly dispose: () => void;
    };
  }> = [
    {
      name: "framework-neutral",
      create: (runtime) => {
        const port = createWorkspaceAdapter(runtime) as FixturePort;
        return { port, dispose: port.dispose };
      },
    },
    {
      name: "Vue",
      create: (runtime) => {
        const adapter = createVueWorkspaceAdapter(runtime);
        return { port: adapter.port as FixturePort, dispose: adapter.dispose };
      },
    },
    {
      name: "Svelte",
      create: (runtime) => {
        const adapter = createSvelteWorkspaceAdapter(runtime);
        return { port: adapter.port as FixturePort, dispose: adapter.dispose };
      },
    },
    {
      name: "Angular",
      create: (runtime) => {
        const adapter = createAngularWorkspaceAdapter(runtime);
        return { port: adapter.port as FixturePort, dispose: adapter.destroy };
      },
    },
    {
      name: "Web Components",
      create: (runtime) => {
        const element = document.createElement("panefold-workspace");
        const adapter = connectWorkspaceElement(element, runtime);
        return { port: adapter.port as FixturePort, dispose: adapter.disconnect };
      },
    },
  ];

  for (const factory of factories) {
    it(`${factory.name} passes the common immutable-store contract`, () => {
      const runtime = new FixtureRuntime();
      const adapter = factory.create(runtime);
      let sequence = 0;
      const report = certifyWorkspaceAdapter(adapter.port, () => {
        sequence += 1;
        adapter.port.dispatch({ selected: `panel-${sequence}` });
      });
      expect(report).toEqual({
        currentSnapshotDelivered: true,
        updateDelivered: true,
        unsubscribeStoppedDelivery: true,
        passed: true,
      });
      adapter.dispose();
    });
  }
});

describe("framework facades", () => {
  it("isolates observer failures from later listeners and the source runtime", () => {
    const runtime = new FixtureRuntime();
    const errors: Array<{ readonly error: unknown; readonly phase: string }> = [];
    const adapter = createWorkspaceAdapter(runtime, {
      onObserverError: (error, context) => {
        errors.push({ error, phase: context.phase });
      },
    });
    const observed: string[] = [];

    expect(() =>
      adapter.subscribe(
        () => {
          throw new Error("emit failure");
        },
        { emitCurrent: true },
      ),
    ).not.toThrow();
    adapter.subscribe(() => {
      throw new Error("update failure");
    });
    adapter.subscribe((snapshot) => {
      observed.push(snapshot.selected);
    });

    expect(() => adapter.dispatch({ selected: "safe-later-observer" })).not.toThrow();
    expect(observed).toEqual(["safe-later-observer"]);
    expect(errors.map((item) => item.phase)).toEqual(["emit-current", "update", "update"]);
    adapter.dispose();
  });

  it("contains failures from the optional observer-error reporter", () => {
    const runtime = new FixtureRuntime();
    const adapter = createWorkspaceAdapter(runtime, {
      onObserverError: () => {
        throw new Error("reporter failure");
      },
    });
    adapter.subscribe(() => {
      throw new Error("observer failure");
    });
    expect(() => adapter.dispatch({ selected: "still-contained" })).not.toThrow();
    adapter.dispose();
  });

  it("updates Vue refs, Svelte stores, and Angular signals without framework dependencies", () => {
    const vueRuntime = new FixtureRuntime();
    const vue = createVueWorkspaceAdapter(vueRuntime, (value) => ({ value }));
    vue.dispatch({ selected: "vue" });
    expect(vue.snapshot.value.selected).toBe("vue");

    const svelteRuntime = new FixtureRuntime();
    const svelte = createSvelteWorkspaceAdapter(svelteRuntime);
    const svelteValues: string[] = [];
    const unsubscribe = svelte.subscribe((snapshot) => {
      svelteValues.push(snapshot.selected);
    });
    svelte.dispatch({ selected: "svelte" });
    expect(svelteValues).toEqual(["alpha", "svelte"]);
    unsubscribe();

    const angularRuntime = new FixtureRuntime();
    const angular = createAngularWorkspaceAdapter(angularRuntime);
    angular.dispatch({ selected: "angular" });
    expect(angular.snapshot().selected).toBe("angular");

    vue.dispose();
    svelte.dispose();
    angular.destroy();
  });

  it("projects revisions and snapshot events onto a custom element", () => {
    const runtime = new FixtureRuntime();
    const element = document.createElement("panefold-workspace");
    const snapshots: Snapshot[] = [];
    element.addEventListener("panefold-snapshot", (event) => {
      if (event instanceof WorkspaceSnapshotEvent) snapshots.push(event.snapshot as Snapshot);
    });
    const adapter = connectWorkspaceElement(element, runtime);
    expect(element.getAttribute("data-panefold-state")).toBe("connected");
    expect(element.getAttribute("data-panefold-revision")).toBe("0");

    adapter.dispatch({ selected: "element" });
    expect(element.getAttribute("data-panefold-revision")).toBe("1");
    expect(snapshots.map((snapshot) => snapshot.selected)).toEqual(["element"]);

    adapter.disconnect();
    expect(element.getAttribute("data-panefold-state")).toBe("disconnected");
    expect(element.hasAttribute("data-panefold-revision")).toBe(false);
    expect(() => adapter.port.getSnapshot()).toThrow(WorkspaceAdapterDisposedError);
  });

  it("only emits selector subscriptions when their value changes", () => {
    const runtime = new FixtureRuntime();
    const adapter = createWorkspaceAdapter(runtime);
    const revisions: number[] = [];
    const selected = adapter.select((snapshot) => snapshot.selected);
    const unsubscribe = selected.subscribe(
      (value) => {
        revisions.push(value.length);
      },
      { emitCurrent: true },
    );

    adapter.dispatch({ selected: "alpha" });
    adapter.dispatch({ selected: "beta" });
    expect(revisions).toEqual([5, 4]);
    unsubscribe();
    adapter.dispose();
  });
});
