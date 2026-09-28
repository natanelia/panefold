import {
  defaultGroupConstraints,
  solveLayout,
  type BoxConstraints,
  type LogicalRect,
  type SolveLayoutOptions,
} from "@panefold/geometry";
import type { GroupRecord, NodeId, WorkspaceSnapshot } from "@panefold/model";

/** Demo content scrolls inside small panes. Do not apply desktop editor minima
 * to a phone: emergency minimum-size shrink ignores splitter weights. Keep this
 * policy in the application and use it for both previews and committed layouts. */
function smallPaneConstraints(group: GroupRecord, snapshot: WorkspaceSnapshot): BoxConstraints {
  const constraints = defaultGroupConstraints(group, snapshot);
  return {
    inline: { ...constraints.inline, min: 44, preferred: 88 },
    block: { ...constraints.block, min: 96, preferred: 132 },
  };
}

export function solveDemoLayout(
  snapshot: WorkspaceSnapshot,
  rootNodeId: NodeId,
  bounds: LogicalRect,
  options: SolveLayoutOptions = {},
) {
  return solveLayout(snapshot, rootNodeId, bounds, {
    ...options,
    ...(bounds.inlineSize < 960 ? { resolveGroupConstraints: smallPaneConstraints } : {}),
  });
}
