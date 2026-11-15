// @vitest-environment jsdom

import { Activity } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { panelId } from "@panefold/model";
import { createWorkspace, type WorkspaceRuntime } from "@panefold/runtime";
import {
  Workspace,
  WorkspaceProvider,
  WorkspaceSurface,
  useModelWorkspaceActions,
  useModelWorkspacePlans,
  useModelWorkspaceRuntime,
  useModelWorkspaceSnapshot,
  useModelWorkspaceTransactions,
} from "../src/model";
import type { WorkspacePanelRegistry } from "../src/types";
import { modelBounds, modelFixture } from "./model-fixture";

const panels: WorkspacePanelRegistry = {
  "test.panel": { render: ({ panel }) => <p>{`Content ${panel.title}`}</p> },
};

afterEach(cleanup);

function Controls() {
  const actions = useModelWorkspaceActions();
  const plan = useModelWorkspacePlans();
  const snapshot = useModelWorkspaceSnapshot();
  const transactions = useModelWorkspaceTransactions();
  return (
    <div>
      <button
        onClick={() =>
          actions.batch([plan.selectPanel("b"), plan.resizeSplit("root", [700_000, 300_000])])
        }
      >
        Arrange editor
      </button>
      <button onClick={() => actions.undo()}>Undo arrangement</button>
      <output aria-label="Selected panel">{snapshot.groups.byId.left?.selectedPanelId}</output>
      <output aria-label="Transaction count">{transactions.length}</output>
    </div>
  );
}

describe("workspace ownership with React Activity", () => {
  it("preserves layout and history when the owner stays outside the hidden Activity", () => {
    const initialize = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    let observed: WorkspaceRuntime | undefined;
    function ObserveOwner() {
      observed = useModelWorkspaceRuntime();
      return null;
    }
    function App({ visible }: { readonly visible: boolean }) {
      return (
        <Workspace initial={initialize}>
          <ObserveOwner />
          <Activity mode={visible ? "visible" : "hidden"}>
            <Controls />
            <WorkspaceSurface panels={panels} layoutBounds={modelBounds} motion="off" />
          </Activity>
        </Workspace>
      );
    }
    const view = render(<App visible />);
    if (!observed) throw new Error("Workspace did not initialize");
    const workspace = observed;
    fireEvent.click(screen.getByRole("button", { name: "Arrange editor" }));
    const arranged = workspace.getSnapshot();
    expect(arranged.nodes.byId.root).toMatchObject({ weights: [700_000, 300_000] });
    expect(workspace.canUndo()).toBe(true);
    view.rerender(<App visible={false} />);
    expect(workspace.getSnapshot()).toBe(arranged);
    expect(screen.queryByRole("tab")).toBeNull();
    view.rerender(<App visible />);
    expect(observed).toBe(workspace);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(workspace.getSnapshot()).toBe(arranged);
    expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Transaction count").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Undo arrangement" }));
    expect(workspace.getSnapshot().nodes.byId.root).toMatchObject({ weights: [100_000, 900_000] });
    expect(screen.getByLabelText("Selected panel").textContent).toBe("a");
    view.unmount();
    expect(() => workspace.dispatch({ type: "select-panel", panelId: panelId("b") })).toThrow(
      /disposed/i,
    );
  });

  it("reconnects a provider inside Activity without disposing its externally owned workspace", () => {
    const workspace = createWorkspace({ initialSnapshot: modelFixture() });
    function App({ visible }: { readonly visible: boolean }) {
      return (
        <Activity mode={visible ? "visible" : "hidden"}>
          <WorkspaceProvider workspace={workspace}>
            <Controls />
            <WorkspaceSurface panels={panels} layoutBounds={modelBounds} motion="off" />
          </WorkspaceProvider>
        </Activity>
      );
    }
    try {
      const view = render(<App visible />);
      view.rerender(<App visible={false} />);
      act(() => {
        expect(workspace.actions.selectPanel("b").status).toBe("committed");
      });
      view.rerender(<App visible />);
      expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByLabelText("Selected panel").textContent).toBe("b");
      expect(screen.getByLabelText("Transaction count").textContent).toBe("1");
      expect(workspace.canUndo()).toBe(true);
      view.unmount();
      expect(workspace.actions.selectPanel("a").status).toBe("committed");
    } finally {
      workspace.dispose();
    }
  });

  it("recreates an owner inside Activity from its initial setup with fresh history", () => {
    const initialize = vi.fn(() => ({ initialSnapshot: modelFixture() }));
    let observed: WorkspaceRuntime | undefined;
    function ObserveOwner() {
      observed = useModelWorkspaceRuntime();
      return null;
    }
    function App({ visible }: { readonly visible: boolean }) {
      return (
        <Activity mode={visible ? "visible" : "hidden"}>
          <Workspace initial={initialize}>
            <ObserveOwner />
            <Controls />
            <WorkspaceSurface panels={panels} layoutBounds={modelBounds} motion="off" />
          </Workspace>
        </Activity>
      );
    }
    const view = render(<App visible />);
    if (!observed) throw new Error("Workspace did not initialize");
    const first = observed;
    act(() => {
      first.dispatch({ type: "select-panel", panelId: panelId("b") });
    });
    expect(first.canUndo()).toBe(true);
    view.rerender(<App visible={false} />);
    expect(() => first.dispatch({ type: "select-panel", panelId: panelId("a") })).toThrow(
      /disposed/i,
    );
    view.rerender(<App visible />);
    const replacement = observed;
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(replacement).not.toBe(first);
    expect(replacement.getSnapshot().groups.byId.left?.selectedPanelId).toBe("a");
    expect(replacement.getSnapshot().revision).toBe(0n);
    expect(replacement.canUndo()).toBe(false);
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Transaction count").textContent).toBe("0");
    view.unmount();
  });
});
