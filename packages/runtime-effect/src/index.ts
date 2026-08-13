import type { PersistencePort, PersistenceRecord } from "@panefold/runtime";
import { Effect } from "effect";

export * from "./indexeddb";
export * from "./journal";
export * from "./post-commit-effects";

export class PersistenceFailure {
  readonly _tag = "PersistenceFailure";

  public constructor(
    readonly operation: "load" | "save" | "remove",
    readonly cause: unknown,
  ) {}
}

export interface EffectPersistence {
  load(key: string): Effect.Effect<PersistenceRecord | undefined, PersistenceFailure>;
  save(key: string, record: PersistenceRecord): Effect.Effect<void, PersistenceFailure>;
  remove(key: string): Effect.Effect<void, PersistenceFailure>;
}

/**
 * Keeps Effect at the fallible operational boundary. Ordinary workspace reads
 * and semantic commits remain synchronous and do not enter the fiber scheduler.
 */
export function fromPersistencePort(port: PersistencePort): EffectPersistence {
  return {
    load: (key) =>
      Effect.tryPromise({
        try: () => port.load(key),
        catch: (cause) => new PersistenceFailure("load", cause),
      }),
    save: (key, record) =>
      Effect.tryPromise({
        try: () => port.save(key, record),
        catch: (cause) => new PersistenceFailure("save", cause),
      }),
    remove: (key) =>
      Effect.tryPromise({
        try: () => port.remove(key),
        catch: (cause) => new PersistenceFailure("remove", cause),
      }),
  };
}
