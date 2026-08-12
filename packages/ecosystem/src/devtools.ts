export interface DevtoolsSource<TSnapshot, TTransaction> {
  readonly getSnapshot: () => TSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getTransactions?: () => readonly TTransaction[];
}

export interface DevtoolsRecorderOptions<
  TSnapshot,
  TTransaction,
  TSnapshotProjection,
  TTransactionProjection,
> {
  readonly limit?: number;
  /** Project and redact before data enters the recorder. */
  readonly projectSnapshot: (snapshot: TSnapshot) => TSnapshotProjection;
  readonly projectTransaction: (transaction: TTransaction) => TTransactionProjection;
}

export interface DevtoolsEntry<TSnapshotProjection, TTransactionProjection> {
  readonly sequence: number;
  readonly snapshot: TSnapshotProjection;
  readonly transactions: readonly TTransactionProjection[];
}

export interface DevtoolsRecorder<TSnapshotProjection, TTransactionProjection> {
  readonly recording: boolean;
  readonly getEntries: () => readonly DevtoolsEntry<TSnapshotProjection, TTransactionProjection>[];
  readonly clear: () => void;
  readonly capture: () => void;
  readonly stop: () => void;
  readonly exportJson: (space?: number) => string;
}

/** Observational only: the recorder has no dispatch or mutation capability. */
export function createDevtoolsRecorder<
  TSnapshot,
  TTransaction,
  TSnapshotProjection,
  TTransactionProjection,
>(
  source: DevtoolsSource<TSnapshot, TTransaction>,
  options: DevtoolsRecorderOptions<
    TSnapshot,
    TTransaction,
    TSnapshotProjection,
    TTransactionProjection
  >,
): DevtoolsRecorder<TSnapshotProjection, TTransactionProjection> {
  const limit = normalizeLimit(options.limit ?? 100);
  let recording = true;
  let sequence = 0;
  let entries: DevtoolsEntry<TSnapshotProjection, TTransactionProjection>[] = [];

  const capture = () => {
    if (!recording) return;
    sequence += 1;
    const transactions = (source.getTransactions?.() ?? []).map(options.projectTransaction);
    entries.push({
      sequence,
      snapshot: options.projectSnapshot(source.getSnapshot()),
      transactions,
    });
    if (entries.length > limit) entries = entries.slice(entries.length - limit);
  };

  capture();
  const unsubscribe = source.subscribe(capture);

  return {
    get recording() {
      return recording;
    },
    getEntries: () => [...entries],
    clear: () => {
      entries = [];
    },
    capture,
    stop: () => {
      if (!recording) return;
      recording = false;
      unsubscribe();
    },
    exportJson: (space = 2) =>
      JSON.stringify(
        { schemaVersion: 1, entries },
        (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        space,
      ),
  };
}

function normalizeLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError("Devtools recording limit must be an integer from 1 to 10,000");
  }
  return limit;
}
