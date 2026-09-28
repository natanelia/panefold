import { openDurableWorkspace } from "@panefold/runtime";
import { IndexedDbWorkspaceJournalPort } from "@panefold/runtime-effect";
import { playgroundSnapshot } from "./playground-model";

export async function openPlaygroundSession() {
  const journal = new IndexedDbWorkspaceJournalPort({
    databaseName: "panefold-touch-playground",
    storeName: "layouts",
    version: 1,
  });
  try {
    const opened = await openDurableWorkspace({
      initialSnapshot: playgroundSnapshot,
      journal,
      key: "playground.v1",
      runtimeOptions: { historyLimit: 100 },
      recovery: {
        currentKernelSchemaVersion: playgroundSnapshot.schemaVersion,
        currentApplicationLayoutVersion: 1,
        currentProtocolVersion: 1,
        migrations: [],
      },
      durability: "balanced",
      compactionInterval: 1,
    });
    if (!opened.ok) throw opened.error;
    let disposal: Promise<void> | undefined;
    return {
      ...opened,
      dispose() {
        return (disposal ??= (async () => {
          try {
            await opened.durable.flush();
          } finally {
            try {
              await opened.durable.dispose();
            } finally {
              opened.runtime.dispose();
              await journal.close();
            }
          }
        })());
      },
    };
  } catch (error) {
    await journal.close();
    throw error;
  }
}
export type PlaygroundSession = Awaited<ReturnType<typeof openPlaygroundSession>>;
