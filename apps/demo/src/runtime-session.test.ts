import { describe, expect, it } from "vitest";

import { createDemoWorkspaceDisposal, demoWorkspaceMigrations } from "./runtime-session";

describe("demo workspace disposal", () => {
  it("awaits a snapshot of registered recovery work before flushing and closing resources", async () => {
    const events: string[] = [];
    const lifecycle = createDemoWorkspaceDisposal({
      durable: {
        async flush() {
          events.push("flush");
        },
        async dispose() {
          events.push("durable.dispose");
        },
      },
      runtime: {
        dispose() {
          events.push("runtime.dispose");
        },
      },
      async closeJournal() {
        events.push("journal.close");
      },
    });

    lifecycle.registerBeforeDispose(async () => {
      events.push("recovery.start");
      await Promise.resolve();
      events.push("recovery.end");
    });
    lifecycle.registerBeforeDispose(() => {
      events.push("checkpoint");
    });
    const unregister = lifecycle.registerBeforeDispose(() => {
      events.push("removed");
    });
    unregister();

    const first = lifecycle.dispose();
    const second = lifecycle.dispose();
    expect(second).toBe(first);
    await first;

    expect(events).toEqual([
      "recovery.start",
      "recovery.end",
      "checkpoint",
      "flush",
      "durable.dispose",
      "runtime.dispose",
      "journal.close",
    ]);
    expect(() => lifecycle.registerBeforeDispose(() => undefined)).toThrow(
      "after disposal has started",
    );
  });

  it("migrates persisted Atlas-era titles into the code workbench without changing IDs", () => {
    const migration = demoWorkspaceMigrations[0];
    expect(migration).toBeDefined();
    const migrated = migration?.migrate({
      applicationLayoutVersion: 1,
      panels: {
        ids: ["map-canvas", "notes"],
        byId: {
          "map-canvas": { id: "map-canvas", title: "Map Canvas" },
          notes: { id: "notes", title: "Notes" },
        },
      },
      recoverableClosedPanels: [{ id: "closed:notes", panel: { id: "notes", title: "Notes" } }],
      metadata: { name: "One-North route review", locale: "en-SG" },
    }) as {
      readonly applicationLayoutVersion: number;
      readonly panels: { readonly byId: Readonly<Record<string, { readonly title: string }>> };
      readonly recoverableClosedPanels: readonly {
        readonly panel: { readonly title: string };
      }[];
      readonly metadata: Readonly<Record<string, unknown>>;
    };

    expect(migrated.applicationLayoutVersion).toBe(2);
    expect(migrated.panels.byId["map-canvas"]?.title).toBe("App.tsx");
    expect(migrated.panels.byId.notes?.title).toBe("workspace.ts");
    expect(migrated.recoverableClosedPanels[0]?.panel.title).toBe("workspace.ts");
    expect(migrated.metadata).toMatchObject({
      locale: "en-US",
      name: "panefold-demo",
      product: "Panefold Code",
    });
  });

  it("closes every resource and reports all failures", async () => {
    const events: string[] = [];
    const cleanupError = new Error("recovery failed");
    const flushError = new Error("flush failed");
    const closeError = new Error("close failed");
    const lifecycle = createDemoWorkspaceDisposal({
      durable: {
        async flush() {
          events.push("flush");
          throw flushError;
        },
        async dispose() {
          events.push("durable.dispose");
        },
      },
      runtime: {
        dispose() {
          events.push("runtime.dispose");
        },
      },
      async closeJournal() {
        events.push("journal.close");
        throw closeError;
      },
    });
    lifecycle.registerBeforeDispose(() => {
      events.push("recovery");
      throw cleanupError;
    });
    lifecycle.registerBeforeDispose(() => {
      events.push("later recovery");
    });

    const failure = await lifecycle.dispose().catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([cleanupError, flushError, closeError]);
    expect(events).toEqual([
      "recovery",
      "later recovery",
      "flush",
      "durable.dispose",
      "runtime.dispose",
      "journal.close",
    ]);
  });
});
