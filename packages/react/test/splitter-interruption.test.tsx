// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceFrameScheduler } from "@panefold/motion";
import type { createResizeActor as CreateResizeActor } from "@panefold/protocol-xstate";
import { createModelWorkspaceSession, ModelWorkspaceSurface } from "../src/model";
import { ENGLISH_WORKSPACE_MESSAGES } from "../src/messages";
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

type Interruption = "blur" | "pagehide" | "hidden";

function interrupt(document: Document, reason: Interruption) {
  const ownerWindow = required(document.defaultView);
  if (reason === "hidden") {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new ownerWindow.Event("visibilitychange"));
    visibility.mockRestore();
  } else {
    const event = new ownerWindow.Event(reason);
    // Native pagehide is dispatched at Window with its Document as the target.
    if (reason === "pagehide") Object.defineProperty(event, "target", { value: document });
    fireEvent(ownerWindow, event);
  }
}

function setup(mode: "live" | "separator", container?: HTMLElement) {
  const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
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
  const surface = (width = modelBounds.inlineSize, label = "Pane") => (
    <ModelWorkspaceSurface
      bindings={session}
      panels={{ "test.panel": { render: ({ panel }) => <input aria-label={panel.title} /> } }}
      layoutBounds={{ ...modelBounds, inlineSize: width }}
      motion="off"
      resizePreviewMode={mode}
      frameScheduler={scheduler}
      messageCatalog={{
        ...ENGLISH_WORKSPACE_MESSAGES,
        primaryPanePercent: ({ percent }) => `${label}: ${percent}%`,
      }}
    />
  );
  const view = render(surface(), container === undefined ? undefined : { container });
  const splitter = required(view.container.querySelector<HTMLElement>("[data-workspace-splitter]"));
  const primary = required(
    view.container.querySelector<HTMLElement>('[data-workspace-split-child="left-node"]'),
  );
  const marker = required(
    view.container.querySelector<HTMLElement>("[data-workspace-resize-preview]"),
  );
  let captured: number | undefined;
  splitter.setPointerCapture = (id) => {
    captured = id;
  };
  splitter.hasPointerCapture = (id) => captured === id;
  splitter.releasePointerCapture = (id) => {
    if (captured === id) captured = undefined;
  };
  const start = Number(splitter.dataset.inlineStart);
  const begin = (pointerId = 41) => {
    fireEvent.pointerDown(splitter, { button: 0, pointerId, clientX: start });
    fireEvent.pointerMove(splitter, { pointerId, clientX: start + 30 });
  };
  const values = () =>
    ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"].map((attribute) =>
      splitter.getAttribute(attribute),
    );
  return {
    session,
    view,
    surface,
    splitter,
    primary,
    marker,
    start,
    begin,
    values,
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

describe("splitter pointer interruptions", () => {
  for (const mode of ["live", "separator"] as const) {
    for (const painted of [false, true]) {
      it.each(["blur", "pagehide", "hidden"] as const)(
        `cancels a ${painted ? "painted" : "queued"} ${mode} preview on owner %s`,
        (reason) => {
          const fixture = setup(mode);
          try {
            const { session, splitter, primary, marker, start } = fixture;
            const snapshot = session.runtime.getSnapshot();
            const initialValues = fixture.values();
            expect(primary.dataset.inlineSize).toBe("420");
            fixture.begin();
            if (painted) {
              act(() => fixture.flush());
              expect(splitter.dataset.resizeState).toBe("resizing");
              expect(primary.dataset.inlineSize).toBe(mode === "live" ? "450" : "420");
              expect(marker.hidden).toBe(mode === "live");
              if (mode === "live") expect(fixture.values()).not.toEqual(initialValues);
              fireEvent.pointerMove(splitter, { pointerId: 41, clientX: start + 50 });
            }
            expect(fixture.hasPending()).toBe(true);
            expect(activeActorCount()).toBe(1);
            interrupt(splitter.ownerDocument, reason);

            expect(splitter.dataset.resizeState).toBe("idle");
            expect(primary.dataset.inlineSize).toBe("420");
            expect(primary.style.getPropertyValue("--pf-split-size")).toBe("420px");
            expect(fixture.values()).toEqual(initialValues);
            expect(marker.hidden).toBe(true);
            expect(splitter.hasPointerCapture(41)).toBe(false);
            expect(activeActorCount()).toBe(0);
            expect(fixture.hasPending()).toBe(false);
            expect(session.runtime.getSnapshot()).toBe(snapshot);
            expect(session.runtime.canUndo()).toBe(false);
            act(() => fixture.flush());
            fireEvent.pointerUp(splitter, { pointerId: 41, clientX: start + 50 });
            interrupt(splitter.ownerDocument, reason);
            expect(session.runtime.getSnapshot()).toBe(snapshot);

            fixture.begin(42);
            fireEvent.pointerUp(splitter, { pointerId: 42, clientX: start + 30 });
            expect(primary.dataset.inlineSize).toBe("450");
            expect(session.runtime.getSnapshot().revision).toBe(snapshot.revision + 1n);
            expect(session.runtime.canUndo()).toBe(true);
            expect(activeActorCount()).toBe(0);
          } finally {
            fixture.dispose();
          }
        },
      );
    }
  }

  it("ignores other documents, ordinary focus changes, and visible visibility events", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const ownerDocument = required(iframe.contentDocument);
    const ownerWindow = required(ownerDocument.defaultView);
    const container = ownerDocument.createElement("div");
    ownerDocument.body.append(container);
    const fixture = setup("separator", container);
    try {
      fixture.begin();
      act(() => fixture.flush());
      const input = required(fixture.view.container.querySelector("input"));
      act(() => input.focus());
      fireEvent(input, new ownerWindow.Event("blur", { bubbles: true }));
      fireEvent(input, new ownerWindow.Event("pagehide", { bubbles: true }));
      const foreignPageHide = new ownerWindow.Event("pagehide");
      Object.defineProperty(foreignPageHide, "target", { value: document });
      fireEvent(ownerWindow, foreignPageHide);
      for (const reason of ["blur", "pagehide", "hidden"] as const) interrupt(document, reason);
      const visibility = vi
        .spyOn(ownerDocument, "visibilityState", "get")
        .mockReturnValue("visible");
      fireEvent(ownerDocument, new ownerWindow.Event("visibilitychange"));
      visibility.mockRestore();
      expect(fixture.splitter.dataset.resizeState).toBe("resizing");
      expect(fixture.marker.hidden).toBe(false);
      expect(fixture.splitter.hasPointerCapture(41)).toBe(true);

      interrupt(ownerDocument, "blur");
      expect(fixture.splitter.dataset.resizeState).toBe("idle");
      expect(fixture.marker.hidden).toBe(true);
      expect(activeActorCount()).toBe(0);
    } finally {
      fixture.dispose();
      iframe.remove();
    }
  });

  it("uses the current restoration callback after an equal-geometry parent render", () => {
    const fixture = setup("live");
    try {
      fixture.begin();
      act(() => fixture.flush());
      fixture.view.rerender(fixture.surface(modelBounds.inlineSize, "Updated pane"));
      expect(fixture.splitter.dataset.resizeState).toBe("resizing");
      expect(fixture.splitter.getAttribute("aria-valuetext")).toMatch(/^Updated pane:/);
      interrupt(fixture.splitter.ownerDocument, "blur");
      expect(fixture.primary.dataset.inlineSize).toBe("420");
      expect(fixture.splitter.getAttribute("aria-valuetext")).toBe("Updated pane: 42.25%");
      expect(fixture.session.runtime.canUndo()).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it.each([
    "release",
    "unchanged",
    "escape",
    "pointercancel",
    "lostpointercapture",
    "revision",
    "geometry",
    "unmount",
  ] as const)("detaches interruption listeners when a splitter ends via %s", (ending) => {
    const fixture = setup("live");
    const ownerDocument = fixture.splitter.ownerDocument;
    const ownerWindow = required(ownerDocument.defaultView);
    const addWindow = vi.spyOn(ownerWindow, "addEventListener");
    const removeWindow = vi.spyOn(ownerWindow, "removeEventListener");
    const addDocument = vi.spyOn(ownerDocument, "addEventListener");
    const removeDocument = vi.spyOn(ownerDocument, "removeEventListener");
    try {
      if (ending === "unchanged") {
        fireEvent.pointerDown(fixture.splitter, {
          button: 0,
          pointerId: 41,
          clientX: fixture.start,
        });
      } else {
        fixture.begin();
        act(() => fixture.flush());
        fireEvent.pointerMove(fixture.splitter, { pointerId: 41, clientX: fixture.start + 50 });
      }
      const windowListeners = addWindow.mock.calls.filter(
        ([type]) => type === "blur" || type === "pagehide",
      );
      const documentListeners = addDocument.mock.calls.filter(
        ([type]) => type === "visibilitychange",
      );
      expect(windowListeners).toHaveLength(2);
      expect(documentListeners).toHaveLength(1);

      if (ending === "release" || ending === "unchanged") {
        fireEvent.pointerUp(fixture.splitter, {
          pointerId: 41,
          clientX: fixture.start + (ending === "release" ? 30 : 0),
        });
      } else if (ending === "escape") fireEvent.keyDown(fixture.splitter, { key: "Escape" });
      else if (ending === "pointercancel" || ending === "lostpointercapture") {
        // The browser releases capture before delivering either event.
        fixture.splitter.releasePointerCapture(41);
        if (ending === "pointercancel")
          fireEvent.pointerCancel(fixture.splitter, { pointerId: 41 });
        else fireEvent.lostPointerCapture(fixture.splitter, { pointerId: 41 });
      } else if (ending === "revision") {
        act(() => fixture.session.runtime.dispatch(fixture.session.commands.selectPanel("b")));
      } else if (ending === "geometry") fixture.view.rerender(fixture.surface(1100));
      else fixture.view.unmount();

      expect(fixture.hasPending()).toBe(false);
      expect(fixture.splitter.hasPointerCapture(41)).toBe(false);
      expect(activeActorCount()).toBe(0);
      for (const [type, listener] of windowListeners)
        expect(removeWindow).toHaveBeenCalledWith(type, listener);
      for (const [type, listener] of documentListeners)
        expect(removeDocument).toHaveBeenCalledWith(type, listener);
      const snapshot = fixture.session.runtime.getSnapshot();
      for (const reason of ["blur", "pagehide", "hidden"] as const)
        interrupt(ownerDocument, reason);
      act(() => fixture.flush());
      fireEvent.pointerUp(fixture.splitter, { pointerId: 41, clientX: fixture.start + 50 });
      expect(fixture.session.runtime.getSnapshot()).toBe(snapshot);
    } finally {
      fixture.dispose();
    }
  });
});

describe("splitter keyboard event boundaries", () => {
  it.each(["claimed", "composing"] as const)(
    "leaves %s sizing keys unchanged and accepts an ordinary Shift resize afterward",
    (kind) => {
      const fixture = setup("live");
      try {
        const { session, splitter, primary } = fixture;
        // Start inside both bounds so Home and End would each change the layout.
        act(() => session.runtime.dispatch(session.commands.resizeSplit("root", [1, 1])));
        const snapshot = session.runtime.getSnapshot();
        const values = fixture.values();
        expect(primary.dataset.inlineSize).toBe("497");
        for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
          if (kind === "claimed") {
            fixture.view.container.addEventListener("keydown", (event) => event.preventDefault(), {
              capture: true,
              once: true,
            });
          }
          expect(fireEvent.keyDown(splitter, { key, isComposing: kind === "composing" })).toBe(
            kind !== "claimed",
          );
          expect(session.runtime.getSnapshot()).toBe(snapshot);
          expect(fixture.values()).toEqual(values);
          expect(resizeActors.size).toBe(0);
          expect(fixture.hasPending()).toBe(false);
        }

        expect(fireEvent.keyDown(splitter, { key: "ArrowRight", shiftKey: true })).toBe(false);
        expect(primary.dataset.inlineSize).toBe("596");
        expect(session.runtime.getSnapshot().revision).toBe(snapshot.revision + 1n);
        expect(activeActorCount()).toBe(0);
      } finally {
        fixture.dispose();
      }
    },
  );

  it.each(["live", "separator"] as const)(
    "preserves a %s drag through claimed, composing and modified Escape",
    (mode) => {
      const fixture = setup(mode);
      try {
        const { session, splitter, primary, marker, start } = fixture;
        const snapshot = session.runtime.getSnapshot();
        const values = fixture.values();
        fixture.begin();
        const ignored = [
          { claimed: true },
          { isComposing: true },
          { altKey: true },
          { ctrlKey: true },
          { metaKey: true },
        ] satisfies (KeyboardEventInit & { claimed?: boolean })[];
        for (const options of ignored) {
          const claimed = "claimed" in options;
          if (claimed) {
            fixture.view.container.addEventListener("keydown", (event) => event.preventDefault(), {
              capture: true,
              once: true,
            });
          }
          expect(fireEvent.keyDown(splitter, { key: "Escape", ...options })).toBe(!claimed);
          expect(splitter.hasPointerCapture(41)).toBe(true);
          expect(fixture.hasPending()).toBe(true);
          expect(activeActorCount()).toBe(1);
          expect(session.runtime.getSnapshot()).toBe(snapshot);
          expect(session.runtime.canUndo()).toBe(false);
          // The first blocked key preserves the queued frame; later keys also
          // preserve a painted preview while another frame is waiting.
          act(() => fixture.flush());
          expect(splitter.dataset.resizeState).toBe("resizing");
          expect(primary.dataset.inlineSize).toBe(mode === "live" ? "450" : "420");
          expect(marker.hidden).toBe(mode === "live");
          fireEvent.pointerMove(splitter, { pointerId: 41, clientX: start + 30 });
        }

        if (mode === "separator") {
          expect(fireEvent.keyDown(splitter, { key: "Escape", shiftKey: true })).toBe(false);
          expect(primary.dataset.inlineSize).toBe("420");
          expect(fixture.values()).toEqual(values);
          expect(marker.hidden).toBe(true);
          fireEvent.pointerUp(splitter, { pointerId: 41, clientX: start + 30 });
          expect(session.runtime.getSnapshot()).toBe(snapshot);
          expect(session.runtime.canUndo()).toBe(false);
        } else {
          fireEvent.pointerUp(splitter, { pointerId: 41, clientX: start + 30 });
          expect(primary.dataset.inlineSize).toBe("450");
          expect(session.runtime.getSnapshot().revision).toBe(snapshot.revision + 1n);
          const committed = session.runtime.getSnapshot();
          fireEvent.pointerUp(splitter, { pointerId: 41, clientX: start + 50 });
          expect(session.runtime.getSnapshot()).toBe(committed);
          act(() => session.runtime.undo());
          expect(primary.dataset.inlineSize).toBe("420");
          expect(session.runtime.canUndo()).toBe(false);
        }
        expect(fixture.hasPending()).toBe(false);
        expect(splitter.hasPointerCapture(41)).toBe(false);
        expect(activeActorCount()).toBe(0);
      } finally {
        fixture.dispose();
      }
    },
  );
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing interruption fixture value");
  return value;
}
