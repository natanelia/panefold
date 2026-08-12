import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_PREFERENCES,
  readDemoViewPreferences,
  writeDemoViewPreferences,
  type DemoViewPreferences,
} from "./view-preferences";

describe("Atlas view preferences", () => {
  it("round-trips every supported tab presentation preference", () => {
    const storage = new MemoryStorage();
    const expected: DemoViewPreferences = {
      theme: "light",
      direction: "rtl",
      motion: "reduced",
      tabPlacement: "inline-end",
      tabContent: "icon-only",
    };

    writeDemoViewPreferences(expected, storage);

    expect(readDemoViewPreferences(storage)).toEqual(expected);
  });

  it("sanitizes unknown or corrupt persisted projection values", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "panefold.atlas.view.v1",
      JSON.stringify({
        theme: "neon",
        direction: "sideways",
        motion: "fast",
        tabPlacement: "diagonal",
        tabContent: "emoji-only",
      }),
    );
    expect(readDemoViewPreferences(storage)).toEqual(DEFAULT_VIEW_PREFERENCES);

    storage.setItem("panefold.atlas.view.v1", "{");
    expect(readDemoViewPreferences(storage)).toEqual(DEFAULT_VIEW_PREFERENCES);
  });

  it("contains optional storage failures", () => {
    const storage = new ThrowingStorage();

    expect(() => writeDemoViewPreferences(DEFAULT_VIEW_PREFERENCES, storage)).not.toThrow();
    expect(readDemoViewPreferences(storage)).toEqual(DEFAULT_VIEW_PREFERENCES);
  });
});

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  public get length(): number {
    return this.#values.size;
  }

  public clear(): void {
    this.#values.clear();
  }

  public getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  public key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  public removeItem(key: string): void {
    this.#values.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

class ThrowingStorage implements Storage {
  public get length(): number {
    throw new DOMException("Storage unavailable", "SecurityError");
  }

  public clear(): void {
    throw new DOMException("Storage unavailable", "SecurityError");
  }

  public getItem(): string | null {
    throw new DOMException("Storage unavailable", "SecurityError");
  }

  public key(): string | null {
    throw new DOMException("Storage unavailable", "SecurityError");
  }

  public removeItem(): void {
    throw new DOMException("Storage unavailable", "SecurityError");
  }

  public setItem(): void {
    throw new DOMException("Storage unavailable", "SecurityError");
  }
}
