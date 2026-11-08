// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceFrameScheduler } from "@panefold/motion";
import type { createFloatingManipulationActor as CreateFloatingManipulationActor } from "@panefold/protocol-xstate";
import { FloatingSurfaceFrame, type FloatingSurfaceFrameProps } from "../src/floating-surface";
import { ENGLISH_WORKSPACE_MESSAGES, resolveWorkspaceInteractionMessages } from "../src/messages";

const actors = vi.hoisted(() => ({ active: 0, started: 0, stopped: 0 }));
const listenerTeardowns: (() => void)[] = [];

vi.mock("@panefold/protocol-xstate", async (importOriginal) => {
  const actual = await importOriginal<{
    createFloatingManipulationActor: typeof CreateFloatingManipulationActor;
  }>();
  return {
    ...actual,
    createFloatingManipulationActor: (
      ...args: Parameters<typeof actual.createFloatingManipulationActor>
    ) => {
      const actor = actual.createFloatingManipulationActor(...args);
      const start = actor.start.bind(actor);
      const stop = actor.stop.bind(actor);
      let active = false;
      Object.defineProperties(actor, {
        start: {
          configurable: true,
          value: () => {
            if (!active) {
              active = true;
              actors.active += 1;
              actors.started += 1;
            }
            return start();
          },
        },
        stop: {
          configurable: true,
          value: () => {
            if (active) {
              active = false;
              actors.active -= 1;
              actors.stopped += 1;
            }
            return stop();
          },
        },
      });
      return actor;
    },
  };
});

afterEach(() => {
  cleanup();
  for (const dispose of listenerTeardowns.splice(0)) dispose();
  vi.restoreAllMocks();
  actors.active = 0;
  actors.started = 0;
  actors.stopped = 0;
});

type Mode = "move" | "resize";
type Interruption = "blur" | "pagehide" | "hidden";
const originalBounds = { x: 100, y: 80, width: 320, height: 240 };

describe("interrupted floating pointer gestures", () => {
  for (const mode of ["move", "resize"] as const) {
    for (const interruption of ["blur", "pagehide", "hidden"] as const) {
      it.each(["queued", "painted"] as const)(
        `cancels a %s ${mode} on owner ${interruption} without committing`,
        (phase) => {
          const fixture = setup(mode);
          expect(fixture.listeners.count()).toBe(0);
          begin(fixture, 31);
          move(fixture, 31, 60, 40);
          if (phase === "painted") {
            act(() => fixture.frames.flush());
            expect(readBounds(fixture.frame)).toEqual(movedBounds(mode, 60, 40));
            move(fixture, 31, 90, 50);
          }
          expect(fixture.frames.hasPending()).toBe(true);
          expect(actors.active).toBe(1);
          expect(fixture.handle.hasPointerCapture(31)).toBe(true);
          expect(fixture.listeners.count()).toBeGreaterThan(0);

          interrupt(fixture.document, interruption);

          expect(fixture.frame.dataset.floatingManipulation).toBe("idle");
          expect(readBounds(fixture.frame)).toEqual(originalBounds);
          expect(fixture.frames.hasPending()).toBe(false);
          expect(fixture.handle.hasPointerCapture(31)).toBe(false);
          expect(fixture.listeners.count()).toBe(0);
          expect(actors).toEqual({ active: 0, started: 1, stopped: 1 });
          expect(fixture.onMove).not.toHaveBeenCalled();
          expect(fixture.onResize).not.toHaveBeenCalled();
          interrupt(fixture.document, interruption);
          act(() => fixture.frames.flush());
          finish(fixture, 31, 90, 50);
          expect(readBounds(fixture.frame)).toEqual(originalBounds);
          expect(fixture.onMove).not.toHaveBeenCalled();
          expect(fixture.onResize).not.toHaveBeenCalled();
          expect(actors.stopped).toBe(1);

          setVisibility(fixture.document, "visible");
          begin(fixture, 32);
          move(fixture, 32, 20, 10);
          act(() => fixture.frames.flush());
          finish(fixture, 32, 20, 10);
          expect(
            mode === "move" ? fixture.onMove : fixture.onResize,
          ).toHaveBeenCalledExactlyOnceWith(movedBounds(mode, 20, 10), "pointer");
          expect(mode === "move" ? fixture.onResize : fixture.onMove).not.toHaveBeenCalled();
          expect(actors).toEqual({ active: 0, started: 2, stopped: 2 });
          expect(fixture.listeners.count()).toBe(0);
        },
      );
    }

    it(`keeps a ${mode} through element focus changes and visible notifications`, () => {
      const fixture = setup(mode);
      begin(fixture, 41);
      move(fixture, 41, 60, 40);
      act(() => fixture.frames.flush());

      const input = required(fixture.container.querySelector("input"));
      const titlebar = required(
        fixture.container.querySelector<HTMLElement>(".pf-floating-titlebar"),
      );
      act(() => {
        input.focus();
        titlebar.focus();
      });
      // A capture listener on the window must still distinguish an element blur.
      fireEvent(input, new FocusEvent("blur", { bubbles: true }));
      fireEvent(input, new Event("pagehide", { bubbles: true }));
      const foreignPageHide = new Event("pagehide");
      Object.defineProperty(foreignPageHide, "target", {
        value: document.implementation.createHTMLDocument(),
      });
      fireEvent(required(fixture.document.defaultView), foreignPageHide);
      fireEvent(fixture.document, new Event("visibilitychange"));

      expect(fixture.frame.dataset.floatingManipulation).toBe("manipulating");
      expect(readBounds(fixture.frame)).toEqual(movedBounds(mode, 60, 40));
      expect(fixture.handle.hasPointerCapture(41)).toBe(true);
      expect(actors.active).toBe(1);
      expect(fixture.onMove).not.toHaveBeenCalled();
      expect(fixture.onResize).not.toHaveBeenCalled();
      finish(fixture, 41, 60, 40);
      expect(mode === "move" ? fixture.onMove : fixture.onResize).toHaveBeenCalledExactlyOnceWith(
        movedBounds(mode, 60, 40),
        "pointer",
      );
      expect(fixture.listeners.count()).toBe(0);
    });

    it(`keeps the final ${mode} preview when its release callback changes window focus`, () => {
      const fixture = setup(mode);
      const command = mode === "move" ? fixture.onMove : fixture.onResize;
      command.mockImplementationOnce(() => {
        interrupt(fixture.document, "blur");
        return { status: "committed" };
      });
      begin(fixture, 45);
      move(fixture, 45, 60, 40);
      act(() => fixture.frames.flush());

      finish(fixture, 45, 60, 40);

      expect(command).toHaveBeenCalledExactlyOnceWith(movedBounds(mode, 60, 40), "pointer");
      expect(readBounds(fixture.frame)).toEqual(movedBounds(mode, 60, 40));
      expect(fixture.frame.dataset.floatingManipulation).toBe("idle");
      expect(fixture.listeners.count()).toBe(0);
      expect(actors.active).toBe(0);
    });

    it(`only interrupts a ${mode} for the document that owns its frame`, () => {
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      const ownerDocument = required(iframe.contentDocument);
      const fixture = setup(mode, ownerDocument);
      try {
        begin(fixture, 51);
        move(fixture, 51, 60, 40);
        act(() => fixture.frames.flush());
        for (const interruption of ["blur", "pagehide", "hidden"] as const) {
          interrupt(document, interruption);
        }
        expect(fixture.frame.dataset.floatingManipulation).toBe("manipulating");
        expect(readBounds(fixture.frame)).toEqual(movedBounds(mode, 60, 40));
        expect(fixture.handle.hasPointerCapture(51)).toBe(true);
        expect(actors.active).toBe(1);

        interrupt(ownerDocument, "blur");

        expect(fixture.frame.dataset.floatingManipulation).toBe("idle");
        expect(readBounds(fixture.frame)).toEqual(originalBounds);
        expect(fixture.handle.hasPointerCapture(51)).toBe(false);
        expect(fixture.listeners.count()).toBe(0);
        expect(actors.active).toBe(0);
        finish(fixture, 51, 60, 40);
        expect(fixture.onMove).not.toHaveBeenCalled();
        expect(fixture.onResize).not.toHaveBeenCalled();
      } finally {
        fixture.unmount();
        iframe.remove();
      }
    });

    it.each([
      "pointercancel",
      "lostpointercapture",
      "unmount",
      "revision",
      "viewport",
      "rejected",
      "throw",
      "unchanged",
    ] as const)(`cleans up interruption listeners after a ${mode} ends via %s`, (ending) => {
      const fixture = setup(mode);
      begin(fixture, 61);
      expect(fixture.listeners.count()).toBeGreaterThan(0);
      if (ending !== "unchanged") {
        move(fixture, 61, 60, 40);
        act(() => fixture.frames.flush());
        move(fixture, 61, 90, 50);
      }
      if (ending === "pointercancel") fireEvent.pointerCancel(fixture.handle, { pointerId: 61 });
      else if (ending === "lostpointercapture") {
        fireEvent.lostPointerCapture(fixture.handle, { pointerId: 61 });
      } else if (ending === "unmount") fixture.unmount();
      else if (ending === "revision") fixture.update({ projectionRevision: "1" });
      else if (ending === "viewport") fixture.update({ viewportWidth: 900 });
      else if (ending === "unchanged") finish(fixture, 61, 0, 0);
      else {
        const command = mode === "move" ? fixture.onMove : fixture.onResize;
        if (ending === "rejected") command.mockReturnValueOnce({ status: "rejected" });
        else
          command.mockImplementationOnce(() => {
            throw new Error("Fixture rejected the command");
          });
        finish(fixture, 61, 90, 50);
      }
      expect(fixture.handle.hasPointerCapture(61)).toBe(false);
      expect(fixture.frames.hasPending()).toBe(false);
      expect(fixture.listeners.count()).toBe(0);
      expect(actors.active).toBe(0);
      if (ending !== "unmount") {
        expect(readBounds(fixture.frame)).toEqual(originalBounds);
        expect(fixture.frame.dataset.floatingManipulation).toBe("idle");
      }
      const calls = fixture.onMove.mock.calls.length + fixture.onResize.mock.calls.length;
      interrupt(fixture.document, "pagehide");
      act(() => fixture.frames.flush());
      finish(fixture, 61, 90, 50);
      expect(fixture.onMove.mock.calls.length + fixture.onResize.mock.calls.length).toBe(calls);
    });
  }
});

function setup(mode: Mode, ownerDocument = document) {
  setVisibility(ownerDocument, "visible");
  const onMove = vi.fn<NonNullable<FloatingSurfaceFrameProps["onMove"]>>(() => ({
    status: "committed",
  }));
  const onResize = vi.fn<NonNullable<FloatingSurfaceFrameProps["onResize"]>>(() => ({
    status: "committed",
  }));
  const frames = frameScheduler();
  const container = ownerDocument.createElement("div");
  ownerDocument.body.append(container);
  const listeners = watchInterruptionListeners(ownerDocument);
  const element = (projectionRevision = "0", viewportWidth = 800) => (
    <FloatingSurfaceFrame
      surface={{ id: "tools", rootNodeId: "tools-node", bounds: originalBounds, maximized: false }}
      bounds={originalBounds}
      projectionRevision={projectionRevision}
      title="Tools"
      active
      frontmost
      zIndex={1}
      viewportWidth={viewportWidth}
      viewportHeight={600}
      scheduler={frames.scheduler}
      scheduleKey="floating-interruption"
      messages={resolveWorkspaceInteractionMessages(ENGLISH_WORKSPACE_MESSAGES)}
      onMove={onMove}
      onResize={onResize}
    >
      <input aria-label="Floating input" />
    </FloatingSurfaceFrame>
  );
  const view = render(element(), { container });
  const frame = required(container.querySelector<HTMLElement>("[data-workspace-floating-surface]"));
  const handle = required(
    container.querySelector<HTMLElement>(
      mode === "move" ? ".pf-floating-titlebar" : '[data-resize-edge="bottom-right"]',
    ),
  );
  let captured: number | undefined;
  handle.setPointerCapture = (id) => {
    captured = id;
  };
  handle.hasPointerCapture = (id) => captured === id;
  handle.releasePointerCapture = (id) => {
    if (captured === id) captured = undefined;
  };
  return {
    ...view,
    frame,
    handle,
    mode,
    onMove,
    onResize,
    frames,
    listeners,
    document: ownerDocument,
    update: (next: { readonly projectionRevision?: string; readonly viewportWidth?: number }) =>
      view.rerender(element(next.projectionRevision, next.viewportWidth)),
  };
}

type Fixture = ReturnType<typeof setup>;

function begin(fixture: Fixture, pointerId: number) {
  fireEvent.pointerDown(fixture.handle, { button: 0, pointerId, clientX: 100, clientY: 80 });
}

function move(fixture: Fixture, pointerId: number, dx: number, dy: number) {
  fireEvent.pointerMove(fixture.handle, { pointerId, clientX: 100 + dx, clientY: 80 + dy });
}

function finish(fixture: Fixture, pointerId: number, dx: number, dy: number) {
  fireEvent.pointerUp(fixture.handle, { pointerId, clientX: 100 + dx, clientY: 80 + dy });
}

function movedBounds(mode: Mode, dx: number, dy: number) {
  return mode === "move"
    ? { ...originalBounds, x: originalBounds.x + dx, y: originalBounds.y + dy }
    : { ...originalBounds, width: originalBounds.width + dx, height: originalBounds.height + dy };
}

function readBounds(frame: HTMLElement) {
  return {
    x: Number.parseFloat(frame.style.left),
    y: Number.parseFloat(frame.style.top),
    width: Number.parseFloat(frame.style.width),
    height: Number.parseFloat(frame.style.height),
  };
}

function interrupt(ownerDocument: Document, kind: Interruption) {
  if (kind === "hidden") {
    setVisibility(ownerDocument, "hidden");
    fireEvent(ownerDocument, new Event("visibilitychange"));
  } else {
    const event = new Event(kind);
    // Native pagehide is dispatched at the window with a legacy document target.
    if (kind === "pagehide") Object.defineProperty(event, "target", { value: ownerDocument });
    fireEvent(required(ownerDocument.defaultView), event);
  }
}

function setVisibility(ownerDocument: Document, state: DocumentVisibilityState) {
  vi.spyOn(ownerDocument, "visibilityState", "get").mockReturnValue(state);
  vi.spyOn(ownerDocument, "hidden", "get").mockReturnValue(state === "hidden");
}

function watchInterruptionListeners(ownerDocument: Document) {
  interface Registration {
    readonly target: EventTarget;
    readonly type: string;
    readonly listener: EventListenerOrEventListenerObject;
    readonly capture: boolean;
    readonly remove: EventTarget["removeEventListener"];
    detachAbort?: () => void;
  }
  const registrations = new Set<Registration>();
  const remove = (registration: Registration) => {
    registrations.delete(registration);
    registration.detachAbort?.();
  };
  for (const target of [ownerDocument, required(ownerDocument.defaultView)] as EventTarget[]) {
    const addListener = target.addEventListener.bind(target);
    const removeListener = target.removeEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      const tracked =
        target === ownerDocument
          ? type === "visibilitychange"
          : type === "blur" || type === "pagehide";
      const signal = typeof options === "object" ? options?.signal : undefined;
      const capture = typeof options === "boolean" ? options : options?.capture === true;
      if (
        tracked &&
        listener !== null &&
        signal?.aborted !== true &&
        ![...registrations].some(
          (item) =>
            item.target === target &&
            item.type === type &&
            item.listener === listener &&
            item.capture === capture,
        )
      ) {
        const registration: Registration = {
          target,
          type,
          listener,
          capture,
          remove: removeListener,
        };
        registrations.add(registration);
        if (signal !== undefined) {
          const handleAbort = () => remove(registration);
          signal.addEventListener("abort", handleAbort, { once: true });
          registration.detachAbort = () => signal.removeEventListener("abort", handleAbort);
        }
      }
      addListener(type, listener, options);
    });
    vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
      const capture = typeof options === "boolean" ? options : options?.capture === true;
      for (const registration of registrations) {
        if (
          registration.target === target &&
          registration.type === type &&
          registration.listener === listener &&
          registration.capture === capture
        )
          remove(registration);
      }
      removeListener(type, listener, options);
    });
  }
  listenerTeardowns.push(() => {
    for (const registration of registrations) {
      registration.remove(registration.type, registration.listener, registration.capture);
      remove(registration);
    }
  });
  return { count: () => registrations.size };
}

function frameScheduler() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  return {
    scheduler: new SurfaceFrameScheduler({
      requestFrame: (callback) => {
        const id = ++nextId;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: (id) => callbacks.delete(id),
    }),
    hasPending: () => callbacks.size > 0,
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    },
  };
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing floating gesture fixture");
  return value;
}
