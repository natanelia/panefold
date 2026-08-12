export interface BoundaryLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
  readonly maxTotalStringLength: number;
}

export const DEFAULT_BOUNDARY_LIMITS: BoundaryLimits = Object.freeze({
  maxDepth: 32,
  maxNodes: 10_000,
  maxArrayLength: 2_048,
  maxObjectKeys: 512,
  maxStringLength: 65_536,
  maxTotalStringLength: 1_048_576,
});

export type BoundaryValidationResult =
  | { readonly ok: true; readonly nodes: number; readonly stringUnits: number }
  | { readonly ok: false; readonly path: string; readonly reason: string };

/**
 * Validates JSON-like values before they cross a plugin, collaboration, or
 * diagnostic boundary. The walk is iterative and bounded so hostile depth or
 * breadth cannot overflow the stack or consume unbounded work.
 */
export function validateBoundaryValue(
  value: unknown,
  limits: Partial<BoundaryLimits> = {},
): BoundaryValidationResult {
  const resolved = resolveLimits(limits);
  const stack: Array<{ readonly value: unknown; readonly path: string; readonly depth: number }> = [
    { value, path: "$", depth: 0 },
  ];
  const seen = new Set<object>();
  let nodes = 0;
  let stringUnits = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > resolved.maxNodes) return invalid(current.path, "node limit exceeded");
    if (current.depth > resolved.maxDepth) return invalid(current.path, "depth limit exceeded");

    const type = typeof current.value;
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return invalid(current.path, "number must be finite");
      continue;
    }
    if (typeof current.value === "string") {
      const length = current.value.length;
      if (length > resolved.maxStringLength) return invalid(current.path, "string limit exceeded");
      stringUnits += length;
      if (stringUnits > resolved.maxTotalStringLength) {
        return invalid(current.path, "total string limit exceeded");
      }
      continue;
    }
    if (type !== "object") return invalid(current.path, `unsupported ${type} value`);

    const object = current.value as object;
    if (seen.has(object)) return invalid(current.path, "cyclic value is not allowed");
    seen.add(object);

    if (Array.isArray(object)) {
      if (object.length > resolved.maxArrayLength) {
        return invalid(current.path, "array length limit exceeded");
      }
      for (let index = object.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: object[index],
          path: `${current.path}[${String(index)}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(current.path, "object prototype is not JSON-safe");
    }
    const keys = Object.keys(object);
    if (keys.length > resolved.maxObjectKeys)
      return invalid(current.path, "object key limit exceeded");
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        return invalid(`${current.path}.${key}`, "prototype-sensitive key is not allowed");
      }
      stringUnits += key.length;
      if (key.length > resolved.maxStringLength || stringUnits > resolved.maxTotalStringLength) {
        return invalid(`${current.path}.${key}`, "key string limit exceeded");
      }
      stack.push({
        value: (object as Record<string, unknown>)[key],
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }

  return Object.freeze({ ok: true, nodes, stringUnits });
}

function resolveLimits(overrides: Partial<BoundaryLimits>): BoundaryLimits {
  const resolved: BoundaryLimits = { ...DEFAULT_BOUNDARY_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return Object.freeze(resolved);
}

function invalid(path: string, reason: string): BoundaryValidationResult {
  return Object.freeze({ ok: false, path, reason });
}
