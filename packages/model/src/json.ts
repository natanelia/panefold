export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

export function isJsonValue(value: unknown): value is JsonValue {
  type Frame = { readonly value: unknown; readonly leaving?: boolean };
  const stack: Frame[] = [{ value }];
  const ancestors = new WeakSet<object>();

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    const current = frame.value;
    if (frame.leaving) {
      ancestors.delete(current as object);
      continue;
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== "object") return false;

    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    if (ancestors.has(current)) return false;
    ancestors.add(current);
    stack.push({ value: current, leaving: true });

    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(current, index)) return false;
        stack.push({ value: current[index] });
      }
      continue;
    }

    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const key of Object.keys(descriptors).reverse()) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return false;
      stack.push({ value: descriptor.value });
    }
  }

  return true;
}
