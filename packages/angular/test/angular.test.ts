import {
  createEnvironmentInjector,
  runInInjectionContext,
  type EnvironmentInjector,
} from "@angular/core";
import { describe, expect, it } from "vitest";

import { injectPanefoldWorkspace, providePanefoldWorkspace } from "../src";

import { FrameworkFixtureRuntime } from "../../adapter-contract/test/framework-fixture";

describe("Angular adapter", () => {
  it("updates a native signal and detaches through DestroyRef", () => {
    const runtime = new FrameworkFixtureRuntime();
    const injector = createEnvironmentInjector(
      [providePanefoldWorkspace(runtime)],
      null as unknown as EnvironmentInjector,
    );
    const binding = runInInjectionContext(injector, () =>
      injectPanefoldWorkspace<
        ReturnType<FrameworkFixtureRuntime["getSnapshot"]>,
        Parameters<FrameworkFixtureRuntime["dispatch"]>[0],
        ReturnType<FrameworkFixtureRuntime["dispatch"]>
      >(),
    );
    binding.dispatch({ selected: "angular" });
    expect(binding.snapshot().selected).toBe("angular");
    expect(runtime.listenerCount).toBe(1);
    injector.destroy();
    expect(runtime.listenerCount).toBe(0);
  });
});
