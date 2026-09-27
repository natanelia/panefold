// Baseline 81b11b4: independent two-pass reference retained for compatibility tests.
import type { GroupRecord, PanelConstraints, WorkspaceSnapshot } from "@panefold/model";
import type { AxisConstraints, BoxConstraints, LogicalAxis } from "../src/types.js";

const UNBOUNDED = Number.POSITIVE_INFINITY;

function axisValue(
  constraints: PanelConstraints,
  axis: LogicalAxis,
  kind: "hardMin" | "preferredMin" | "preferred" | "max",
): number | undefined {
  if (axis === "inline") {
    if (kind === "hardMin") return constraints.hardMinInline;
    if (kind === "preferredMin") return constraints.preferredMinInline;
    if (kind === "preferred") return constraints.preferredInline;
    return constraints.maxInline;
  }

  if (kind === "hardMin") return constraints.hardMinBlock;
  if (kind === "preferredMin") return constraints.preferredMinBlock;
  if (kind === "preferred") return constraints.preferredBlock;
  return constraints.maxBlock;
}

function safeDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function selectedPanelConstraints(
  group: GroupRecord,
  snapshot: WorkspaceSnapshot,
  axis: LogicalAxis,
): AxisConstraints {
  const panels = group.panelIds
    .map((id) => snapshot.panels.byId[String(id)])
    .filter((panel) => panel !== undefined);
  const selected = snapshot.panels.byId[String(group.selectedPanelId)] ?? panels[0];

  if (panels.length === 0 || selected === undefined) return {};

  const min = panels.reduce(
    (current, panel) =>
      Math.max(current, safeDimension(axisValue(panel.constraints, axis, "hardMin"), 0)),
    0,
  );
  const preferredMin = safeDimension(axisValue(selected.constraints, axis, "preferredMin"), min);
  const preferred = Math.max(
    min,
    preferredMin,
    safeDimension(axisValue(selected.constraints, axis, "preferred"), preferredMin),
  );
  const declaredMax = axisValue(selected.constraints, axis, "max");
  const max =
    declaredMax === undefined ? UNBOUNDED : Math.max(min, safeDimension(declaredMax, min));

  return {
    min,
    preferred: Math.min(preferred, max),
    max,
    grow: safeDimension(selected.constraints.grow, 1),
    shrink: safeDimension(selected.constraints.shrink, 1),
    collapsible: panels.every((panel) => panel.constraints.collapsible === true),
    collapsePriority: safeDimension(selected.constraints.collapsePriority, 0),
  };
}

export function referenceGroupConstraints(
  group: GroupRecord,
  snapshot: WorkspaceSnapshot,
): BoxConstraints {
  const selected = snapshot.panels.byId[String(group.selectedPanelId)];
  const preferredAspectRatio = selected?.constraints.preferredAspectRatio;
  return {
    inline: selectedPanelConstraints(group, snapshot, "inline"),
    block: selectedPanelConstraints(group, snapshot, "block"),
    ...(preferredAspectRatio === undefined ||
    !Number.isFinite(preferredAspectRatio) ||
    preferredAspectRatio <= 0
      ? {}
      : { preferredAspectRatio }),
  };
}
