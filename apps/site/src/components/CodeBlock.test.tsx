import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

afterEach(cleanup);
describe("copyable examples", () => {
  it("copies exact code and only reports success after the write resolves", async () => {
    let finish: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodeBlock code={'const value = "real code";\n'} language="ts" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith('const value = "real code";\n');
    expect(screen.queryByRole("button", { name: "Code copied" })).toBeNull();
    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Code copied" })).toBeTruthy());
  });
  it("gives a manual fallback when clipboard permission is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<CodeBlock code="still selectable" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Copy failed"));
    expect(screen.getByText("still selectable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Code copied" })).toBeNull();
  });
});
