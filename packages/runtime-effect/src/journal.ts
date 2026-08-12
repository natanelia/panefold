import type {
  StoredWorkspaceBundle,
  WorkspaceJournalCommit,
  WorkspaceJournalPort,
} from "@panefold/runtime";
import { Effect } from "effect";

export class JournalFailure {
  readonly _tag = "JournalFailure";

  public constructor(
    readonly operation: "read" | "commit" | "clear",
    readonly cause: unknown,
  ) {}
}

export interface EffectWorkspaceJournal {
  read(key: string): Effect.Effect<StoredWorkspaceBundle | undefined, JournalFailure>;
  commit(key: string, commit: WorkspaceJournalCommit): Effect.Effect<void, JournalFailure>;
  clear(key: string): Effect.Effect<void, JournalFailure>;
}

export function fromWorkspaceJournalPort(port: WorkspaceJournalPort): EffectWorkspaceJournal {
  return {
    read: (key) =>
      Effect.tryPromise({
        try: () => port.read(key),
        catch: (cause) => new JournalFailure("read", cause),
      }).pipe(Effect.withSpan("panefold.persistence.read")),
    commit: (key, commit) =>
      Effect.tryPromise({
        try: () => port.commit(key, commit),
        catch: (cause) => new JournalFailure("commit", cause),
      }).pipe(Effect.withSpan("panefold.persistence.commit")),
    clear: (key) =>
      Effect.tryPromise({
        try: () => port.clear(key),
        catch: (cause) => new JournalFailure("clear", cause),
      }).pipe(Effect.withSpan("panefold.persistence.clear")),
  };
}
