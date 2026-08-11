import {
  MemoryPersistencePort,
  type PersistencePort,
  type PersistenceRecord,
} from "@panefold/runtime";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { PersistenceFailure, fromPersistencePort } from "../src";

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
