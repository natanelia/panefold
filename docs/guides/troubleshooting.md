# Troubleshooting

**Start at the boundary that owns the symptom.** A rendering problem, a rejected command and an unavailable browser capability need different fixes.

## The workspace is blank

Check that the container has a nonzero height, base CSS is imported, and flex/grid ancestors permit shrinking. Validate the snapshot. Confirm that the surface references a real root node, the nodes reference real groups, and those groups contain real panel IDs.

## The tab exists but my component does not

Check the registry key against `panel.type`, not `panel.id`. Inspect missing-provider and rendering errors. Keep the registry stable rather than constructing unrelated component types on each render.

## Dragging or splitting does nothing

Check the command adapter and the relevant planners. Selection factories do not automatically implement docking. Inspect `onCommandResult` for rejection, including revision conflicts and capabilities. Confirm that the model-aware solver and the preview use the same bounds and splitter size.

For tab reordering, supply `reorderPanel`. For precise foreign tab-strip insertion, also supply `planPanelTabDrop`. For whole-container movement, supply `planGroupDrop`.

## My note resets or keeps working while hidden

A hidden panel may remain mounted in a suspended host. Use lifecycle signals to pause expensive work, not to erase the document. Reloads require application persistence or checkpoints; preserving the host during a drag is a different guarantee.

## The theme looks half dark

Override text, muted text, surfaces, raised/soft states, borders and focus colors together, and set `color-scheme`. Apply tokens to the surface's `className`. Inspect CSS specificity before adding global rules. Use `splitterSize` for actual splitter geometry.

## The saved layout does not come back

Wait for the durable saved revision, then reload the same origin and storage key. Check restore-before-render ordering, storage failures and migration versions. The starter is deliberately in-memory; use the full workbench to test IndexedDB saving.

## The new window is blocked or empty

Use a fresh user gesture, a supported same-origin adapter and a popout-capable panel. Check bootstrap, stylesheet loading, timeout and recovery. Browser policy cannot be disabled by a renderer prop. Offer in-page floating as a fallback.

## A documentation link fails on refresh

Build the complete site with `pnpm build:site`, not just Vite's JavaScript bundle. The post-build step emits HTML for every catalog route. Preview URLs have their own asset base; use the preview's links instead of pasting a production `/panefold/` path into it.

## Report a useful reproduction

Include the source commit, browser/framework versions, the failing action, expected behavior, a small redacted snapshot, relevant receipt/error code, and whether the issue reproduces in the starter. Do not attach credentials or private panel data. Follow [SECURITY.md](../../SECURITY.md) for suspected vulnerabilities rather than opening a public issue.
