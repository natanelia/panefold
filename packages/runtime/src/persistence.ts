/**
 * Driver-neutral durable storage boundary. Versioned decoding and migration are
 * intentionally not hidden in the storage adapter.
 */
export interface PersistenceRecord {
  readonly formatVersion: number;
  readonly revision: string;
  readonly checksum: string;
  readonly payload: Uint8Array;
}

export interface PersistencePort {
  load(key: string): Promise<PersistenceRecord | undefined>;
  save(key: string, record: PersistenceRecord): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryPersistencePort implements PersistencePort {
  readonly #records = new Map<string, PersistenceRecord>();

  public async load(key: string): Promise<PersistenceRecord | undefined> {
    const record = this.#records.get(key);
    return record === undefined ? undefined : { ...record, payload: record.payload.slice() };
  }

  public async save(key: string, record: PersistenceRecord): Promise<void> {
    this.#records.set(key, { ...record, payload: record.payload.slice() });
  }

  public async remove(key: string): Promise<void> {
    this.#records.delete(key);
  }
}
