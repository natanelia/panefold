import { effectScope } from "vue";
import { describe, expect, it } from "vitest";

import { usePanefoldWorkspace } from "../src";

import { FrameworkFixtureRuntime } from "../../adapter-contract/test/framework-fixture";

describe("Vue adapter", () => {
  it("updates a shallow ref and detaches with its effect scope", () => {
    const runtime = new FrameworkFixtureRuntime();
    const scope = effectScope();
    const binding = scope.run(() => usePanefoldWorkspace(runtime));
    if (binding === undefined) throw new Error("Vue effect scope did not return a binding");

    binding.dispatch({ selected: "vue" });
    expect(binding.snapshot.value.selected).toBe("vue");
    expect(runtime.listenerCount).toBe(1);
    scope.stop();
    expect(runtime.listenerCount).toBe(0);
  });
});
