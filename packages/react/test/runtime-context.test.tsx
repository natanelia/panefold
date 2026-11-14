// @vitest-environment jsdom

import { StrictMode, Suspense, startTransition, useState } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { panelId } from "@panefold/model";
import { createWorkspaceRuntime } from "@panefold/runtime";

import {
  WorkspaceRuntimeProvider,
  useWorkspaceProjection,
  useWorkspaceSnapshot,
  useWorkspaceTransactions,
} from "../src/runtime-context";
import type { WorkspaceRuntimeLike } from "../src/types";
import { modelFixture } from "./model-fixture";

interface Snapshot {
  readonly revision: number;
  readonly titles: Readonly<Record<string, string>>;
}

function createSource(titles: Snapshot["titles"] = { map: "Map", inspector: "Inspector" }) {
  let snapshot: Snapshot = { revision: 0, titles };
  const listeners = new Set<() => void>();
  const runtime: WorkspaceRuntimeLike<Snapshot, never, undefined> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    canUndo: () => false,
    canRedo: () => false,
  };
  return {
    runtime,
    listenerCount: () => listeners.size,
    publish: (nextTitles = snapshot.titles) => {
      snapshot = { revision: snapshot.revision + 1, titles: nextTitles };
      for (const listener of listeners) listener();
    },
  };
}

afterEach(cleanup);

describe("useWorkspaceProjection", () => {
  it("skips unrelated snapshots while full-snapshot consumers still receive every commit", () => {
    const source = createSource();
    let selectedRenders = 0;
    let snapshotRenders = 0;
    function SelectedTitle() {
      const title = useWorkspaceProjection((snapshot: Snapshot) => snapshot.titles.map);
      selectedRenders += 1;
      return <output aria-label="Selected title">{title}</output>;
    }
    function Revision() {
      const snapshot = useWorkspaceSnapshot<Snapshot, never, undefined>();
      snapshotRenders += 1;
      return <output aria-label="Revision">{snapshot.revision}</output>;
    }
    render(
      <WorkspaceRuntimeProvider runtime={source.runtime}>
        <SelectedTitle />
        <Revision />
      </WorkspaceRuntimeProvider>,
    );
    const initialSelectedRenders = selectedRenders;
    const initialSnapshotRenders = snapshotRenders;

    // Separate commits avoid batching the workload into one render.
    for (let update = 0; update < 100; update += 1) {
      act(() => source.publish());
    }
    expect(selectedRenders).toBe(initialSelectedRenders);
    expect(snapshotRenders - initialSnapshotRenders).toBe(100);
    expect(screen.getByLabelText("Revision").textContent).toBe("100");

    act(() => source.publish({ map: "Updated map", inspector: "Inspector" }));
    expect(selectedRenders).toBe(initialSelectedRenders + 1);
    expect(screen.getByLabelText("Selected title").textContent).toBe("Updated map");
  });

  it("keeps an object selection stable with a custom equality check", () => {
    const source = createSource();
    const selections: { readonly title: string | undefined }[] = [];
    function SelectedTitle({ count }: { readonly count: number }) {
      const selection = useWorkspaceProjection(
        (snapshot: Snapshot) => ({ title: snapshot.titles.map }),
        (previous, next) => previous.title === next.title,
      );
      selections.push(selection);
      return <output>{`${selection.title}:${count}`}</output>;
    }
    const view = render(
      <WorkspaceRuntimeProvider runtime={source.runtime}>
        <SelectedTitle count={0} />
      </WorkspaceRuntimeProvider>,
    );
    const initialSelection = selections[0];
    expect(selections).toHaveLength(1);

    act(() => source.publish({ map: "Map", inspector: "Changed elsewhere" }));
    expect(selections).toHaveLength(1);
    view.rerender(
      <WorkspaceRuntimeProvider runtime={source.runtime}>
        <SelectedTitle count={1} />
      </WorkspaceRuntimeProvider>,
    );
    // Inline selectors/equality functions may change on a parent render.
    expect(selections.at(-1)).toBe(initialSelection);
    expect(screen.getByText("Map:1")).toBeDefined();

    act(() => source.publish({ map: "Updated map" }));
    expect(selections.at(-1)).not.toBe(initialSelection);
    expect(screen.getByText("Updated map:1")).toBeDefined();
  });

  it("reads a new selector without waiting for another snapshot", () => {
    const source = createSource();
    function SelectedTitle({ panel }: { readonly panel: string }) {
      const title = useWorkspaceProjection((snapshot: Snapshot) => snapshot.titles[panel]);
      return <output>{title}</output>;
    }
    const view = render(
      <WorkspaceRuntimeProvider runtime={source.runtime}>
        <SelectedTitle panel="map" />
      </WorkspaceRuntimeProvider>,
    );
    expect(screen.getByText("Map")).toBeDefined();
    view.rerender(
      <WorkspaceRuntimeProvider runtime={source.runtime}>
        <SelectedTitle panel="inspector" />
      </WorkspaceRuntimeProvider>,
    );
    expect(screen.getByText("Inspector")).toBeDefined();
    act(() => source.publish({ map: "Changed map", inspector: "Updated inspector" }));
    expect(screen.getByText("Updated inspector")).toBeDefined();
  });

  it("switches runtime subscriptions and cleans up under Strict Mode", () => {
    const first = createSource({ map: "First map" });
    const second = createSource({ map: "Second map" });
    function SelectedTitle() {
      const title = useWorkspaceProjection((snapshot: Snapshot) => snapshot.titles.map);
      return <output>{title}</output>;
    }
    function App({ runtime }: { readonly runtime: typeof first.runtime }) {
      return (
        <StrictMode>
          <WorkspaceRuntimeProvider runtime={runtime}>
            <SelectedTitle />
          </WorkspaceRuntimeProvider>
        </StrictMode>
      );
    }
    const view = render(<App runtime={first.runtime} />);
    expect(first.listenerCount()).toBe(1);
    expect(screen.getByText("First map")).toBeDefined();
    view.rerender(<App runtime={second.runtime} />);
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
    expect(screen.getByText("Second map")).toBeDefined();
    act(() => first.publish({ map: "Old source changed" }));
    expect(screen.getByText("Second map")).toBeDefined();
    act(() => second.publish({ map: "Updated second map" }));
    expect(screen.getByText("Updated second map")).toBeDefined();
    view.unmount();
    expect(second.listenerCount()).toBe(0);
  });

  it("reads a server snapshot without subscribing", () => {
    const source = createSource();
    function SelectedTitle() {
      const title = useWorkspaceProjection((snapshot: Snapshot) => snapshot.titles.map);
      return <output>{title}</output>;
    }
    expect(
      renderToString(
        <WorkspaceRuntimeProvider runtime={source.runtime}>
          <SelectedTitle />
        </WorkspaceRuntimeProvider>,
      ),
    ).toContain("<output>Map</output>");
    expect(source.listenerCount()).toBe(0);
  });

  it("keeps the committed selector current while a different selection is suspended", async () => {
    const source = createSource();
    let release: (() => void) | undefined;
    let suspended = true;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    function SelectedTitle({ panel }: { readonly panel: string }) {
      const title = useWorkspaceProjection((snapshot: Snapshot) => snapshot.titles[panel]);
      if (panel === "inspector" && suspended) throw pending;
      return <output>{title}</output>;
    }
    function App() {
      const [panel, setPanel] = useState("map");
      return (
        <WorkspaceRuntimeProvider runtime={source.runtime}>
          <button onClick={() => startTransition(() => setPanel("inspector"))}>Inspect</button>
          <Suspense fallback={<span>Loading</span>}>
            <SelectedTitle panel={panel} />
          </Suspense>
        </WorkspaceRuntimeProvider>
      );
    }
    render(<App />);
    fireEvent.click(screen.getByText("Inspect"));
    expect(screen.getByText("Map")).toBeDefined();
    act(() => source.publish({ map: "Current map", inspector: "Current inspector" }));
    expect(screen.getByText("Current map")).toBeDefined();
    await act(async () => {
      suspended = false;
      release?.();
      await pending;
    });
    expect(screen.getByText("Current inspector")).toBeDefined();
  });
});

describe("useWorkspaceTransactions", () => {
  it("subscribes to a real runtime with its method receiver and observes bounded log replacement", () => {
    const runtime = createWorkspaceRuntime({
      initialSnapshot: modelFixture(),
      transactionLimit: 1,
    });
    let observed: readonly unknown[] = [];
    let renders = 0;
    function Transactions() {
      observed = useWorkspaceTransactions();
      renders += 1;
      return <output>{observed.length}</output>;
    }
    try {
      const view = render(
        <StrictMode>
          <WorkspaceRuntimeProvider runtime={runtime}>
            <Transactions />
          </WorkspaceRuntimeProvider>
        </StrictMode>,
      );
      expect(screen.getByText("0")).toBeDefined();
      act(() => {
        runtime.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(observed).toEqual(runtime.getTransactions());
      expect(screen.getByText("1")).toBeDefined();
      const firstTransaction = observed[0];
      const afterFirst = renders;
      act(() => {
        runtime.dispatch({ type: "select-panel", panelId: panelId("a") });
      });
      expect(observed).toEqual(runtime.getTransactions());
      expect(observed[0]).not.toBe(firstTransaction);
      expect(renders).toBeGreaterThan(afterFirst);
      view.unmount();
      const afterUnmount = renders;
      act(() => {
        runtime.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(renders).toBe(afterUnmount);
    } finally {
      runtime.dispose();
    }
  });

  it("reads the replacement runtime's current log immediately and unsubscribes the old runtime", () => {
    const first = createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const second = createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    second.dispatch({ type: "select-panel", panelId: panelId("b") });
    second.dispatch({ type: "select-panel", panelId: panelId("a") });
    let observed: readonly unknown[] = [];
    let renders = 0;
    function Transactions() {
      observed = useWorkspaceTransactions();
      renders += 1;
      return <output>{observed.length}</output>;
    }
    try {
      const view = render(
        <WorkspaceRuntimeProvider runtime={first}>
          <Transactions />
        </WorkspaceRuntimeProvider>,
      );
      expect(screen.getByText("0")).toBeDefined();
      view.rerender(
        <WorkspaceRuntimeProvider runtime={second}>
          <Transactions />
        </WorkspaceRuntimeProvider>,
      );
      expect(screen.getByText("2")).toBeDefined();
      expect(observed).toEqual(second.getTransactions());
      const afterSwitch = renders;
      act(() => {
        first.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(renders).toBe(afterSwitch);
      act(() => {
        second.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(screen.getByText("3")).toBeDefined();
      view.unmount();
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("handles transaction-only updates and stable empty logs for generic runtimes", () => {
    const source = createSource();
    const records: string[] = [];
    const listeners = new Set<() => void>();
    const runtime = {
      ...source.runtime,
      getTransactions: () => [...records],
      subscribeTransactions: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    function Transactions() {
      const transactions = useWorkspaceTransactions();
      return <output>{transactions.join(",") || "empty"}</output>;
    }
    const view = render(
      <WorkspaceRuntimeProvider runtime={runtime}>
        <Transactions />
      </WorkspaceRuntimeProvider>,
    );
    expect(listeners.size).toBe(1);
    expect(source.listenerCount()).toBe(0);
    act(() => {
      records.push("committed");
      for (const listener of listeners) listener();
    });
    expect(screen.getByText("committed")).toBeDefined();
    view.rerender(
      <WorkspaceRuntimeProvider runtime={source.runtime}>
        <Transactions />
      </WorkspaceRuntimeProvider>,
    );
    expect(listeners.size).toBe(0);
    expect(source.listenerCount()).toBe(1);
    act(() => source.publish());
    expect(screen.getByText("empty")).toBeDefined();
    view.unmount();
    expect(source.listenerCount()).toBe(0);
  });
});
