import assert from "node:assert/strict";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertBoundedValue,
  DEFAULT_PERSISTENCE_LIMITS,
  type PersistenceCodecError,
} from "../src/persistence-codec";
import { assertBoundedValue as original } from "./reference-persistence-codec";

function outcome(
  validator: typeof assertBoundedValue,
  value: unknown,
  limits = DEFAULT_PERSISTENCE_LIMITS,
) {
  try {
    validator(value, limits);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const e = error as PersistenceCodecError;
    return {
      ok: false,
      name: e.name,
      code: e.code,
      message: e.message,
      remediation: e.remediation,
    };
  }
}
function boundary(value: unknown) {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Fixture must have a JSON encoding");
  const size = new TextEncoder().encode(text).byteLength;
  for (const maxBytes of [size - 1, size]) {
    const limits = { ...DEFAULT_PERSISTENCE_LIMITS, maxBytes };
    const result = outcome(assertBoundedValue, value, limits);
    assert.deepEqual(result, outcome(original, value, limits));
    assert.equal(result.ok, maxBytes === size);
  }
}
const utf16 = fc
  .array(fc.integer({ min: 0, max: 65535 }), { maxLength: 400 })
  .map((units) => String.fromCharCode(...units));
describe("exact persistence byte counting", () => {
  it("preserves the byte boundary for all 65536 UTF-16 code units", () => {
    for (let unit = 0; unit <= 65535; unit += 1) boundary(String.fromCharCode(unit));
  }, 30000);
  it("preserves escaped strings, surrogates, native fallback and number formatting", () => {
    for (const text of [
      "",
      "\0",
      '"\\\b\t\n\f\r',
      "é中文🙂",
      "\ud800",
      "\udfff",
      "\ud800A\udfff",
      "\ud800\udbff\udc00\udfff",
    ])
      for (const repeat of [1, 8, 127, 128, 129, 1024]) {
        const value = text.repeat(repeat);
        boundary(value);
        boundary({ [`key:${value}`]: value });
        boundary([value, value]);
      }
    for (const value of [
      0,
      -0,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      1e-7,
      1e21,
      -1.23456789e25,
    ])
      boundary(value);
  });
  it("matches native boundaries for 5000 seeded UTF-16 and finite-number cases", () => {
    fc.assert(
      fc.property(utf16, fc.double({ noNaN: true, noDefaultInfinity: true }), (text, number) => {
        boundary(text);
        boundary(number);
        boundary({ [`key:${text}`]: [text, number, true, null] });
      }),
      { seed: 20260928, numRuns: 5000 },
    );
  });
  it("preserves exact rejection order, error details and resource limits", () => {
    const limits = fc.record({
      maxBytes: fc.integer({ min: 0, max: 2000 }),
      maxDepth: fc.integer({ min: 0, max: 12 }),
      maxNodes: fc.integer({ min: 0, max: 100 }),
      maxArrayLength: fc.integer({ min: 0, max: 20 }),
      maxObjectKeys: fc.integer({ min: 0, max: 20 }),
      maxStringLength: fc.integer({ min: 0, max: 200 }),
    });
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), utf16, fc.double()), limits, (value, bounds) => {
        expect(outcome(assertBoundedValue, value, bounds)).toEqual(
          outcome(original, value, bounds),
        );
      }),
      { seed: 20260928, numRuns: 5000 },
    );
  });
  it("retains hostile-input rejection without invoking getters", () => {
    let calls = 0;
    const getter = () => {
      calls += 1;
      throw new Error("Do not invoke");
    };
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const alias = {};
    const inputs: unknown[] = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      1n,
      Symbol("value"),
      () => 0,
      Object.defineProperty({}, "value", { enumerable: true, get: getter }),
      Object.defineProperty([0], "0", { get: getter }),
      cycle,
      [alias, alias],
      Object.defineProperty({}, "hidden", { value: 0 }),
      Object.assign([0], { custom: 1 }),
      Object.assign([0], { [Symbol("key")]: 1 }),
      new Array(2),
      new Date(0),
      new Uint8Array(2),
      { [Symbol("key")]: 0 },
      ...["__proto__", "prototype", "constructor"].map((key) =>
        Object.defineProperty(Object.create(null), key, { value: 0, enumerable: true }),
      ),
    ];
    for (const value of inputs) {
      expect(outcome(original, value).ok).toBe(false);
      for (const limits of [
        DEFAULT_PERSISTENCE_LIMITS,
        ...[0, 1, 2, 10].map((maxBytes) => ({ ...DEFAULT_PERSISTENCE_LIMITS, maxBytes })),
      ])
        expect(outcome(assertBoundedValue, value, limits)).toEqual(
          outcome(original, value, limits),
        );
    }
    expect(calls).toBe(0);
    boundary(Object.assign(Object.create(null), { title: "safe", value: 3 }));
  });
});
