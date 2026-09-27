import type { WorkspaceSnapshot } from "@panefold/model";
import { compareCanonicalStrings } from "./internal";

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cannot serialize a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCanonicalStrings);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Cannot canonically serialize ${typeof value}`);
}

export const canonicalSerialize = (value: unknown): string => canonicalValue(value);

/**
 * FNV-1a 64 is used as a small deterministic semantic fingerprint, not as a
 * security checksum. Persistence adapters should use a cryptographic digest.
 */
function fnv1a64(value: string): string {
  // Multiply modulo 2^64 using two unsigned 32-bit words. The FNV prime
  // is 2^40 + 435, so only the low-word carry and two cross products survive.
  // low * 435 is below 2^41 and therefore exact in a JavaScript number.
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    low = (low ^ byte) >>> 0;
    const product = low * 435;
    high = (Math.imul(high, 435) + (low << 8) + Math.floor(product / 0x1_0000_0000)) >>> 0;
    low = product >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

/** Revision is excluded so inverse commands can be semantically compared. */
export function semanticHash(snapshot: WorkspaceSnapshot): string {
  const { revision, ...semanticState } = snapshot;
  void revision;
  return `fnv1a64-v1:${fnv1a64(canonicalSerialize(semanticState))}`;
}

/** Includes revision and is suitable for deterministic replay assertions. */
export function canonicalHash(snapshot: WorkspaceSnapshot): string {
  return `fnv1a64-v1:${fnv1a64(canonicalSerialize(snapshot))}`;
}
