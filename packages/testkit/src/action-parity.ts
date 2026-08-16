import type { WorkspaceCommandType } from "@panefold/model";

export type ActionRoute = "pointer" | "keyboard" | "menu" | "command-palette" | "programmatic";

export interface StructuralActionParityEntry {
  readonly commandType: WorkspaceCommandType;
  readonly label: string;
  readonly routes: readonly ActionRoute[];
}

/**
 * Renderer-backed routes in the compact React reference profile. Core-only
 * commands are deliberately omitted: this is evidence about exposed UI, not
 * an aspirational copy of the command catalog. Applications may add routes,
 * but a pointer route must retain at least one non-pointer UI equivalent.
 */
export const STRUCTURAL_ACTION_PARITY: readonly StructuralActionParityEntry[] = Object.freeze([
  action("select-panel", "Select panel", ["pointer", "keyboard", "programmatic"]),
  action("activate-panel", "Activate panel", ["keyboard", "programmatic"]),
  action("reorder-panels", "Reorder tab", ["pointer", "keyboard", "menu", "programmatic"]),
  action("move-panel", "Move panel", ["pointer", "keyboard", "menu", "programmatic"]),
  action("move-group", "Move panel container", ["pointer", "keyboard", "menu", "programmatic"]),
  action("swap-groups", "Swap panel containers", ["pointer", "keyboard", "menu", "programmatic"]),
  action("split-group", "Split group", ["pointer", "keyboard", "menu", "programmatic"]),
  action("resize-split", "Resize split", ["pointer", "keyboard", "programmatic"]),
  action("close-panels", "Close panel", ["pointer", "keyboard", "programmatic"]),
  action("create-floating-surface", "Float panel", ["menu", "programmatic"]),
  action("move-floating-surface", "Move floating window", ["pointer", "keyboard", "programmatic"]),
  action("resize-floating-surface", "Resize floating window", [
    "pointer",
    "keyboard",
    "programmatic",
  ]),
  action("raise-surface", "Raise floating window", ["pointer", "keyboard", "programmatic"]),
  action("maximize-surface", "Maximize floating window", ["pointer", "keyboard", "programmatic"]),
  action("restore-surface", "Restore floating window", ["pointer", "keyboard", "programmatic"]),
  action("minimize-surface", "Minimize floating window", ["pointer", "keyboard", "programmatic"]),
  action("redock-surface", "Redock floating window", ["pointer", "keyboard", "programmatic"]),
  action("transfer-to-browser-window", "Open panel in new window", [
    "pointer",
    "keyboard",
    "menu",
    "programmatic",
  ]),
]);

export function auditStructuralActionParity(
  entries: readonly StructuralActionParityEntry[],
): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<WorkspaceCommandType>();
  for (const entry of entries) {
    if (seen.has(entry.commandType)) issues.push(`duplicate command ${entry.commandType}`);
    seen.add(entry.commandType);
    if (entry.label.trim().length === 0) issues.push(`${entry.commandType} has no label`);
    if (!entry.routes.includes("programmatic"))
      issues.push(`${entry.commandType} has no programmatic route`);
    if (
      entry.routes.includes("pointer") &&
      !entry.routes.some(
        (route) => route === "keyboard" || route === "menu" || route === "command-palette",
      )
    ) {
      issues.push(`${entry.commandType} has pointer input without a non-pointer UI route`);
    }
    if (new Set(entry.routes).size !== entry.routes.length)
      issues.push(`${entry.commandType} has duplicate routes`);
  }
  return Object.freeze(issues);
}

function action(
  commandType: WorkspaceCommandType,
  label: string,
  routes: readonly ActionRoute[],
): StructuralActionParityEntry {
  return Object.freeze({ commandType, label, routes: Object.freeze([...routes]) });
}
