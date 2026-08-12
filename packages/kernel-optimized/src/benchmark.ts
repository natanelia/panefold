import type { PanelId, WorkspaceSnapshot } from "@panefold/model";

import { OptimizedKernelProjection } from "./projection";

export interface ProjectionLookupBenchmark {
  readonly iterations: number;
  readonly lookups: number;
  readonly canonicalScanMilliseconds: number;
  readonly indexedLookupMilliseconds: number;
  readonly canonicalChecksum: number;
  readonly indexedChecksum: number;
}

function canonicalPanelGroup(snapshot: WorkspaceSnapshot, panelId: PanelId): string | undefined {
  for (const groupId of snapshot.groups.ids) {
    const group = snapshot.groups.byId[String(groupId)];
    if (group?.panelIds.includes(panelId) === true) return String(group.id);
  }
  return undefined;
}

/**
 * Reproducible lookup microbenchmark. Timings are observations, never a CI
 * pass/fail threshold; checksums make both paths comparable and keep the work
 * observable to the runtime.
 */
export function benchmarkPanelGroupLookups(
  snapshot: WorkspaceSnapshot,
  panelIds: readonly PanelId[],
  iterations = 100,
): ProjectionLookupBenchmark {
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new RangeError("iterations must be a positive safe integer");
  }
  const projection = OptimizedKernelProjection.create(snapshot);
  let canonicalChecksum = 0;
  const canonicalStart = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const panelId of panelIds) {
      canonicalChecksum += canonicalPanelGroup(snapshot, panelId)?.length ?? 0;
    }
  }
  const canonicalScanMilliseconds = performance.now() - canonicalStart;

  let indexedChecksum = 0;
  const indexedStart = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const panelId of panelIds) {
      indexedChecksum += String(projection.groupForPanel(panelId) ?? "").length;
    }
  }
  const indexedLookupMilliseconds = performance.now() - indexedStart;

  return Object.freeze({
    iterations,
    lookups: iterations * panelIds.length,
    canonicalScanMilliseconds,
    indexedLookupMilliseconds,
    canonicalChecksum,
    indexedChecksum,
  });
}
