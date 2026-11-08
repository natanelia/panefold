// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { groupId, nodeId, panelId, type PanelConstraints } from "@panefold/model";
import { SurfaceFrameScheduler } from "@panefold/motion";
import { solveLayout } from "@panefold/geometry";
import { createModelWorkspaceSession, ModelWorkspaceSurface } from "../src/model";
import { ENGLISH_WORKSPACE_MESSAGES } from "../src/messages";
import { modelBounds, modelFixture, modelPanel } from "./model-fixture";

afterEach(cleanup);

function fixture(constraints: readonly PanelConstraints[]) {
  const ids = ["a", "b", "c"];
  return modelFixture({
    panels: ids.map((id, index) => ({
      ...modelPanel(id),
      constraints: { hardMinInline: 100, hardMinBlock: 100, ...constraints[index] },
    })),
    groups: ids.map((id) => ({
      id: groupId(id),
      panelIds: [panelId(id)],
      selectedPanelId: panelId(id),
      persistent: true,
    })),
    nodes: [
      {
        kind: "split",
        id: nodeId("root"),
        axis: "inline",
        children: ids.map((id) => nodeId(`${id}-node`)),
        weights: [333_334, 333_333, 333_333],
        collapsedChildIds: [],
      },
      ...ids.map((id) => ({
        kind: "group" as const,
        id: nodeId(`${id}-node`),
        groupId: groupId(id),
      })),
    ],
  });
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing resize fixture element");
  return value;
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
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    },
  };
}

describe("model-backed constrained splitter resizing", () => {
  it.each(["live", "separator"] as const)(
    "keeps accessible values aligned with %s previews and cancellation",
    (mode) => {
      const session = createModelWorkspaceSession({ initialSnapshot: fixture([{}, {}, {}]) });
      const frames = frameScheduler();
      try {
        const view = render(
          <ModelWorkspaceSurface
            bindings={session}
            panels={{ "test.panel": { render: ({ panel }) => <div>{panel.title}</div> } }}
            layoutBounds={modelBounds}
            motion="off"
            resizePreviewMode={mode}
            frameScheduler={frames.scheduler}
            messageCatalog={{
              ...ENGLISH_WORKSPACE_MESSAGES,
              primaryPanePercent: ({ percent }) => `Pane: ${percent}%`,
            }}
          />,
        );
        const splitters = Array.from(
          view.container.querySelectorAll<HTMLElement>("[data-workspace-splitter]"),
        );
        const first = required(splitters[0]);
        const children = Array.from(
          view.container.querySelectorAll<HTMLElement>("[data-workspace-split-child]"),
        );
        const readValues = () =>
          splitters.map((splitter) =>
            ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"].map((attribute) =>
              splitter.getAttribute(attribute),
            ),
          );
        const initial = readValues();
        const start = Number(first.dataset.inlineStart);
        fireEvent.pointerDown(first, { button: 0, pointerId: 29, clientX: start });
        fireEvent.pointerMove(first, { pointerId: 29, clientX: start + 30 });
        act(() => frames.flush());
        if (mode === "separator") expect(readValues()).toEqual(initial);
        else {
          expect(readValues()).not.toEqual(initial);
          splitters.forEach((splitter, index) => {
            const before = Number(required(children[index]).dataset.inlineSize);
            const after = Number(required(children[index + 1]).dataset.inlineSize);
            const percent = (value: number) =>
              Math.round((value / (before + after)) * 10_000) / 100;
            expect(splitter.getAttribute("aria-valuenow")).toBe(String(percent(before)));
            expect(splitter.getAttribute("aria-valuetext")).toBe(`Pane: ${percent(before)}%`);
            expect(splitter.getAttribute("aria-valuemin")).toBe(String(percent(100)));
            expect(splitter.getAttribute("aria-valuemax")).toBe(
              String(percent(before + after - 100)),
            );
          });
        }
        fireEvent.keyDown(first, { key: "Escape" });
        expect(readValues()).toEqual(initial);
        expect(session.runtime.canUndo()).toBe(false);
        view.unmount();
      } finally {
        session.dispose();
      }
    },
  );

  it("keeps a legacy solver's preview intact without inventing keyboard limits", () => {
    const session = createModelWorkspaceSession(
      { initialSnapshot: fixture([{ grow: 2 }, {}, {}]) },
      {
        solveLayout: (snapshot, root, bounds, options) => {
          const layout = solveLayout(snapshot, root, bounds, options);
          return {
            ...layout,
            splitters: layout.splitters.map(({ resize, ...splitter }) => {
              void resize;
              return splitter;
            }),
          };
        },
      },
    );
    const frames = frameScheduler();
    try {
      const view = render(
        <ModelWorkspaceSurface
          bindings={session}
          panels={{ "test.panel": { render: ({ panel }) => <div>{panel.title}</div> } }}
          layoutBounds={modelBounds}
          motion="off"
          frameScheduler={frames.scheduler}
        />,
      );
      const splitter = required(
        view.container.querySelector<HTMLElement>("[data-workspace-splitter]"),
      );
      const sizes = () =>
        Array.from(
          view.container.querySelectorAll<HTMLElement>("[data-workspace-split-child]"),
        ).map((child) => Number(child.dataset.inlineSize));
      const start = Number(splitter.dataset.inlineStart);
      const revision = session.runtime.getSnapshot().revision;
      expect(fireEvent.keyDown(splitter, { key: "Home" })).toBe(true);
      expect(fireEvent.keyDown(splitter, { key: "End" })).toBe(true);
      expect(session.runtime.getSnapshot().revision).toBe(revision);
      expect(splitter.getAttribute("aria-valuemin")).toBe("0");
      expect(splitter.getAttribute("aria-valuemax")).toBe("100");
      fireEvent.pointerDown(splitter, { button: 0, pointerId: 21, clientX: start });
      fireEvent.pointerMove(splitter, { pointerId: 21, clientX: start + 30 });
      act(() => frames.flush());
      const preview = sizes();
      fireEvent.pointerUp(splitter, { pointerId: 21, clientX: start + 30 });
      expect(sizes()).toEqual(preview);
      view.unmount();
    } finally {
      session.dispose();
    }
  });

  it.each([
    { name: "growth factors", constraints: [{ grow: 2 }, {}, {}] },
    {
      name: "shrink factors",
      constraints: [
        { shrink: 2, preferredInline: 600 },
        { preferredInline: 600 },
        { preferredInline: 600 },
      ],
    },
    {
      name: "fractional bounds",
      constraints: [{ hardMinInline: 100.25, maxInline: 600.75 }, { hardMinInline: 100.25 }, {}],
    },
  ])("preserves preview, siblings and history with $name", ({ constraints }) => {
    const session = createModelWorkspaceSession({ initialSnapshot: fixture(constraints) });
    const frames = frameScheduler();
    try {
      const view = render(
        <ModelWorkspaceSurface
          bindings={session}
          panels={{ "test.panel": { render: ({ panel }) => <div>{panel.title}</div> } }}
          layoutBounds={modelBounds}
          motion="off"
          resizePreviewMode="live"
          frameScheduler={frames.scheduler}
        />,
      );
      const splitter = required(
        view.container.querySelector<HTMLElement>("[data-workspace-splitter]"),
      );
      const children = ["a", "b", "c"].map((id) =>
        required(
          view.container.querySelector<HTMLElement>(`[data-workspace-split-child="${id}-node"]`),
        ),
      );
      const sizes = () => children.map((child) => Number(child.dataset.inlineSize));
      const initial = sizes();
      const initialRevision = session.runtime.getSnapshot().revision;
      const start = Number(splitter.dataset.inlineStart);

      fireEvent.pointerDown(splitter, { button: 0, pointerId: 31, clientX: start });
      fireEvent.pointerMove(splitter, { pointerId: 31, clientX: start + 30 });
      act(() => frames.flush());
      const preview = sizes();
      expect(preview).toEqual([required(initial[0]) + 30, required(initial[1]) - 30, initial[2]]);
      expect(session.runtime.getSnapshot().revision).toBe(initialRevision);

      fireEvent.pointerUp(splitter, { pointerId: 31, clientX: start + 30 });
      expect(sizes()).toEqual(preview);
      expect(session.runtime.canUndo()).toBe(true);
      act(() => {
        session.runtime.undo();
      });
      expect(sizes()).toEqual(initial);
      act(() => {
        session.runtime.redo();
      });
      expect(sizes()).toEqual(preview);

      // A second gesture must start from the visible dimensions, not an old
      // unconstrained weight ratio, and still leave the third pane untouched.
      const secondStart = Number(splitter.dataset.inlineStart);
      fireEvent.pointerDown(splitter, { button: 0, pointerId: 32, clientX: secondStart });
      fireEvent.pointerUp(splitter, { pointerId: 32, clientX: secondStart - 10 });
      expect(sizes()).toEqual([required(preview[0]) - 10, required(preview[1]) + 10, initial[2]]);
      view.unmount();
    } finally {
      session.dispose();
    }
  });

  it("advertises and reaches constrained limits without creating repeat history", () => {
    const session = createModelWorkspaceSession({
      initialSnapshot: fixture([{ grow: 2 }, {}, {}]),
    });
    try {
      const view = render(
        <ModelWorkspaceSurface
          bindings={session}
          panels={{ "test.panel": { render: ({ panel }) => <div>{panel.title}</div> } }}
          layoutBounds={modelBounds}
          motion="off"
        />,
      );
      const splitter = required(
        view.container.querySelector<HTMLElement>("[data-workspace-splitter]"),
      );
      const a = required(
        view.container.querySelector<HTMLElement>('[data-workspace-split-child="a-node"]'),
      );
      const b = required(
        view.container.querySelector<HTMLElement>('[data-workspace-split-child="b-node"]'),
      );
      const c = required(
        view.container.querySelector<HTMLElement>('[data-workspace-split-child="c-node"]'),
      );
      const pairSize = Number(a.dataset.inlineSize) + Number(b.dataset.inlineSize);
      const thirdSize = c.dataset.inlineSize;
      const percent = (value: number) => String(Math.round((value / pairSize) * 10_000) / 100);
      expect(splitter.getAttribute("aria-valuemin")).toBe(percent(100));
      expect(splitter.getAttribute("aria-valuemax")).toBe(percent(pairSize - 100));
      fireEvent.keyDown(splitter, { key: "Home" });
      expect(a.dataset.inlineSize).toBe("100");
      expect(c.dataset.inlineSize).toBe(thirdSize);
      expect(splitter.getAttribute("aria-valuenow")).toBe(splitter.getAttribute("aria-valuemin"));
      const revisionAtHome = session.runtime.getSnapshot().revision;
      fireEvent.keyDown(splitter, { key: "Home" });
      fireEvent.keyDown(splitter, { key: "ArrowLeft" });
      expect(session.runtime.getSnapshot().revision).toBe(revisionAtHome);
      fireEvent.keyDown(splitter, { key: "End" });
      expect(b.dataset.inlineSize).toBe("100");
      expect(c.dataset.inlineSize).toBe(thirdSize);
      expect(splitter.getAttribute("aria-valuenow")).toBe(splitter.getAttribute("aria-valuemax"));
      view.unmount();
    } finally {
      session.dispose();
    }
  });
});
