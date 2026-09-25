import type { WorkspaceDropBehavior } from "./types";

/** Pointer samples are authoritative too: keyup may be lost when another window has focus. */
export function splitEnabledForEvent(
  event: { readonly altKey: boolean; readonly shiftKey: boolean },
  platform: string,
  behavior: WorkspaceDropBehavior | undefined,
): boolean {
  const toggle = /Mac|iPhone|iPad|iPod/i.test(platform) ? event.shiftKey : event.altKey;
  return (behavior?.splitOnDragAndDrop ?? true) !== toggle;
}
