import {
  MemoryPersistencePort,
  MemoryWorkspaceJournalPort,
  type PersistencePort,
  type PersistenceRecord,
} from "@panefold/runtime";
import { Effect } from "effect";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  IndexedDbWorkspaceJournalPort,
  JournalFailure,
  PersistenceFailure,
  fromPersistencePort,
  fromEffectPostCommitHandler,
  fromWorkspaceJournalPort,
} from "../src";

const record: PersistenceRecord = {
  formatVersion: 1,
  revision: "7",
  checksum: "test:checksum",
  payload: new Uint8Array([1, 2, 3]),
};

describe("Effect persistence adapter", () => {
  it("wraps the driver without exposing Effect to the semantic runtime", async () => {
    const adapter = fromPersistencePort(new MemoryPersistencePort());

    await Effect.runPromise(adapter.save("workspace", record));
    const loaded = await Effect.runPromise(adapter.load("workspace"));
    expect(loaded).toEqual(record);
    expect(loaded?.payload).not.toBe(record.payload);
    await Effect.runPromise(adapter.remove("workspace"));
    expect(await Effect.runPromise(adapter.load("workspace"))).toBeUndefined();
  });

  it("maps operational failures to a typed error", async () => {
    const failingPort: PersistencePort = {
      load: async () => {
        throw new Error("offline");
      },
      save: async () => undefined,
      remove: async () => undefined,
    };
    const failure = await Effect.runPromise(
      Effect.flip(fromPersistencePort(failingPort).load("workspace")),
    );

    expect(failure).toBeInstanceOf(PersistenceFailure);
    expect(failure.operation).toBe("load");
    expect(failure.cause).toEqual(new Error("offline"));
  });
});

describe("Effect post-commit adapter", () => {
  it("keeps success, failure, and cancellation behind the Effect boundary", async () => {
    const seen: string[] = [];
    const controller = new AbortController();
    const port = fromEffectPostCommitHandler({
      deliver: ({ intent, signal }) =>
        Effect.sync(() => {
          expect(signal).toBe(controller.signal);
          seen.push(intent.id);
        }),
    });
    const intent = {
      id: "effect:test" as never,
      kind: "transaction-committed" as const,
      class: "post-commit-idempotent" as const,
      transactionId: "command:test" as never,
      previousRevision: 0n as never,
      revision: 1n as never,
      ordinal: 0,
      payload: { commandType: "select-panel" as const, origin: "application" as const },
    };
    const delivery = {
      intent,
      transaction: {
        id: intent.transactionId,
        origin: "application",
        label: "Test",
        previousRevision: intent.previousRevision,
        revision: intent.revision,
        command: { type: "select-panel", panelId: "panel:test" as never },
        patches: [],
        effects: [intent],
      },
      attempt: 1,
      signal: controller.signal,
    } as const;
    await port.deliver(delivery);

    expect(seen).toEqual([intent.id]);

    const failure = new Error("typed Effect failure");
    const failingPort = fromEffectPostCommitHandler({
      deliver: () => Effect.fail(failure),
    });
    await expect(failingPort.deliver(delivery)).rejects.toThrow("typed Effect failure");

    const cancellation = new AbortController();
    const neverPort = fromEffectPostCommitHandler({ deliver: () => Effect.never });
    const cancelled = neverPort.deliver({ ...delivery, signal: cancellation.signal });
    cancellation.abort(new Error("delivery cancelled"));
    await expect(cancelled).rejects.toThrow();
  });
});

describe("Effect journal and IndexedDB adapter", () => {
  it("persists one atomic bundle through an injected IndexedDB factory", async () => {
    const indexedDB = new IDBFactory();
    const port = new IndexedDbWorkspaceJournalPort({
      indexedDB,
      databaseName: "panefold-test",
      storeName: "journals",
    });

    await port.commit("workspace", {
      checkpointWrites: [
        {
          ref: "checkpoint:one",
          panelType: "test.panel",
          typeVersion: 1,
          value: { text: "durable" },
          checksum: "sha256:test",
        },
      ],
      requiredCheckpointRefs: ["checkpoint:one"],
    });

    expect(await port.read("workspace")).toMatchObject({
      journal: [],
      checkpoints: { "checkpoint:one": { value: { text: "durable" } } },
    });
    await port.clear("workspace");
    expect(await port.read("workspace")).toBeUndefined();
    await port.close();
  });

  it("wraps journal operations in typed Effect failures", async () => {
    const adapter = fromWorkspaceJournalPort(
      new MemoryWorkspaceJournalPort({
        beforeStep: (step) => {
          if (step === "read") throw new Error("storage offline");
        },
      }),
    );

    const failure = await Effect.runPromise(Effect.flip(adapter.read("workspace")));
    expect(failure).toBeInstanceOf(JournalFailure);
    expect(failure.operation).toBe("read");
  });
});
