# Save and restore

**Remember the arrangement. Be explicit about the rest.** A workspace that restores its layout has not necessarily saved the user's document, query or map edits.

## Start with the right lifecycle

For an in-memory workspace, `createWorkspaceRuntime` is enough. For durable storage, use `openDurableWorkspace` with a journal implementation such as `IndexedDbWorkspaceJournalPort`.

The opening operation recovers persisted state before returning the runtime. Render a loading state until it resolves. Rendering defaults first and then saving them can overwrite the arrangement you meant to restore.

The complete browser example is [runtime-session.ts](../../apps/demo/src/runtime-session.ts). It includes the exact configuration, versioned migration, error handling, restoration metadata and disposal contract. Do not replace that with unchecked `JSON.parse(localStorage.getItem(...))`.

## Configure a storage boundary

Choose a database/store, a workspace key, an application layout version and a migration policy. The journal adapter constructor takes `databaseName`, `storeName` and `version`. `openDurableWorkspace` receives the journal, key, initial snapshot, runtime options and recovery versions.

Use product-, account- and workspace-scoped keys where needed. IndexedDB is origin-scoped, so same-origin demos and previews can share browser storage. Use a private browser session when evaluating an unfamiliar preview. Persistence storage is not an authorization boundary or a secret vault.

## Tell the user what actually saved

The returned durable controller exposes `getStatus()`, `subscribeStatus()` and `flush()`. Report a saved canonical revision only when the durable status says it was saved; clicking a button is not proof that storage succeeded.

The full workbench visibly reports saved and restored revisions. Arrange panels, wait for the saved indication, reload, and compare both the revision and arrangement. The smaller starter intentionally does not persist.

## Save panel data separately

Panel parameters describe serializable configuration. Live component state, editor documents and remote data are not magically included. Use your domain persistence or a versioned checkpoint codec for panel-owned content.

Version the application layout and handle renamed or unavailable panel providers. Missing content should lead to a recoverable placeholder or explicit recovery choice—not silent destructive reset.

## Fail visibly and clean up in order

Storage can be unavailable, full or corrupt. Offer recovery or an explicitly temporary session; never silently claim durable saving after falling back to memory.

The reference session first returns externally hosted panels, then flushes and disposes durable work, disposes the runtime, and closes its journal resources. Keep error handling on every cleanup path. Do not depend on an async unload handler to finish a save after the browser process has already gone away.

Crash-durable certification, real browser crash testing and quota certification remain outside the current evidence. Review [support](../SUPPORT.md) before treating the example as your production recovery policy.
