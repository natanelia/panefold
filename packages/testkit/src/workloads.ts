export type WorkloadId =
  | "compact"
  | "professional"
  | "ide-scale"
  | "large"
  | "heavy-content"
  | "lifecycle-torture"
  | "accessibility-stress"
  | "failure-stress";

export interface WorkloadManifest {
  readonly id: WorkloadId;
  readonly panels: number;
  readonly groups: number;
  readonly floatingSurfaces: number;
  readonly externalSurfaces: number;
  readonly cycles?: number;
  readonly scenarios: readonly string[];
  readonly requiredArtifacts: readonly string[];
}

export const WORKLOAD_MANIFESTS: Readonly<Record<WorkloadId, WorkloadManifest>> = deepFreeze({
  compact: workload("compact", 8, 3, 0, 0, [
    "open",
    "select",
    "reorder",
    "split",
    "resize",
    "close",
    "undo",
    "restore",
  ]),
  professional: workload("professional", 40, 12, 2, 1, [
    "long-drag",
    "snap",
    "float",
    "popout",
    "focus",
    "persistence",
    "animation",
  ]),
  "ide-scale": workload("ide-scale", 120, 35, 0, 0, [
    "tab-overflow",
    "switcher",
    "batch-close",
    "suspend-resume",
    "preset",
  ]),
  large: workload("large", 500, 100, 12, 4, [
    "local-mutation",
    "serialization",
    "recovery",
    "collaboration",
    "monitor-change",
  ]),
  "heavy-content": workload("heavy-content", 8, 3, 0, 0, [
    "move-without-remount",
    "resize-modes",
    "visibility",
    "maximize",
    "transfer",
  ]),
  "lifecycle-torture": {
    ...workload("lifecycle-torture", 8, 3, 0, 1, [
      "create",
      "move",
      "hide",
      "suspend",
      "transfer",
      "close",
    ]),
    cycles: 10_000,
  },
  "accessibility-stress": workload("accessibility-stress", 8, 3, 0, 0, [
    "zoom-400",
    "forced-colors",
    "rtl",
    "reduced-motion",
    "keyboard-only",
  ]),
  "failure-stress": workload("failure-stress", 8, 3, 1, 1, [
    "corrupt-snapshot",
    "quota",
    "popup-block",
    "surface-crash",
    "plugin-absence",
  ]),
});

export function validateWorkloadManifest(manifest: WorkloadManifest): readonly string[] {
  const issues: string[] = [];
  for (const [field, value] of [
    ["panels", manifest.panels],
    ["groups", manifest.groups],
    ["floatingSurfaces", manifest.floatingSurfaces],
    ["externalSurfaces", manifest.externalSurfaces],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      issues.push(`${field} must be a non-negative safe integer`);
  }
  if (manifest.panels > 0 && manifest.groups < 1)
    issues.push("a non-empty workload needs at least one group");
  if (
    manifest.cycles !== undefined &&
    (!Number.isSafeInteger(manifest.cycles) || manifest.cycles < 1)
  ) {
    issues.push("cycles must be a positive safe integer");
  }
  if (manifest.scenarios.length === 0) issues.push("at least one scenario is required");
  if (new Set(manifest.scenarios).size !== manifest.scenarios.length)
    issues.push("scenarios must be unique");
  return Object.freeze(issues);
}

function workload(
  id: WorkloadId,
  panels: number,
  groups: number,
  floatingSurfaces: number,
  externalSurfaces: number,
  scenarios: readonly string[],
): WorkloadManifest {
  return {
    id,
    panels,
    groups,
    floatingSurfaces,
    externalSurfaces,
    scenarios,
    requiredArtifacts: ["manifest", "raw-samples", "summary", "environment"],
  };
}

function deepFreeze<T extends Record<string, WorkloadManifest>>(value: T): T {
  for (const manifest of Object.values(value)) {
    Object.freeze(manifest.scenarios);
    Object.freeze(manifest.requiredArtifacts);
    Object.freeze(manifest);
  }
  return Object.freeze(value);
}
