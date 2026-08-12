import type { WorkspaceRuntime } from "@panefold/runtime";

/**
 * Produces a topology-only diagnostic. Transaction labels and panel payloads
 * are deliberately excluded because applications may populate them with
 * customer or document data.
 */
export function createRedactedReproduction(runtime: WorkspaceRuntime, direction: string) {
  const snapshot = runtime.getSnapshot();
  return {
    engineVersion: "0.1.0",
    revision: snapshot.revision.toString(),
    capabilityProfile: { surface: "main", direction },
    topology: {
      groups: snapshot.groups.ids,
      nodes: snapshot.nodes.ids,
      surfaces: snapshot.surfaces.ids,
    },
    commands: runtime.getTransactions().map((transaction) => ({
      id: transaction.id,
      origin: transaction.origin,
      revision: transaction.revision.toString(),
      type: transaction.command.type,
    })),
  };
}
