import {
  applyJournalCommit,
  emptyBundle,
  type StoredWorkspaceBundle,
  type WorkspaceJournalCommit,
  type WorkspaceJournalPort,
} from "@panefold/runtime";

export interface IndexedDbWorkspaceJournalOptions {
  readonly databaseName?: string;
  readonly storeName?: string;
  readonly version?: number;
  readonly journalLimit?: number;
  readonly indexedDB?: IDBFactory;
}

interface StoredBundleRecord {
  readonly key: string;
  readonly bundle: StoredWorkspaceBundle;
}

/** IndexedDB adapter with one native read-write transaction per journal commit. */
export class IndexedDbWorkspaceJournalPort implements WorkspaceJournalPort {
  readonly #databaseName: string;
  readonly #storeName: string;
  readonly #version: number;
  readonly #journalLimit: number;
  readonly #indexedDB: IDBFactory;
  #database: Promise<IDBDatabase> | undefined;

  public constructor(options: IndexedDbWorkspaceJournalOptions = {}) {
    this.#databaseName = options.databaseName ?? "panefold";
    this.#storeName = options.storeName ?? "workspace-journal";
    this.#version = positive(options.version ?? 1, "version");
    this.#journalLimit = nonNegative(options.journalLimit ?? 10_000, "journalLimit");
    const indexedDB = options.indexedDB ?? globalThis.indexedDB;
    if (indexedDB === undefined) {
      throw new Error("IndexedDB is unavailable; inject an IDBFactory or use a memory adapter");
    }
    this.#indexedDB = indexedDB;
  }

  public async read(key: string): Promise<StoredWorkspaceBundle | undefined> {
    const database = await this.#open();
    const transaction = database.transaction(this.#storeName, "readonly");
    const request = transaction.objectStore(this.#storeName).get(key);
    const record = (await requestResult(request)) as StoredBundleRecord | undefined;
    await transactionDone(transaction);
    return record?.bundle;
  }

  public async commit(key: string, commit: WorkspaceJournalCommit): Promise<void> {
    const database = await this.#open();
    const transaction = database.transaction(this.#storeName, "readwrite");
    const store = transaction.objectStore(this.#storeName);
    const current = ((await requestResult(store.get(key))) as StoredBundleRecord | undefined)
      ?.bundle;
    const bundle = applyJournalCommit(current ?? emptyBundle(), commit, this.#journalLimit);
    store.put({ key, bundle } satisfies StoredBundleRecord);
    await transactionDone(transaction);
  }

  public async clear(key: string): Promise<void> {
    const database = await this.#open();
    const transaction = database.transaction(this.#storeName, "readwrite");
    transaction.objectStore(this.#storeName).delete(key);
    await transactionDone(transaction);
  }

  public async close(): Promise<void> {
    (await this.#database)?.close();
    this.#database = undefined;
  }

  #open(): Promise<IDBDatabase> {
    this.#database ??= new Promise((resolve, reject) => {
      const request = this.#indexedDB.open(this.#databaseName, this.#version);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.#storeName)) {
          request.result.createObjectStore(this.#storeName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
    });
    return this.#database;
  }
}

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as unknown);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}
