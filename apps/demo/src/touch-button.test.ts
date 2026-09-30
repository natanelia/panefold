// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TouchButton } from "./TouchButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(disabled = false) {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const press = vi.fn();
  const view = render(createElement(TouchButton, { onClick: press, disabled }, "Arrange"));
  const button = view.getByRole("button");
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 50, 50));
  const pointer = (type: string, x = 25, y = 25, pointerType = "touch") => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
      isPrimary: { value: true },
    });
    fireEvent(button, event);
  };
  return { press, button, pointer };
}

describe("touch button activation", () => {
  it("activates on release even when the browser omits a later compatibility click", () => {
    const { press, pointer } = setup();
    pointer("pointerdown");
    expect(press).not.toHaveBeenCalled();
    pointer("pointerup");
    expect(press).toHaveBeenCalledTimes(1);
  });
  it("does not double activate when a compatibility click follows release", () => {
    const { press, pointer, button } = setup();
    pointer("pointerdown");
    pointer("pointerup");
    fireEvent.click(button, { detail: 1 });
    expect(press).toHaveBeenCalledTimes(1);
    pointer("pointerdown");
    pointer("pointerup");
    fireEvent.click(button, { detail: 1 });
    expect(press).toHaveBeenCalledTimes(2);
  });
  it("preserves keyboard and mouse activation", () => {
    const { press, pointer, button } = setup();
    pointer("pointerdown");
    pointer("pointerup");
    fireEvent.click(button, { detail: 0 });
    pointer("pointerdown", 25, 25, "mouse");
    pointer("pointerup", 25, 25, "mouse");
    fireEvent.click(button, { detail: 1 });
    expect(press).toHaveBeenCalledTimes(3);
  });
  it("does not activate a swipe, cancellation, or release outside the button", () => {
    const { press, pointer, button } = setup();
    pointer("pointerdown");
    pointer("pointermove", 40);
    pointer("pointerup");
    fireEvent.click(button, { detail: 1 });
    pointer("pointerdown");
    pointer("pointercancel");
    pointer("pointerup");
    fireEvent.click(button, { detail: 1 });
    pointer("pointerdown");
    pointer("pointerup", 60);
    fireEvent.click(button, { detail: 1 });
    expect(press).not.toHaveBeenCalled();
  });
  it("does not activate disabled controls", () => {
    const { press, pointer, button } = setup(true);
    pointer("pointerdown");
    pointer("pointerup");
    fireEvent.click(button);
    expect(press).not.toHaveBeenCalled();
  });
});
