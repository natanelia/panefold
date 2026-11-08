// @vitest-environment jsdom

import { StrictMode, useEffect, useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceCommand, WorkspaceSnapshot } from "@panefold/model";
import { createWorkspaceRuntime, type RuntimeDispatchReceipt } from "@panefold/runtime";

// Import both built entry points: separate bundles must share one provider context.
import {
  useWorkspaceRuntime,
  type WorkspacePanelRegistry,
  type WorkspacePanelRenderProps,
} from "@panefold/react";
import {
  createModelWorkspaceBindings,
  createModelWorkspaceSession,
  ModelWorkspaceSurface,
  type ModelWorkspaceSession,
} from "@panefold/react/model";
import { modelBounds, modelFixture } from "./model-fixture";

afterEach(cleanup);

describe("compiled model surface", () => {
  it("shares the main entry point's context and always installs the constraint-aware solver", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    const observed = new Set<unknown>();
    function Content({ panel }: WorkspacePanelRenderProps) {
      const runtime = useWorkspaceRuntime<
        WorkspaceSnapshot,
        WorkspaceCommand,
        RuntimeDispatchReceipt
      >();
      observed.add(runtime);
      return <div>{`Content ${panel.title}`}</div>;
    }
    const panels: WorkspacePanelRegistry = { "test.panel": { render: Content } };
    try {
      const view = render(
        <ModelWorkspaceSurface
          bindings={session}
          panels={panels}
          layoutBounds={modelBounds}
          motion="off"
        />,
      );
      expect(observed).toEqual(new Set([session.runtime]));
      const left = view.container.querySelector<HTMLElement>(
        '[data-workspace-split-child="left-node"]',
      );
      expect(left).not.toBeNull();
      expect(
        Number.parseFloat(left?.style.getPropertyValue("--pf-split-size") ?? "0"),
      ).toBeGreaterThanOrEqual(420);
      expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
      act(() => {
        session.runtime.dispatch(session.commands.selectPanel("b"));
      });
      expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
      view.unmount();
    } finally {
      session.dispose();
    }
  });

  it("disposes exactly the sessions created by an effect under Strict Mode", () => {
    const sessions: ModelWorkspaceSession[] = [];
    const panels: WorkspacePanelRegistry = {
      "test.panel": { render: ({ panel }) => <div>{panel.title}</div> },
    };
    function App() {
      const [session, setSession] = useState<ModelWorkspaceSession>();
      useEffect(() => {
        const next = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
        sessions.push(next);
        setSession(next);
        return () => next.dispose();
      }, []);
      return session ? (
        <ModelWorkspaceSurface
          bindings={session}
          panels={panels}
          layoutBounds={modelBounds}
          motion="off"
        />
      ) : null;
    }
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(sessions).toHaveLength(2);
    const first = sessions[0];
    const current = sessions[1];
    if (!first || !current) throw new Error("Strict Mode did not create both sessions");
    expect(() => first.runtime.dispatch(first.commands.selectPanel("b"))).toThrow(/disposed/i);
    act(() => {
      expect(current.runtime.dispatch(current.commands.selectPanel("b")).status).toBe("committed");
    });
    view.unmount();
    expect(() => current.runtime.dispatch(current.commands.selectPanel("a"))).toThrow(/disposed/i);
    expect(() => current.dispose()).not.toThrow();
  });

  it("does not dispose an externally owned runtime when the surface unmounts", () => {
    const runtime = createWorkspaceRuntime({ initialSnapshot: modelFixture() });
    const bindings = createModelWorkspaceBindings(runtime);
    const panels: WorkspacePanelRegistry = {
      "test.panel": { render: ({ panel }) => <div>{panel.title}</div> },
    };
    try {
      const view = render(
        <ModelWorkspaceSurface
          bindings={bindings}
          panels={panels}
          layoutBounds={modelBounds}
          motion="off"
        />,
      );
      view.unmount();
      expect(runtime.dispatch(bindings.commands.selectPanel("b")).status).toBe("committed");
    } finally {
      runtime.dispose();
    }
  });
});
