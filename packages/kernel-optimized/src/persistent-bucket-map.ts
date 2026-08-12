export type PersistentMapChange<Value> =
  | { readonly type: "set"; readonly key: string; readonly value: Value }
  | { readonly type: "delete"; readonly key: string };

type Bucket<Value> = Readonly<Record<string, Value>>;

const EMPTY_BUCKET = Object.freeze(Object.create(null)) as Bucket<never>;

function assertBucketCount(bucketCount: number): void {
  if (
    !Number.isSafeInteger(bucketCount) ||
    bucketCount < 4 ||
    bucketCount > 4_096 ||
    (bucketCount & (bucketCount - 1)) !== 0
  ) {
    throw new RangeError("bucketCount must be a power of two between 4 and 4096");
  }
}

/** A deterministic non-cryptographic hash used only to select a storage bucket. */
function bucketHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mutableBucket<Value>(source: Bucket<Value>): Record<string, Value> {
  return Object.assign(Object.create(null) as Record<string, Value>, source);
}

/**
 * Small persistent hash table with fixed buckets. An update copies the outer
 * bucket array and only the buckets whose values actually change. Existing
 * versions remain valid and all exposed bucket identities are frozen.
 *
 * This is an indexed projection primitive, not a workspace semantic store.
 */
export class PersistentBucketMap<Value> {
  readonly bucketCount: number;
  readonly size: number;
  readonly #buckets: readonly Bucket<Value>[];

  private constructor(bucketCount: number, buckets: readonly Bucket<Value>[], size: number) {
    this.bucketCount = bucketCount;
    this.#buckets = buckets;
    this.size = size;
    Object.freeze(this);
  }

  static empty<Value>(bucketCount = 64): PersistentBucketMap<Value> {
    assertBucketCount(bucketCount);
    const buckets = Object.freeze(
      Array.from({ length: bucketCount }, () => EMPTY_BUCKET as Bucket<Value>),
    );
    return new PersistentBucketMap(bucketCount, buckets, 0);
  }

  static from<Value>(
    entries: Iterable<readonly [string, Value]>,
    bucketCount = 64,
  ): PersistentBucketMap<Value> {
    const changes = [...entries].map(([key, value]): PersistentMapChange<Value> => ({
      type: "set",
      key,
      value,
    }));
    return PersistentBucketMap.empty<Value>(bucketCount).withChanges(changes);
  }

  get(key: string): Value | undefined {
    return this.#buckets[this.#bucketIndex(key)]?.[key];
  }

  has(key: string): boolean {
    return Object.hasOwn(this.#buckets[this.#bucketIndex(key)] ?? EMPTY_BUCKET, key);
  }

  withChanges(changes: readonly PersistentMapChange<Value>[]): PersistentBucketMap<Value> {
    if (changes.length === 0) return this;

    const pending = new Map<number, Record<string, Value>>();
    let nextSize = this.size;

    for (const change of changes) {
      const bucketIndex = this.#bucketIndex(change.key);
      const original = this.#buckets[bucketIndex];
      if (original === undefined) throw new RangeError("Bucket index is out of bounds");
      const current = pending.get(bucketIndex) ?? original;
      const exists = Object.hasOwn(current, change.key);
      const previous = current[change.key];

      if (change.type === "set") {
        if (exists && Object.is(previous, change.value)) continue;
        const writable = pending.get(bucketIndex) ?? mutableBucket(original);
        writable[change.key] = change.value;
        pending.set(bucketIndex, writable);
        if (!exists) nextSize += 1;
      } else {
        if (!exists) continue;
        const writable = pending.get(bucketIndex) ?? mutableBucket(original);
        delete writable[change.key];
        pending.set(bucketIndex, writable);
        nextSize -= 1;
      }
    }

    if (pending.size === 0) return this;
    const buckets = [...this.#buckets];
    for (const [index, bucket] of pending) buckets[index] = Object.freeze(bucket);
    return new PersistentBucketMap(this.bucketCount, Object.freeze(buckets), nextSize);
  }

  entries(): readonly (readonly [string, Value])[] {
    const entries: (readonly [string, Value])[] = [];
    for (const bucket of this.#buckets) {
      for (const key of Object.keys(bucket)) {
        entries.push([key, bucket[key] as Value]);
      }
    }
    return Object.freeze(
      entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  }

  /** Diagnostic identity for structural-sharing tests; the bucket is frozen. */
  bucketIdentity(index: number): object {
    const bucket = this.#buckets[index];
    if (bucket === undefined) throw new RangeError("Bucket index is out of bounds");
    return bucket;
  }

  sharedBucketCount(other: PersistentBucketMap<unknown>): number {
    if (other.bucketCount !== this.bucketCount) return 0;
    let shared = 0;
    for (let index = 0; index < this.bucketCount; index += 1) {
      if (this.#buckets[index] === other.bucketIdentity(index)) shared += 1;
    }
    return shared;
  }

  #bucketIndex(key: string): number {
    return bucketHash(key) & (this.bucketCount - 1);
  }
}
