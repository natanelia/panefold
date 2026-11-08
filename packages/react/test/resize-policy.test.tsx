// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGroupConstraints, solveLayout } from "@panefold/geometry";
import { SurfaceFrameScheduler } from "@panefold/motion";
import {
  createModelWorkspaceBindings,
  createModelWorkspaceSession,
  ModelWorkspaceSurface,
} from "../src/model";
import { modelBounds, modelFixture } from "./model-fixture";

afterEach(cleanup);

describe("resize policy changes during a pointer gesture", () => {
  it("cancels changed allocation inputs even when the current geometry and limits stay equal", () => {
    const session = createModelWorkspaceSession({ initialSnapshot: modelFixture() });
    const frames = frameScheduler();
    const bindingsFor = (grow: number) =>
      createModelWorkspaceBindings(session.runtime, {
        solveLayout: (snapshot, rootId, bounds, options) =>
          solveLayout(snapshot, rootId, bounds, {
            ...options,
            resolveGroupConstraints: (group, current) => {
              const constraints = defaultGroupConstraints(group, current);
              return group.id === "left"
                ? { ...constraints, inline: { ...constraints.inline, grow } }
                : constraints;
            },
          }),
      });
    const surface = (grow: number) => (
      <ModelWorkspaceSurface
        bindings={bindingsFor(grow)}
        panels={{ "test.panel": { render: ({ panel }) => <div>{panel.title}</div> } }}
        layoutBounds={modelBounds}
        motion="off"
        resizePreviewMode="separator"
        frameScheduler={frames.scheduler}
      />
    );
    try {
      const view = render(surface(1));
      const splitter = required(
        view.container.querySelector<HTMLElement>("[data-workspace-splitter]"),
      );
      const marker = required(
        view.container.querySelector<HTMLElement>("[data-workspace-resize-preview]"),
      );
      const children = ["left-node", "right-node"].map((id) =>
        required(view.container.querySelector<HTMLElement>(`[data-workspace-split-child="${id}"]`)),
      );
      const sizes = () => children.map((child) => Number(child.dataset.inlineSize));
      const limits = () => [
        splitter.getAttribute("aria-valuemin"),
        splitter.getAttribute("aria-valuemax"),
      ];
      const initialSizes = sizes();
      const initialLimits = limits();
      const initialSnapshot = session.runtime.getSnapshot();
      const start = Number(splitter.dataset.inlineStart);
      expect(initialSizes).toEqual([420, 574]);
      installPointerCapture(splitter);

      fireEvent.pointerDown(splitter, { button: 0, pointerId: 81, clientX: start });
      fireEvent.pointerMove(splitter, { pointerId: 81, clientX: start + 20 });
      act(() => frames.flush());
      expect(marker.hidden).toBe(false);
      expect(splitter.dataset.resizeState).toBe("resizing");
      expect(splitter.hasPointerCapture(81)).toBe(true);

      // New binding, solver, resolver and allocation objects with equal values
      // must not interrupt a gesture just because the parent rendered again.
      view.rerender(surface(1));
      expect(marker.hidden).toBe(false);
      expect(splitter.dataset.resizeState).toBe("resizing");
      expect(splitter.hasPointerCapture(81)).toBe(true);
      expect(limits()).toEqual(initialLimits);

      fireEvent.pointerMove(splitter, { pointerId: 81, clientX: start + 35 });
      expect(frames.hasPending()).toBe(true);
      // The left pane stays clamped at 420 for both grow=1 and grow=2, so
      // pixels, limits and revision alone cannot detect the changed policy.
      view.rerender(surface(2));
      expect(sizes()).toEqual(initialSizes);
      expect(limits()).toEqual(initialLimits);
      expect(session.runtime.getSnapshot()).toBe(initialSnapshot);
      expect(marker.hidden).toBe(true);
      expect(splitter.dataset.resizeState).toBe("idle");
      expect(splitter.hasPointerCapture(81)).toBe(false);
      expect(frames.hasPending()).toBe(false);
      act(() => frames.flush());
      fireEvent.pointerUp(splitter, { pointerId: 81, clientX: start + 80 });
      expect(session.runtime.getSnapshot()).toBe(initialSnapshot);
      expect(session.runtime.canUndo()).toBe(false);
      expect(sizes()).toEqual(initialSizes);

      // A new gesture uses the replacement policy, rather than the stale plan.
      fireEvent.pointerDown(splitter, { button: 0, pointerId: 82, clientX: start });
      fireEvent.pointerMove(splitter, { pointerId: 82, clientX: start + 30 });
      act(() => frames.flush());
      expect(marker.style.insetInlineStart).toBe("450px");
      fireEvent.pointerUp(splitter, { pointerId: 82, clientX: start + 30 });
      expect(sizes()).toEqual([450, 544]);
      expect(session.runtime.getSnapshot().revision).toBe(initialSnapshot.revision + 1n);
      expect(session.runtime.canUndo()).toBe(true);
      view.unmount();
    } finally {
      session.dispose();
    }
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing resize policy element");
  return value;
}

function installPointerCapture(element: HTMLElement) {
  let captured: number | undefined;
  element.setPointerCapture = (pointerId) => {
    captured = pointerId;
  };
  element.hasPointerCapture = (pointerId) => captured === pointerId;
  element.releasePointerCapture = (pointerId) => {
    if (captured === pointerId) captured = undefined;
  };
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
      cancelFrame: (id) => {
        callbacks.delete(id);
      },
    }),
    hasPending: () => callbacks.size > 0,
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    },
  };
}
