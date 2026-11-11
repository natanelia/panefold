// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeId, groupId } from "@panefold/model";
import { SurfaceFrameScheduler } from "@panefold/motion";
import type { createResizeActor as CreateResizeActor } from "@panefold/protocol-xstate";
import { WorkspaceSurface } from "../src/WorkspaceSurface";
import { WorkspaceRuntimeProvider } from "../src/runtime-context";
import { createModelWorkspaceSession, ModelWorkspaceSurface } from "../src/model";
import type { WorkspaceAxis, WorkspaceProjection } from "../src/types";
import { modelBounds, modelFixture } from "./model-fixture";

const resizeActors = vi.hoisted(() => new Set<{ getSnapshot(): { status: string } }>());

vi.mock("@panefold/protocol-xstate", async (importOriginal) => {
  const actual = await importOriginal<{ createResizeActor: typeof CreateResizeActor }>();
  return {
    ...actual,
    createResizeActor: (...args: Parameters<typeof actual.createResizeActor>) => {
      const actor = actual.createResizeActor(...args);
      resizeActors.add(actor);
      return actor;
    },
  };
});

afterEach(() => {
  cleanup();
  resizeActors.clear();
  vi.restoreAllMocks();
});

function setup({
  axis = "inline",
  mode = "live",
  disabled,
  generic = false,
}: {
  axis?: WorkspaceAxis;
  mode?: "live" | "separator";
  disabled?: boolean;
  generic?: boolean;
} = {}) {
  const session = createModelWorkspaceSession({
    initialSnapshot: modelFixture({
      nodes: [
        {
          kind: "split",
          id: nodeId("root"),
          axis,
          children: [nodeId("left-node"), nodeId("right-node")],
          weights: [100_000, 900_000],
          collapsedChildIds: [],
        },
        { kind: "group", id: nodeId("left-node"), groupId: groupId("left") },
        { kind: "group", id: nodeId("right-node"), groupId: groupId("right") },
      ],
    }),
  });
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const scheduler = new SurfaceFrameScheduler({
    requestFrame: (callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame: (id) => callbacks.delete(id),
  });
  const surface = (nextDisabled?: boolean) => {
    const props = {
      panels: {
        "test.panel": {
          render: ({ panel }: { panel: { title: string } }) => <input aria-label={panel.title} />,
        },
      },
      layoutBounds: modelBounds,
      motion: "off" as const,
      resizePreviewMode: mode,
      frameScheduler: scheduler,
      ...(nextDisabled === undefined ? {} : { splitResizeDisabled: nextDisabled }),
    };
    return generic ? (
      <WorkspaceRuntimeProvider runtime={session.runtime}>
        <WorkspaceSurface {...props} projector={session.projector} commands={session.commands} />
      </WorkspaceRuntimeProvider>
    ) : (
      <ModelWorkspaceSurface {...props} bindings={session} />
    );
  };
  const view = render(surface(disabled));
  const splitter = required(view.container.querySelector<HTMLElement>("[data-workspace-splitter]"));
  const primary = required(
    view.container.querySelector<HTMLElement>('[data-workspace-split-child="left-node"]'),
  );
  const marker = required(
    view.container.querySelector<HTMLElement>("[data-workspace-resize-preview]"),
  );
  let captured: number | undefined;
  splitter.setPointerCapture = vi.fn((id) => {
    captured = id;
  });
  splitter.hasPointerCapture = (id) => captured === id;
  splitter.releasePointerCapture = vi.fn((id) => {
    if (captured === id) captured = undefined;
  });
  const start = Number(
    axis === "inline" ? splitter.dataset.inlineStart : splitter.dataset.blockStart,
  );
  const sample = (delta = 0, pointerId = 41) => ({
    button: 0,
    pointerId,
    ...(axis === "inline" ? { clientX: start + delta } : { clientY: start + delta }),
  });
  return {
    session,
    view,
    surface,
    splitter,
    primary,
    marker,
    sample,
    begin(pointerId = 41) {
      fireEvent.pointerDown(splitter, sample(0, pointerId));
      fireEvent.pointerMove(splitter, sample(30, pointerId));
    },
    size: () => Number(axis === "inline" ? primary.dataset.inlineSize : primary.dataset.blockSize),
    values: () =>
      ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"].map((name) =>
        splitter.getAttribute(name),
      ),
    hasPending: () => callbacks.size > 0,
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    },
    dispose() {
      view.unmount();
      session.dispose();
      scheduler.dispose();
    },
  };
}

function activeActorCount() {
  return [...resizeActors].filter((actor) => actor.getSnapshot().status === "active").length;
}

describe("disabled split resizing", () => {
  it.each(["inline", "block"] as const)(
    "ignores input on disabled %s dividers and restores keyboard resizing when enabled",
    (axis) => {
      const fixture = setup({ axis, disabled: true });
      try {
        const { session, splitter, view } = fixture;
        const snapshot = session.runtime.getSnapshot();
        const values = fixture.values();
        const input = required(view.container.querySelector("input"));
        act(() => input.focus());
        expect(splitter.getAttribute("aria-disabled")).toBe("true");
        expect(splitter.hasAttribute("tabindex")).toBe(false);
        expect(splitter.getAttribute("aria-controls")).toBe(fixture.primary.id);
        expect(splitter.getAttribute("aria-orientation")).toBe(
          axis === "inline" ? "vertical" : "horizontal",
        );
        expect(fireEvent.pointerDown(splitter, fixture.sample())).toBe(true);
        fireEvent.pointerMove(splitter, fixture.sample(30));
        fireEvent.pointerUp(splitter, fixture.sample(30));
        for (const key of [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "F6",
        ]) {
          expect(fireEvent.keyDown(splitter, { key })).toBe(true);
        }
        expect(document.activeElement).toBe(input);
        expect(splitter.setPointerCapture).not.toHaveBeenCalled();
        expect(resizeActors.size).toBe(0);
        expect(fixture.hasPending()).toBe(false);
        expect(fixture.values()).toEqual(values);
        expect(session.runtime.getSnapshot()).toBe(snapshot);
        expect(session.runtime.canUndo()).toBe(false);

        view.rerender(fixture.surface(false));
        expect(splitter.hasAttribute("aria-disabled")).toBe(false);
        expect(splitter.tabIndex).toBe(0);
        fireEvent.keyDown(splitter, { key: axis === "inline" ? "ArrowRight" : "ArrowDown" });
        expect(session.runtime.getSnapshot().revision).toBe(snapshot.revision + 1n);
        expect(session.runtime.canUndo()).toBe(true);
        expect(activeActorCount()).toBe(0);
      } finally {
        fixture.dispose();
      }
    },
  );

  for (const mode of ["live", "separator"] as const) {
    for (const painted of [false, true]) {
      it(`cancels a ${painted ? "painted" : "queued"} ${mode} drag when disabled and permits a fresh drag`, () => {
        const fixture = setup({ mode });
        const ownerWindow = required(fixture.splitter.ownerDocument.defaultView);
        const addWindow = vi.spyOn(ownerWindow, "addEventListener");
        const removeWindow = vi.spyOn(ownerWindow, "removeEventListener");
        const addDocument = vi.spyOn(document, "addEventListener");
        const removeDocument = vi.spyOn(document, "removeEventListener");
        try {
          const { session, splitter, marker, view } = fixture;
          const snapshot = session.runtime.getSnapshot();
          const size = fixture.size();
          const values = fixture.values();
          fixture.begin();
          if (painted) {
            act(() => fixture.flush());
            expect(fixture.size()).toBe(mode === "live" ? size + 30 : size);
            expect(marker.hidden).toBe(mode === "live");
            fireEvent.pointerMove(splitter, fixture.sample(50));
          }
          expect(fixture.hasPending()).toBe(true);
          expect(activeActorCount()).toBe(1);
          const windowListeners = addWindow.mock.calls.filter(
            ([type]) => type === "blur" || type === "pagehide",
          );
          const documentListeners = addDocument.mock.calls.filter(
            ([type]) => type === "visibilitychange",
          );
          expect(windowListeners).toHaveLength(2);
          expect(documentListeners).toHaveLength(1);
          if (mode === "live" && painted) {
            view.rerender(fixture.surface(false));
            expect(splitter.dataset.resizeState).toBe("resizing");
            expect(splitter.hasPointerCapture(41)).toBe(true);
            expect(fixture.size()).toBe(size + 30);
            expect(fixture.hasPending()).toBe(true);
            expect(activeActorCount()).toBe(1);
          }
          view.rerender(fixture.surface(true));

          expect(document.activeElement).toBe(splitter);
          expect(splitter.getAttribute("tabindex")).toBe("-1");
          expect(splitter.dataset.resizeState).toBe("idle");
          expect(fixture.size()).toBe(size);
          expect(fixture.values()).toEqual(values);
          expect(marker.hidden).toBe(true);
          expect(splitter.hasPointerCapture(41)).toBe(false);
          expect(fixture.hasPending()).toBe(false);
          expect(activeActorCount()).toBe(0);
          for (const [type, listener] of windowListeners)
            expect(removeWindow).toHaveBeenCalledWith(type, listener);
          for (const [type, listener] of documentListeners)
            expect(removeDocument).toHaveBeenCalledWith(type, listener);
          expect(fireEvent.keyDown(splitter, { key: "F6" })).toBe(true);
          expect(fireEvent.keyDown(splitter, { key: "End" })).toBe(true);
          act(() => fixture.flush());
          fireEvent.pointerUp(splitter, fixture.sample(50));
          fireEvent.blur(ownerWindow);
          expect(session.runtime.getSnapshot()).toBe(snapshot);
          expect(session.runtime.canUndo()).toBe(false);

          view.rerender(fixture.surface(false));
          fireEvent.pointerUp(splitter, fixture.sample(50));
          expect(session.runtime.getSnapshot()).toBe(snapshot);
          fixture.begin(42);
          fireEvent.pointerUp(splitter, fixture.sample(30, 42));
          expect(fixture.size()).toBe(size + 30);
          expect(session.runtime.getSnapshot().revision).toBe(snapshot.revision + 1n);
          expect(session.runtime.canUndo()).toBe(true);
          expect(activeActorCount()).toBe(0);
        } finally {
          fixture.dispose();
        }
      });
    }
  }

  it("cancels a captured pointer before the first move without adding history", () => {
    const fixture = setup();
    try {
      const snapshot = fixture.session.runtime.getSnapshot();
      fireEvent.pointerDown(fixture.splitter, fixture.sample());
      expect(fixture.splitter.hasPointerCapture(41)).toBe(true);
      fixture.view.rerender(fixture.surface(true));
      expect(document.activeElement).toBe(fixture.splitter);
      expect(fixture.splitter.getAttribute("tabindex")).toBe("-1");
      fireEvent.pointerUp(fixture.splitter, fixture.sample(30));
      expect(fixture.splitter.hasPointerCapture(41)).toBe(false);
      expect(fixture.splitter.dataset.resizeState).toBe("idle");
      expect(activeActorCount()).toBe(0);
      const input = required(fixture.view.container.querySelector("input"));
      act(() => input.focus());
      expect(document.activeElement).toBe(input);
      expect(fixture.splitter.hasAttribute("tabindex")).toBe(false);
      act(() => fixture.splitter.focus());
      expect(document.activeElement).toBe(input);
      expect(fixture.session.runtime.getSnapshot()).toBe(snapshot);
      expect(fixture.session.runtime.canUndo()).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it("keeps generic adapter input disabled while application resize commands remain available", () => {
    const fixture = setup({ generic: true, disabled: true });
    try {
      const { session, splitter } = fixture;
      const snapshot = session.runtime.getSnapshot();
      fixture.begin();
      fireEvent.pointerUp(splitter, fixture.sample(30));
      fireEvent.keyDown(splitter, { key: "End" });
      expect(session.runtime.getSnapshot()).toBe(snapshot);
      act(() => session.runtime.dispatch(session.commands.resizeSplit("root", [500_000, 500_000])));
      expect(session.runtime.getSnapshot().revision).toBe(snapshot.revision + 1n);
      expect(fixture.size()).toBe(497);
      expect(splitter.getAttribute("aria-disabled")).toBe("true");
      expect(session.runtime.canUndo()).toBe(true);
      expect(resizeActors.size).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  it("disables nested and floating layout dividers without disabling a nested workspace", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    const childSession = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    const base = session.projector(session.runtime.getSnapshot());
    const projection: WorkspaceProjection = {
      ...base,
      nodes: {
        ...base.nodes,
        root: {
          kind: "split",
          id: "root",
          axis: "inline",
          childIds: ["nested", "right-node"],
          weights: [1, 1],
        },
        nested: {
          kind: "split",
          id: "nested",
          axis: "block",
          childIds: ["left-node", "extra-node"],
          weights: [1, 1],
        },
        "extra-node": { kind: "group", id: "extra-node", groupId: "extra" },
        floating: {
          kind: "split",
          id: "floating",
          axis: "inline",
          childIds: ["float-a-node", "float-b-node"],
          weights: [1, 1],
        },
        "float-a-node": { kind: "group", id: "float-a-node", groupId: "float-a" },
        "float-b-node": { kind: "group", id: "float-b-node", groupId: "float-b" },
      },
      groups: {
        ...base.groups,
        extra: { id: "extra", panelIds: [], selectedPanelId: "" },
        "float-a": { id: "float-a", panelIds: [], selectedPanelId: "" },
        "float-b": { id: "float-b", panelIds: [], selectedPanelId: "" },
      },
      floatingSurfaces: [
        {
          id: "floating",
          rootNodeId: "floating",
          bounds: { x: 100, y: 100, width: 500, height: 300 },
          maximized: false,
        },
      ],
    };
    const view = render(
      <WorkspaceRuntimeProvider runtime={session.runtime}>
        <WorkspaceSurface
          projector={() => projection}
          commands={session.commands}
          layoutBounds={modelBounds}
          motion="off"
          splitResizeDisabled
          panels={{
            "test.panel": {
              render: ({ panel }) =>
                panel.id === "a" ? (
                  <ModelWorkspaceSurface
                    bindings={childSession}
                    workspaceLabel="Nested workspace"
                    panels={{ "test.panel": { render: () => <input /> } }}
                    layoutBounds={modelBounds}
                    motion="off"
                  />
                ) : (
                  <input />
                ),
            },
          }}
        />
      </WorkspaceRuntimeProvider>,
    );
    try {
      const outer = required(view.container.querySelector<HTMLElement>(".pf-workspace"));
      const splitters = [
        ...outer.querySelectorAll<HTMLElement>("[data-workspace-splitter]"),
      ].filter((element) => element.closest(".pf-workspace") === outer);
      expect(splitters).toHaveLength(3);
      for (const splitter of splitters) {
        expect(splitter.getAttribute("aria-disabled")).toBe("true");
        expect(splitter.hasAttribute("tabindex")).toBe(false);
        expect(fireEvent.keyDown(splitter, { key: "F6" })).toBe(true);
      }
      const nested = view.getByLabelText("Nested workspace", { exact: true });
      const childSplitter = required(
        nested.querySelector<HTMLElement>("[data-workspace-splitter]"),
      );
      expect(childSplitter.hasAttribute("aria-disabled")).toBe(false);
      expect(childSplitter.tabIndex).toBe(0);
      fireEvent.keyDown(childSplitter, { key: "ArrowRight" });
      expect(childSession.runtime.canUndo()).toBe(true);
      expect(session.runtime.canUndo()).toBe(false);
    } finally {
      view.unmount();
      session.dispose();
      childSession.dispose();
    }
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing disabled splitter fixture value");
  return value;
}
