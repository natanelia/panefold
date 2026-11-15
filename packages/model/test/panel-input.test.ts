import { describe, expect, it, vi } from "vitest";
import { createPanel, createWorkspaceLayout, type PanelInput } from "../src/layout";

describe("panel configuration containers", () => {
  it.each(["constraints", "capabilities", "lifecycle"] as const)(
    "rejects non-plain %s containers before creating a snapshot",
    (field) => {
      for (const value of [null, 42, "invalid", true, [], new Date(0), new Map(), new Set()]) {
        const panel = { id: "map", type: "map", [field]: value } as unknown as PanelInput;
        expect(() => createPanel(panel)).toThrow(new RegExp(`${field} must be a plain object`));
        expect(() =>
          createWorkspaceLayout({ panels: [panel], layout: { panels: ["map"] } }),
        ).toThrow(new RegExp(`${field} must be a plain object`));
      }
    },
  );

  it("accepts supported own fields on plain and null-prototype objects without retaining input", () => {
    const constraints = Object.assign(Object.create(null) as Record<string, unknown>, {
      hardMinInline: 160,
      resizeDelivery: "deferred",
    });
    const capabilities = Object.assign(Object.create(null) as Record<string, unknown>, {
      closable: false,
    });
    const lifecycle = Object.assign(Object.create(null) as Record<string, unknown>, {
      hidden: "suspend",
    });
    const panel = createPanel({
      id: "map",
      type: "map",
      constraints,
      capabilities,
      lifecycle,
    } as unknown as PanelInput);
    expect(panel.constraints).toEqual({ hardMinInline: 160, resizeDelivery: "deferred" });
    expect(panel.capabilities.closable).toBe(false);
    expect(panel.lifecycle.hidden).toBe("suspend");
    constraints.hardMinInline = 640;
    capabilities.closable = true;
    lifecycle.hidden = "detach";
    expect(panel.constraints.hardMinInline).toBe(160);
    expect(panel.capabilities.closable).toBe(false);
    expect(panel.lifecycle.hidden).toBe("suspend");
    expect(Object.isFrozen(panel.constraints)).toBe(true);
  });

  it.each(["constraints", "capabilities", "lifecycle"] as const)(
    "rejects unsupported %s fields that could retain mutable built-in objects",
    (field) => {
      expect(() =>
        createPanel({
          id: "map",
          type: "map",
          [field]: { unexpected: new Date(0) },
        } as unknown as PanelInput),
      ).toThrow(new RegExp(`${field} contains unsupported field unexpected`));
    },
  );

  it("rejects inherited policies and accessors without evaluating configuration getters", () => {
    const inherited = Object.create({ hardMinInline: 120 }) as NonNullable<
      PanelInput["constraints"]
    >;
    expect(() => createPanel({ id: "map", type: "map", constraints: inherited })).toThrow(
      /constraints must be a plain object/,
    );
    const getter = vi.fn(() => 120);
    const accessor = Object.defineProperty({}, "hardMinInline", { enumerable: true, get: getter });
    expect(() => createPanel({ id: "map", type: "map", constraints: accessor })).toThrow(
      /hardMinInline must be an enumerable data property/,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    label: "panel parameters",
    create: (values: readonly number[]) =>
      createPanel({ id: "map", type: "map", parameters: { values } }),
    error: /parameters must contain only finite JSON values/,
  },
  {
    label: "workspace metadata",
    create: (values: readonly number[]) =>
      createWorkspaceLayout({
        panels: [{ id: "map", type: "map" }],
        layout: { panels: ["map"] },
        metadata: { values },
      }),
    error: /metadata must be a JSON object/,
  },
])("$label JSON arrays", ({ create, error }) => {
  it("rejects array index accessors without invoking them", () => {
    const getter = vi.fn().mockReturnValueOnce(1).mockReturnValue(Number.NaN);
    const values: number[] = [];
    Object.defineProperty(values, "0", { enumerable: true, get: getter });

    expect(() => create(values)).toThrow(error);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects named array accessors without invoking them", () => {
    const getter = vi.fn(() => Number.NaN);
    const values = [1];
    Object.defineProperty(values, "extra", { enumerable: true, get: getter });

    expect(() => create(values)).toThrow(error);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, new Date(0)])("rejects named array properties containing %s", (extra) => {
    const values = [1];
    Object.defineProperty(values, "extra", { enumerable: true, value: extra });

    expect(() => create(values)).toThrow(error);
  });

  it("continues to reject array holes", () => {
    const values = [1, 2];
    delete values[0];

    expect(() => create(values)).toThrow(error);
  });
});
