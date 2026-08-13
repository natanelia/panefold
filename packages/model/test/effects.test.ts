import { describe, expect, it } from "vitest";

import {
  commandId,
  createTransactionCommittedEffectIntent,
  effectIntentId,
  revision,
  type CommandOrigin,
  type WorkspaceCommandType,
} from "../src/index";

const baseInput = {
  transactionId: commandId("transaction:select"),
  previousRevision: revision(4),
  revision: revision(5),
  ordinal: 0,
  commandType: "select-panel",
  origin: "application",
} as const;

describe("post-commit effect intent identity", () => {
  it("creates a deterministic deeply immutable transaction envelope", () => {
    const first = createTransactionCommittedEffectIntent(baseInput);
    const repeated = createTransactionCommittedEffectIntent({ ...baseInput });

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      kind: "transaction-committed",
      class: "post-commit-idempotent",
      transactionId: baseInput.transactionId,
      previousRevision: revision(4),
      revision: revision(5),
      ordinal: 0,
      payload: { commandType: "select-panel", origin: "application" },
    });
    expect(first.id).toBe("effect:v1:transaction-committed:18:transaction:select:4:5:0");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.payload)).toBe(true);
  });

  it("keeps legitimate intents distinct by transaction, revision pair, and ordinal", () => {
    const original = createTransactionCommittedEffectIntent(baseInput);
    const changedTransaction = createTransactionCommittedEffectIntent({
      ...baseInput,
      transactionId: commandId("transaction:other"),
    });
    const changedRevision = createTransactionCommittedEffectIntent({
      ...baseInput,
      previousRevision: revision(5),
      revision: revision(6),
    });
    const changedOrdinal = createTransactionCommittedEffectIntent({ ...baseInput, ordinal: 1 });

    expect(
      new Set([original.id, changedTransaction.id, changedRevision.id, changedOrdinal.id]).size,
    ).toBe(4);
  });

  it("validates all runtime identity inputs before constructing an envelope", () => {
    expect(() => effectIntentId("  ")).toThrow(/must not be empty/);
    expect(() =>
      createTransactionCommittedEffectIntent({ ...baseInput, revision: revision(7) }),
    ).toThrow(/advance previousRevision exactly once/);
    expect(() => createTransactionCommittedEffectIntent({ ...baseInput, ordinal: -1 })).toThrow(
      /ordinal/,
    );
    expect(() =>
      createTransactionCommittedEffectIntent({
        ...baseInput,
        commandType: "unknown" as WorkspaceCommandType,
      }),
    ).toThrow(/Unknown effect command type/);
    expect(() =>
      createTransactionCommittedEffectIntent({
        ...baseInput,
        origin: "unknown" as CommandOrigin,
      }),
    ).toThrow(/Unknown effect command origin/);
  });
});
