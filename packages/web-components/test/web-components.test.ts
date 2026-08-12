// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { WorkspaceElementNotConnectedError, definePanefoldWorkspaceElement } from "../src";

import {
  FrameworkFixtureRuntime,
  type FrameworkFixtureCommand,
  type FrameworkFixtureSnapshot,
} from "../../adapter-contract/test/framework-fixture";

describe("Web Components adapter", () => {
  it("defines a real custom element with connect/disconnect lifecycle", () => {
    const runtime = new FrameworkFixtureRuntime();
    const name = "panefold-test-workspace";
    const ElementConstructor = definePanefoldWorkspaceElement<
      FrameworkFixtureSnapshot,
      FrameworkFixtureCommand,
      FrameworkFixtureSnapshot
    >({ name });
    const element = new ElementConstructor();
    element.workspaceSource = runtime;
    const snapshots: unknown[] = [];
    element.addEventListener("panefold-snapshot", (event) => {
      snapshots.push(event);
    });
    document.body.append(element);
    expect(element.getAttribute("data-panefold-state")).toBe("connected");
    element.dispatchWorkspaceCommand({ selected: "element" });
    expect(element.getAttribute("data-panefold-revision")).toBe("1");
    expect(snapshots).toHaveLength(1);
    expect(runtime.listenerCount).toBe(1);

    element.remove();
    expect(runtime.listenerCount).toBe(0);
    expect(() => element.dispatchWorkspaceCommand({ selected: "disconnected" })).toThrow(
      WorkspaceElementNotConnectedError,
    );
  });

  it("can be imported without reading browser globals until definition", async () => {
    expect(await import("../src")).toHaveProperty("createPanefoldWorkspaceElementClass");
  });
});
