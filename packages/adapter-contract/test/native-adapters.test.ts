// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createPanefoldAngularBinding } from "../../angular/src";
import { createPanefoldWorkspaceStore } from "../../svelte/src";
import { createPanefoldVueBinding } from "../../vue/src";
import { definePanefoldWorkspaceElement } from "../../web-components/src";
import { certifyWorkspaceAdapter, type WorkspaceAdapterPort } from "../src";

import {
  FrameworkFixtureRuntime,
  type FrameworkFixtureCommand,
  type FrameworkFixtureSnapshot,
} from "./framework-fixture";

type FixturePort = WorkspaceAdapterPort<
  FrameworkFixtureSnapshot,
  FrameworkFixtureCommand,
  FrameworkFixtureSnapshot,
  unknown
>;

interface NativeAdapterFixture {
  readonly port: FixturePort;
  readonly dispose: () => void;
}

describe("native adapter shared task", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly create: (runtime: FrameworkFixtureRuntime) => NativeAdapterFixture;
  }> = [
    {
      name: "Vue shallow ref",
      create: (runtime) => {
        const binding = createPanefoldVueBinding(runtime);
        return { port: binding.port as FixturePort, dispose: binding.dispose };
      },
    },
    {
      name: "Svelte readable store",
      create: (runtime) => {
        const store = createPanefoldWorkspaceStore(runtime);
        return { port: store.port as FixturePort, dispose: store.dispose };
      },
    },
    {
      name: "Angular native signal",
      create: (runtime) => {
        const binding = createPanefoldAngularBinding(runtime);
        return { port: binding.port as FixturePort, dispose: binding.dispose };
      },
    },
    {
      name: "custom element lifecycle",
      create: (runtime) => {
        const name = "panefold-shared-task-workspace";
        const ElementConstructor = definePanefoldWorkspaceElement<
          FrameworkFixtureSnapshot,
          FrameworkFixtureCommand,
          FrameworkFixtureSnapshot
        >({ name });
        const element = new ElementConstructor();
        element.workspaceSource = runtime;
        document.body.append(element);
        const port = element.workspacePort;
        if (port === undefined)
          throw new Error("Custom element did not connect its workspace port");
        return { port: port as FixturePort, dispose: () => element.remove() };
      },
    },
  ];

  for (const adapterCase of cases) {
    it(`${adapterCase.name} preserves the shared snapshot/dispatch/unsubscribe contract`, () => {
      const runtime = new FrameworkFixtureRuntime();
      const fixture = adapterCase.create(runtime);
      let sequence = 0;
      const evidence = certifyWorkspaceAdapter(fixture.port, () => {
        sequence += 1;
        fixture.port.dispatch({ selected: `shared-${String(sequence)}` });
      });
      expect(evidence.passed).toBe(true);
      fixture.dispose();
      expect(runtime.listenerCount).toBe(0);
    });
  }
});
