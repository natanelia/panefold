import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import { createPanefoldWorkspaceStore } from "../src";

import { FrameworkFixtureRuntime } from "../../adapter-contract/test/framework-fixture";

describe("Svelte adapter", () => {
  it("implements a native readable store and explicit disposal", () => {
    const runtime = new FrameworkFixtureRuntime();
    const store = createPanefoldWorkspaceStore(runtime);
    expect(get(store).selected).toBe("alpha");
    store.dispatch({ selected: "svelte" });
    expect(get(store).selected).toBe("svelte");
    store.dispose();
    expect(runtime.listenerCount).toBe(0);
  });
});
