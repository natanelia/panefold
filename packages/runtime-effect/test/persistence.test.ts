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
