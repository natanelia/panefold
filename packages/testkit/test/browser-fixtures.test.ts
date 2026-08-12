// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createTestPanelFixture, TEST_PANEL_FIXTURES } from "../src";

describe("browser panel fixtures", () => {
  it("mounts every normative fixture except the intentional renderer failure", async () => {
    for (const definition of TEST_PANEL_FIXTURES) {
      const fixture = createTestPanelFixture(document, definition.kind, { slowResizeMs: 0 });
      const host = document.createElement("div");
      if (definition.kind === "throwing-renderer") {
        expect(() => fixture.mount(host)).toThrow("Synthetic renderer failure");
        fixture.dispose();
        continue;
      }
      fixture.mount(host);
      expect(host.querySelector(`[data-panefold-test-fixture="${definition.kind}"]`)).toBe(
        fixture.element,
      );
      await fixture.resize(640, 360);
      fixture.setLifecycle("suspended");
      expect(fixture.element.hasAttribute("inert")).toBe(true);
      fixture.setLifecycle("active");
      expect(fixture.metrics()).toMatchObject({
        mountCount: 1,
        resizeCount: 1,
        lifecycleCount: 2,
        disposed: false,
      });
      fixture.dispose();
      expect(fixture.metrics()).toMatchObject({ resourceCount: 0, disposed: true });
      expect(host.children).toHaveLength(0);
    }
  });

  it("models guarded close, corrupt restore, and stable host identity", async () => {
    const guard = createTestPanelFixture(document, "async-close-guard");
    guard.mount(document.body);
    expect(await guard.prepareClose()).toBe(false);
    const checkbox = guard.element.querySelector("input");
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("missing close guard");
    checkbox.click();
    expect(await guard.prepareClose()).toBe(true);

    const corrupt = createTestPanelFixture(document, "corrupt-checkpoint");
    expect(() => corrupt.restore({ schemaVersion: 1, kind: "corrupt-checkpoint" })).toThrow(
      /corrupt/u,
    );

    const editor = createTestPanelFixture(document, "code-editor");
    const first = document.createElement("div");
    const second = document.createElement("div");
    editor.mount(first);
    const identity = editor.element;
    editor.mount(second);
    expect(editor.element).toBe(identity);
    expect(first.children).toHaveLength(0);
    expect(second.firstElementChild).toBe(identity);
    editor.dispose();
    guard.dispose();
    corrupt.dispose();
  });

  it("returns fixture-owned resources to baseline after 10,000 lifecycle cycles", async () => {
    const fixture = createTestPanelFixture(document, "suspendable");
    const first = document.createElement("div");
    const second = document.createElement("div");
    fixture.mount(first);
    for (let cycle = 0; cycle < 10_000; cycle += 1) {
      fixture.setLifecycle(cycle % 2 === 0 ? "suspended" : "active");
      fixture.mount(cycle % 2 === 0 ? second : first);
      await fixture.resize(640 + (cycle % 3), 360);
    }
    expect(fixture.metrics()).toMatchObject({
      mountCount: 1,
      lifecycleCount: 10_000,
      resizeCount: 10_000,
      resourceCount: 1,
    });
    fixture.dispose();
    expect(fixture.metrics()).toMatchObject({ resourceCount: 0, disposed: true });
    expect(first.children).toHaveLength(0);
    expect(second.children).toHaveLength(0);
  });
});
