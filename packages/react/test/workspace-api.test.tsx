// @vitest-environment jsdom

import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { panelId, type CommittedTransaction, type WorkspaceSnapshot } from "@panefold/model";
import {
  createWorkspace,
  type RuntimeDispatchReceipt,
  type WorkspaceOptions,
  type WorkspaceRuntime,
} from "@panefold/runtime";

// Exercise the public bundles, including the generic adapter's shared context.
import {
  Workspace,
  WorkspaceProvider,
  WorkspaceSurface,
  useWorkspaceActions,
  useWorkspacePlans,
  useWorkspaceRuntime,
  useWorkspaceSelector,
  useWorkspaceSnapshot,
  useWorkspaceTransactions,
  type WorkspacePanelRegistry,
  type WorkspaceProps,
  type WorkspaceSurfaceProps,
} from "@panefold/react";
import { useWorkspaceRuntime as useAdapterRuntime } from "@panefold/react/adapter";
import { modelBounds, modelFixture } from "./model-fixture";

const panels: WorkspacePanelRegistry = {
  "test.panel": { render: ({ panel }) => <p>{`Content ${panel.title}`}</p> },
};

afterEach(cleanup);

describe("public workspace API", () => {
  it("composes controls, a wrapped surface and an observer around one declarative workspace", () => {
    let workspace: WorkspaceRuntime | undefined;
    function Toolbar() {
      workspace = useWorkspaceRuntime();
      const actions = useWorkspaceActions();
      const selected = useWorkspaceSelector(
        (snapshot) => snapshot.groups.byId.editor?.selectedPanelId,
      );
      const transactions = useWorkspaceTransactions();
      expectTypeOf(transactions).toEqualTypeOf<readonly CommittedTransaction[]>();
      expectTypeOf(useWorkspaceSnapshot()).toEqualTypeOf<WorkspaceSnapshot>();
      return (
        <div>
          <button onClick={() => actions.selectPanel("b")}>Select B from toolbar</button>
          <output aria-label="Toolbar selection">{selected}</output>
          <output aria-label="Transaction count">{transactions.length}</output>
        </div>
      );
    }
    function Inspector() {
      const selected = useWorkspaceSelector(
        (snapshot) => snapshot.groups.byId.editor?.selectedPanelId,
      );
      expect(useWorkspaceRuntime()).toBe(workspace);
      return <aside aria-label="Inspector">{selected}</aside>;
    }
    const view = render(
      <Workspace
        initial={{
          panels: [
            { id: "a", type: "test.panel", title: "A" },
            { id: "b", type: "test.panel", title: "B" },
          ],
          layout: { id: "editor", panels: ["a", "b"] },
        }}
      >
        <Toolbar />
        <main>
          <WorkspaceSurface
            panels={panels}
            layoutBounds={modelBounds}
            motion="off"
            workspaceLabel="My workspace"
          />
        </main>
        <Inspector />
      </Workspace>,
    );
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Toolbar selection").textContent).toBe("a");
    fireEvent.click(screen.getByRole("button", { name: "Select B from toolbar" }));
    expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Toolbar selection").textContent).toBe("b");
    expect(screen.getByLabelText("Inspector").textContent).toBe("b");
    expect(screen.getByLabelText("Transaction count").textContent).toBe("1");
    const toolbar = screen.getByRole("button", { name: "Select B from toolbar" });
    expect(toolbar.compareDocumentPosition(screen.getByRole("tab", { name: "B" })) & 4).toBe(4);
    expect(
      screen
        .getByRole("tab", { name: "B" })
        .compareDocumentPosition(screen.getByLabelText("Inspector")) & 4,
    ).toBe(4);
    if (!workspace) throw new Error("Workspace did not expose its runtime");
    const owned = workspace;
    view.unmount();
    expect(() => owned.dispatch({ type: "select-panel", panelId: panelId("a") })).toThrow(
      /disposed/i,
    );
  });

  it("owns state without inserting wrapper DOM or an implicit surface", () => {
    function Status() {
      const snapshot = useWorkspaceSnapshot();
      return <output>{`Revision ${snapshot.revision.toString()}`}</output>;
    }
    expectTypeOf<WorkspaceProps>().not.toHaveProperty("panels");
    expectTypeOf<WorkspaceProps>().not.toHaveProperty("layoutBounds");
    const view = render(
      <Workspace initial={{ initialSnapshot: modelFixture() }}>
        <Status />
      </Workspace>,
    );
    expect(view.container.innerHTML).toBe("<output>Revision 0</output>");
    expect(screen.queryByRole("tablist")).toBeNull();
    view.unmount();
  });

  it("updates presentation props without rebuilding the owned workspace", () => {
    const initialize = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    const ignored = vi.fn(() => ({ initialSnapshot: modelFixture(), historyLimit: 0 }));
    const observed: WorkspaceRuntime[] = [];
    function Toolbar() {
      const runtime = useWorkspaceRuntime();
      observed.push(runtime);
      return null;
    }
    function App({
      locked,
      initial,
    }: {
      readonly locked: boolean;
      readonly initial: () => WorkspaceOptions;
    }) {
      return (
        <Workspace initial={initial}>
          <Toolbar />
          <WorkspaceSurface
            panels={panels}
            layoutBounds={modelBounds}
            motion="off"
            splitResizeDisabled={locked}
          />
        </Workspace>
      );
    }
    const view = render(<App locked={false} initial={initialize} />);
    const first = observed.at(-1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("separator").getAttribute("aria-disabled")).not.toBe("true");
    view.rerender(<App locked={true} initial={ignored} />);
    expect(screen.getByRole("separator").getAttribute("aria-disabled")).toBe("true");
    expect(observed.every((runtime) => runtime === first)).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(ignored).not.toHaveBeenCalled();
    view.unmount();
  });

  it("shares an externally owned runtime across canonical and adapter entry points", () => {
    const workspace = createWorkspace({ initialSnapshot: modelFixture() });
    let observed: WorkspaceRuntime | undefined;
    function Toolbar() {
      const runtime = useWorkspaceRuntime();
      observed = runtime;
      const adapterRuntime = useAdapterRuntime<
        WorkspaceSnapshot,
        Parameters<WorkspaceRuntime["dispatch"]>[0],
        RuntimeDispatchReceipt
      >();
      expect(adapterRuntime).toBe(runtime);
      const actions = useWorkspaceActions();
      const plan = useWorkspacePlans();
      expect(actions).toBe(workspace.actions);
      expect(plan).toBe(workspace.plan);
      const snapshot = useWorkspaceSnapshot();
      return (
        <div>
          <output>{snapshot.revision.toString()}</output>
          <button
            onClick={() =>
              actions.batch([plan.selectPanel("b"), plan.resizeSplit("root", [700_000, 300_000])], {
                label: "Focus editor",
              })
            }
          >
            Focus editor
          </button>
          <button onClick={() => actions.undo()}>Undo composed action</button>
        </div>
      );
    }
    expectTypeOf<WorkspaceSurfaceProps>().not.toHaveProperty("bindings");
    expectTypeOf<WorkspaceSurfaceProps>().not.toHaveProperty("projector");
    expectTypeOf<WorkspaceSurfaceProps>().not.toHaveProperty("commands");
    try {
      const view = render(
        <WorkspaceProvider workspace={workspace}>
          <Toolbar />
          <WorkspaceSurface panels={panels} layoutBounds={modelBounds} motion="off" />
        </WorkspaceProvider>,
      );
      expect(observed).toBe(workspace);
      fireEvent.click(screen.getByRole("button", { name: "Focus editor" }));
      expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
      expect(workspace.getSnapshot().revision).toBe(1n);
      expect(workspace.getTransactions()).toHaveLength(1);
      expect(workspace.getTransactions()[0]?.command.type).toBe("batch");
      expect(workspace.getSnapshot().nodes.byId.root).toMatchObject({
        weights: [700_000, 300_000],
      });
      fireEvent.click(screen.getByRole("button", { name: "Undo composed action" }));
      expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
      expect(workspace.getSnapshot().nodes.byId.root).toMatchObject({
        weights: [100_000, 900_000],
      });
      view.unmount();
      expect(workspace.actions.selectPanel("a").status).toBe("committed");
    } finally {
      workspace.dispose();
    }
  });

  it("owns its runtime across Strict Mode replay and shows the fallback during SSR", () => {
    const initialize = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    let current: WorkspaceRuntime | undefined;
    function Toolbar() {
      current = useWorkspaceRuntime();
      return null;
    }
    function App() {
      return (
        <Workspace initial={initialize} fallback={<p>Starting workspace</p>}>
          <Toolbar />
          <WorkspaceSurface panels={panels} layoutBounds={modelBounds} motion="off" />
        </Workspace>
      );
    }
    expect(renderToString(<App />)).toContain("Starting workspace");
    expect(initialize).not.toHaveBeenCalled();
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(initialize).toHaveBeenCalledTimes(2);
    if (!current) throw new Error("Workspace did not expose its runtime");
    const owned = current;
    act(() => {
      owned.dispatch({ type: "select-panel", panelId: panelId("b") });
    });
    expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
    view.unmount();
    expect(() => owned.dispatch({ type: "select-panel", panelId: panelId("a") })).toThrow(
      /disposed/i,
    );
  });
});
