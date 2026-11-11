// @vitest-environment jsdom
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SurfaceFrameScheduler } from "@panefold/motion";
import { FloatingSurfaceFrame, useFloatingSurfaceHeaderSlot } from "../src/floating-surface";
import { ENGLISH_WORKSPACE_MESSAGES, resolveWorkspaceInteractionMessages } from "../src/messages";

afterEach(cleanup);

function HeaderTab({ navigate }: { readonly navigate: () => void }) {
  const slot = useFloatingSurfaceHeaderSlot("tools");
  return slot
    ? createPortal(
        <div className="pf-tab-strip">
          <button type="button" onKeyDown={navigate}>
            Notes tab
          </button>
        </div>,
        slot,
      )
    : null;
}
function setup(options: { readonly active?: boolean; readonly frontmost?: boolean } = {}) {
  const move = vi.fn(() => ({ status: "committed" as const }));
  const resize = vi.fn(() => ({ status: "committed" as const }));
  const raise = vi.fn();
  const maximize = vi.fn(() => ({ status: "committed" as const }));
  const navigate = vi.fn();
  const bounds = { x: 100, y: 80, width: 320, height: 240 };
  const view = render(
    <FloatingSurfaceFrame
      surface={{ id: "float", rootNodeId: "tools-node", bounds, maximized: false }}
      compactGroupId="tools"
      bounds={bounds}
      projectionRevision="0"
      title="Tools"
      active={options.active ?? true}
      frontmost={options.frontmost ?? true}
      zIndex={1}
      viewportWidth={800}
      viewportHeight={600}
      scheduler={new SurfaceFrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} })}
      scheduleKey="test-float"
      messages={resolveWorkspaceInteractionMessages(ENGLISH_WORKSPACE_MESSAGES)}
      onMove={move}
      onResize={resize}
      onRaise={raise}
      onMaximize={maximize}
    >
      <HeaderTab navigate={navigate} />
    </FloatingSurfaceFrame>,
  );
  const titlebar = view.container.querySelector<HTMLElement>(".pf-floating-titlebar");
  const rightHandle = view.container.querySelector<HTMLElement>('[data-resize-edge="right"]');
  if (!titlebar) throw new Error("Missing titlebar");
  if (!rightHandle) throw new Error("Missing resize handle");
  return { ...view, move, resize, raise, maximize, navigate, titlebar, rightHandle };
}

describe("floating titlebar event boundaries", () => {
  it("keeps tab navigation separate from keyboard window movement", () => {
    const { move, navigate, titlebar } = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Notes tab" }), { key: "ArrowRight" });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(move).not.toHaveBeenCalled();
    fireEvent.keyDown(titlebar, { key: "ArrowRight" });
    expect(move).toHaveBeenCalledExactlyOnceWith(
      { x: 108, y: 80, width: 320, height: 240 },
      "keyboard",
    );
  });
  it("does not move a window when an arrow key is pressed on a titlebar button", () => {
    const { move } = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Maximize Tools floating window" }), {
      key: "ArrowRight",
    });
    expect(move).not.toHaveBeenCalled();
  });
  it("does not treat a button double-click as a titlebar double-click", () => {
    const { maximize, titlebar } = setup();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Maximize Tools floating window" }));
    expect(maximize).not.toHaveBeenCalled();
    fireEvent.doubleClick(titlebar);
    expect(maximize).toHaveBeenCalledExactlyOnceWith("pointer");
  });
});

describe("floating keyboard commands", () => {
  for (const mode of ["move", "resize"] as const) {
    it.each([
      ["Alt", { altKey: true }],
      ["Ctrl", { ctrlKey: true }],
      ["Meta", { metaKey: true }],
      ["IME composition", { isComposing: true }],
    ] as const)(`leaves %s keys available during keyboard ${mode}`, (_name, options) => {
      const fixture = setup({ active: false, frontmost: false });
      const target = mode === "move" ? fixture.titlebar : fixture.rightHandle;
      for (const key of ["ArrowRight", "Enter", " "]) {
        expect(fireEvent.keyDown(target, { key, ...options })).toBe(true);
      }
      expect(fixture.move).not.toHaveBeenCalled();
      expect(fixture.resize).not.toHaveBeenCalled();
      expect(fixture.raise).not.toHaveBeenCalled();
    });

    it(`respects keys already claimed by the application during keyboard ${mode}`, () => {
      const fixture = setup({ active: false, frontmost: false });
      const target = mode === "move" ? fixture.titlebar : fixture.rightHandle;
      for (const key of ["ArrowRight", "Enter", " "]) {
        target.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
        fireEvent.keyDown(target, { key });
      }
      expect(fixture.move).not.toHaveBeenCalled();
      expect(fixture.resize).not.toHaveBeenCalled();
      expect(fixture.raise).not.toHaveBeenCalled();
    });

    it.each([false, true])(`preserves the Shift=%s keyboard ${mode} step`, (shiftKey) => {
      const fixture = setup();
      const target = mode === "move" ? fixture.titlebar : fixture.rightHandle;
      expect(fireEvent.keyDown(target, { key: "ArrowRight", shiftKey })).toBe(false);
      expect(mode === "move" ? fixture.move : fixture.resize).toHaveBeenCalledExactlyOnceWith(
        {
          x: mode === "move" ? (shiftKey ? 132 : 108) : 100,
          y: 80,
          width: mode === "resize" ? (shiftKey ? 352 : 328) : 320,
          height: 240,
        },
        "keyboard",
      );
      expect(mode === "move" ? fixture.resize : fixture.move).not.toHaveBeenCalled();
    });
  }

  it("keeps descendant keys and perpendicular arrows out of resize commands", () => {
    const { rightHandle, resize } = setup();
    const input = document.createElement("input");
    rightHandle.append(input);
    expect(fireEvent.keyDown(input, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(rightHandle, { key: "ArrowDown" })).toBe(true);
    expect(resize).not.toHaveBeenCalled();
  });

  it.each(["Enter", " "])("still raises an inactive floating frame with %s", (key) => {
    const { titlebar, raise, move, resize } = setup({ active: false, frontmost: false });
    expect(fireEvent.keyDown(titlebar, { key })).toBe(false);
    expect(raise).toHaveBeenCalledExactlyOnceWith("keyboard");
    expect(move).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });

  it("does not raise an inactive floating frame from the keyboard during a pointer gesture", () => {
    const { titlebar, raise, move, resize } = setup({ active: false, frontmost: false });
    fireEvent.pointerDown(titlebar, { button: 0, pointerId: 11, clientX: 100, clientY: 80 });
    for (const key of ["Enter", " "]) {
      expect(fireEvent.keyDown(titlebar, { key })).toBe(true);
    }
    expect(raise).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    fireEvent.pointerCancel(titlebar, { pointerId: 11 });
    expect(fireEvent.keyDown(titlebar, { key: "Enter" })).toBe(false);
    expect(raise).toHaveBeenCalledExactlyOnceWith("keyboard");
  });
});
