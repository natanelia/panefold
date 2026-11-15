// @vitest-environment jsdom

import { StrictMode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { panelId, type WorkspaceSnapshot } from "@panefold/model";
import * as runtimeModule from "@panefold/runtime";
import type { WorkspaceActions, WorkspacePlans, WorkspaceRuntime } from "@panefold/runtime";

import { WorkspaceRuntimeProvider } from "../src/runtime-context";
import {
  createModelWorkspaceBindings,
  ModelWorkspaceProvider,
  useModelWorkspaceActions,
  useModelWorkspacePlans,
  useModelWorkspaceRuntime,
  useModelWorkspaceSelector,
  useModelWorkspaceSession,
  useModelWorkspaceSnapshot,
  type ModelWorkspaceBindings,
  type ModelWorkspaceSession,
} from "../src/model";
import { modelFixture } from "./model-fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("model workspace hooks", () => {
  it("exposes the exact typed runtime, actions and snapshot from its model provider", () => {
    const runtime = runtimeModule.createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const bindings = createModelWorkspaceBindings(runtime);
    let observedActions: WorkspaceActions | undefined;
    function ReadWorkspace() {
      const currentRuntime = useModelWorkspaceRuntime();
      const actions = useModelWorkspaceActions();
      const plan = useModelWorkspacePlans();
      const snapshot = useModelWorkspaceSnapshot();
      expectTypeOf(currentRuntime).toEqualTypeOf<WorkspaceRuntime>();
      expectTypeOf(actions).toEqualTypeOf<WorkspaceActions>();
      expectTypeOf(plan).toEqualTypeOf<WorkspacePlans>();
      expectTypeOf(snapshot).toEqualTypeOf<WorkspaceSnapshot>();
      expect(currentRuntime).toBe(runtime);
      expect(actions).toBe(bindings.actions);
      expect(plan).toBe(bindings.plan);
      expect(snapshot).toBe(runtime.getSnapshot());
      observedActions = actions;
      return <output>{snapshot.revision.toString()}</output>;
    }
    try {
      const view = render(
        <ModelWorkspaceProvider bindings={bindings}>
          <ReadWorkspace />
        </ModelWorkspaceProvider>,
      );
      expect(screen.getByText("0")).toBeDefined();
      act(() => {
        runtime.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(screen.getByText("1")).toBeDefined();
      expect(observedActions).toBe(bindings.actions);
      view.unmount();
      // The provider borrows this runtime and must not dispose it.
      expect(runtime.dispatch({ type: "select-panel", panelId: panelId("a") }).status).toBe(
        "committed",
      );
    } finally {
      runtime.dispose();
    }
  });

  it("infers model selectors and skips unrelated commits with object equality", () => {
    const runtime = runtimeModule.createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const bindings = createModelWorkspaceBindings(runtime);
    const selections: { readonly selected: string | undefined }[] = [];
    function SelectedPanel() {
      const selection = useModelWorkspaceSelector(
        (snapshot) => {
          expectTypeOf(snapshot).toEqualTypeOf<WorkspaceSnapshot>();
          return { selected: snapshot.groups.byId.left?.selectedPanelId };
        },
        (previous, next) => previous.selected === next.selected,
      );
      selections.push(selection);
      return <output>{selection.selected}</output>;
    }
    try {
      render(
        <ModelWorkspaceProvider bindings={bindings}>
          <SelectedPanel />
        </ModelWorkspaceProvider>,
      );
      const initialSelection = selections[0];
      const initialCount = selections.length;
      act(() => {
        runtime.dispatch({ type: "select-panel", panelId: panelId("c"), activate: true });
      });
      expect(selections).toHaveLength(initialCount);
      act(() => {
        runtime.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(selections).toHaveLength(initialCount + 1);
      expect(selections.at(-1)).not.toBe(initialSelection);
      expect(screen.getByText("b")).toBeDefined();
    } finally {
      cleanup();
      runtime.dispose();
    }
  });

  it("switches typed runtime, actions and subscriptions with the provider", () => {
    const first = runtimeModule.createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const second = runtimeModule.createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const firstBindings = createModelWorkspaceBindings(first);
    const secondBindings = createModelWorkspaceBindings(second);
    second.dispatch({ type: "select-panel", panelId: panelId("b") });
    const observed: WorkspaceRuntime[] = [];
    let renders = 0;
    function ReadWorkspace() {
      const runtime = useModelWorkspaceRuntime();
      const actions = useModelWorkspaceActions();
      const selected = useModelWorkspaceSelector(
        (snapshot) => snapshot.groups.byId.left?.selectedPanelId,
      );
      expect(actions).toBe(runtime === first ? firstBindings.actions : secondBindings.actions);
      observed.push(runtime);
      renders += 1;
      return <output>{selected}</output>;
    }
    function App({ bindings }: { readonly bindings: ModelWorkspaceBindings }) {
      return (
        <StrictMode>
          <ModelWorkspaceProvider bindings={bindings}>
            <ReadWorkspace />
          </ModelWorkspaceProvider>
        </StrictMode>
      );
    }
    try {
      const view = render(<App bindings={firstBindings} />);
      expect(screen.getByText("a")).toBeDefined();
      view.rerender(<App bindings={secondBindings} />);
      expect(screen.getByText("b")).toBeDefined();
      expect(observed.at(-1)).toBe(second);
      const afterSwitch = renders;
      act(() => {
        first.dispatch({ type: "select-panel", panelId: panelId("b") });
      });
      expect(renders).toBe(afterSwitch);
      act(() => {
        second.dispatch({ type: "select-panel", panelId: panelId("a") });
      });
      expect(screen.getByText("a")).toBeDefined();
      view.unmount();
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("rejects missing model bindings even inside an unrelated generic provider", () => {
    function ReadWorkspace() {
      useModelWorkspaceRuntime();
      return null;
    }
    const unrelated = {
      getSnapshot: () => ({ unrelated: true }),
      subscribe: () => () => {},
      dispatch: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
      canUndo: () => false,
      canRedo: () => false,
    };
    expect(() =>
      renderToString(
        <WorkspaceRuntimeProvider runtime={unrelated}>
          <ReadWorkspace />
        </WorkspaceRuntimeProvider>,
      ),
    ).toThrow(/ModelWorkspaceProvider or ModelWorkspaceSurface/);
  });

  it("reads a typed server snapshot without subscribing", () => {
    const runtime = runtimeModule.createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const subscribe = vi.spyOn(runtime, "subscribe");
    const bindings = createModelWorkspaceBindings(runtime);
    function ReadWorkspace() {
      const selected = useModelWorkspaceSelector(
        (snapshot) => snapshot.groups.byId.left?.selectedPanelId,
      );
      return <output>{selected}</output>;
    }
    try {
      expect(
        renderToString(
          <ModelWorkspaceProvider bindings={bindings}>
            <ReadWorkspace />
          </ModelWorkspaceProvider>,
        ),
      ).toContain("<output>a</output>");
      expect(subscribe).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });
});

describe("useModelWorkspaceSession", () => {
  it("creates and disposes each effect-owned runtime during Strict Mode replay", () => {
    const created: WorkspaceRuntime[] = [];
    const createRuntime = runtimeModule.createWorkspace;
    vi.spyOn(runtimeModule, "createWorkspace").mockImplementation((options) => {
      const runtime = createRuntime(options);
      created.push(runtime);
      return runtime;
    });
    const setup = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    let current: ModelWorkspaceSession | undefined;
    function App() {
      const session = useModelWorkspaceSession(setup);
      current = session;
      return <output>{session ? "ready" : "starting"}</output>;
    }
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(setup).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
    const first = created[0];
    const second = created[1];
    if (!first || !second || !current) throw new Error("Strict Mode did not create both sessions");
    expect(() => first.dispatch({ type: "select-panel", panelId: panelId("b") })).toThrow(
      /disposed/i,
    );
    expect(current.runtime).toBe(second);
    expect(screen.getByText("ready")).toBeDefined();
    expect(second.dispatch({ type: "select-panel", panelId: panelId("b") }).status).toBe(
      "committed",
    );
    view.unmount();
    expect(() => second.dispatch({ type: "select-panel", panelId: panelId("a") })).toThrow(
      /disposed/i,
    );
    expect(() => current?.dispose()).not.toThrow();
  });

  it("keeps the initial setup across inline option changes and replaces it only on remount", () => {
    const sessions: ModelWorkspaceSession[] = [];
    function App({ historyLimit }: { readonly historyLimit: number }) {
      const session = useModelWorkspaceSession({ initialSnapshot: modelFixture(), historyLimit });
      if (session !== undefined) sessions.push(session);
      return <output>{session ? "ready" : "starting"}</output>;
    }
    const view = render(<App historyLimit={0} />);
    const initial = sessions.at(-1);
    if (!initial) throw new Error("Session did not initialize");
    view.rerender(<App historyLimit={50} />);
    expect(sessions.every((session) => session === initial)).toBe(true);
    initial.runtime.dispatch({ type: "select-panel", panelId: panelId("b") });
    expect(initial.runtime.canUndo()).toBe(false);
    view.rerender(<App key="new-workspace" historyLimit={50} />);
    const replacement = sessions.at(-1);
    if (!replacement) throw new Error("Replacement session did not initialize");
    expect(replacement).not.toBe(initial);
    expect(() => initial.runtime.dispatch({ type: "select-panel", panelId: panelId("a") })).toThrow(
      /disposed/i,
    );
    replacement.runtime.dispatch({ type: "select-panel", panelId: panelId("b") });
    expect(replacement.runtime.canUndo()).toBe(true);
    view.unmount();
  });

  it("does not invoke setup during server rendering", () => {
    const setup = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    function App() {
      const session = useModelWorkspaceSession(setup);
      return <output>{session ? "ready" : "starting"}</output>;
    }
    expect(renderToString(<App />)).toContain("<output>starting</output>");
    expect(setup).not.toHaveBeenCalled();
  });

  it("does not invoke setup for an abandoned suspended render", () => {
    const setup = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    const pending = new Promise<never>(() => {});
    function SuspendedWorkspace(): never {
      useModelWorkspaceSession(setup);
      throw pending;
    }
    const view = render(
      <Suspense fallback={<span>Waiting</span>}>
        <SuspendedWorkspace />
      </Suspense>,
    );
    expect(screen.getByText("Waiting")).toBeDefined();
    view.unmount();
    expect(setup).not.toHaveBeenCalled();
  });
});
