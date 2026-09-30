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
function setup() {
  const move = vi.fn(() => ({ status: "committed" as const }));
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
      active
      frontmost
      zIndex={1}
      viewportWidth={800}
      viewportHeight={600}
      scheduler={new SurfaceFrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} })}
      scheduleKey="test-float"
      messages={resolveWorkspaceInteractionMessages(ENGLISH_WORKSPACE_MESSAGES)}
      onMove={move}
      onMaximize={maximize}
    >
      <HeaderTab navigate={navigate} />
    </FloatingSurfaceFrame>,
  );
  const titlebar = view.container.querySelector(".pf-floating-titlebar");
  if (!titlebar) throw new Error("Missing titlebar");
  return { move, maximize, navigate, titlebar };
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
