import { describe, expect, it } from "vitest";

describe("Web Components SSR import", () => {
  it("does not require HTMLElement or customElements at module evaluation", async () => {
    expect(typeof document).toBe("undefined");
    const module = await import("../src");
    expect(module).toHaveProperty("createPanefoldWorkspaceElementClass");
    expect(module).toHaveProperty("definePanefoldWorkspaceElement");
  });
});
