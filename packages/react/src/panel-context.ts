import { useCallback, useSyncExternalStore } from "react";

/** Structural contract: React does not depend on the ecosystem package. */
export interface PanelContextSource<Snapshot> {
  readonly getSnapshot: () => Snapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Observe an application-owned context connection. The hook owns only its
 * subscription, not the connection. Create memberships outside render.
 * For SSR, supply matching initial server/client snapshots and a request-scoped hub.
 */
export function usePanelContext<Snapshot>(
  source: PanelContextSource<Snapshot>,
  getServerSnapshot?: () => Snapshot,
): Snapshot {
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source]);
  const getSnapshot = useCallback(() => source.getSnapshot(), [source]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot ?? getSnapshot);
}
