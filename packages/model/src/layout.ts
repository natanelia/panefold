import {
  cloneAndFreeze,
  DEFAULT_PANEL_CAPABILITIES,
  DEFAULT_PANEL_LIFECYCLE,
  MAIN_SURFACE_CAPABILITIES,
  type GroupRecord,
  type LayoutNode,
  type LogicalAxis,
  type PanelCapabilities,
  type PanelConstraints,
  type PanelLifecyclePolicy,
  type PanelRecord,
  type WorkspaceSnapshot,
} from "./entities";
import { createWorkspaceSnapshot } from "./factories";
import { groupId, nodeId, panelId, surfaceId, type NodeId, type PanelId } from "./ids";
import { isJsonValue, type JsonObject, type JsonValue } from "./json";
import { NORMALIZED_SPLIT_WEIGHT_TOTAL, normalizeSplitWeights } from "./split-weights";

/** A panel instance; omitted capabilities and lifecycle fields use the model defaults. */
export interface PanelInput {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly typeVersion?: number;
  readonly parameters?: JsonValue;
  readonly capabilities?: Partial<PanelCapabilities>;
  readonly constraints?: PanelConstraints;
  readonly lifecycle?: Partial<PanelLifecyclePolicy>;
  readonly checkpointRef?: string;
}

/** A tab group. Authored groups persist when emptied unless persistent is explicitly false. */
export interface WorkspaceGroupLayout {
  readonly id?: string;
  /** Optional layout-node identity, separate from the tab group's identity. */
  readonly nodeId?: string;
  readonly panels: readonly string[];
  readonly selectedPanelId?: string;
  readonly region?: string;
  readonly persistent?: boolean;
  readonly axis?: never;
  readonly children?: never;
  readonly weights?: never;
}

/** Relative weights accept ordinary positive proportions, such as [3, 1] or [75, 25]. */
export interface WorkspaceSplitLayout {
  readonly id?: string;
  readonly axis: LogicalAxis;
  readonly children: readonly WorkspaceLayoutNode[];
  readonly weights?: readonly number[];
  readonly panels?: never;
  readonly nodeId?: never;
  readonly selectedPanelId?: never;
  readonly region?: never;
  readonly persistent?: never;
}

export type WorkspaceLayoutNode = WorkspaceGroupLayout | WorkspaceSplitLayout;

/** Initial main-surface layout. Use createWorkspaceSnapshot for normalized/restored records. */
export interface WorkspaceLayoutInput {
  readonly panels: readonly PanelInput[];
  readonly layout: WorkspaceLayoutNode;
  /** Defaults to "main". */
  readonly surfaceId?: string;
  /** Defaults to the first selected panel in layout order. */
  readonly activePanelId?: string;
  readonly applicationLayoutVersion?: number;
  readonly metadata?: JsonObject;
}

/** Build an immutable panel without repeating every capability and lifecycle default. */
export function createPanel(input: PanelInput): PanelRecord {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Panel input must be an object with id and type");
  }
  const id = panelId(nonEmptyString(input.id, "Panel id"));
  const type = nonEmptyString(input.type, `Panel ${id} type`);
  const typeVersion = input.typeVersion ?? 1;
  positiveInteger(typeVersion, `Panel ${id} typeVersion`);
  const parameters = input.parameters === undefined ? {} : input.parameters;
  if (!isJsonValue(parameters)) {
    throw new TypeError(`Panel ${id} parameters must contain only finite JSON values`);
  }
  if (input.capabilities !== undefined) {
    validateConfigObject(
      input.capabilities,
      `Panel ${id} capabilities`,
      Object.keys(DEFAULT_PANEL_CAPABILITIES),
    );
  }
  const capabilities = { ...DEFAULT_PANEL_CAPABILITIES, ...input.capabilities };
  for (const [name, enabled] of Object.entries(capabilities)) {
    if (typeof enabled !== "boolean") {
      throw new TypeError(`Panel ${id} capabilities.${name} must be boolean`);
    }
  }
  if (input.lifecycle !== undefined) {
    validateConfigObject(
      input.lifecycle,
      `Panel ${id} lifecycle`,
      Object.keys(DEFAULT_PANEL_LIFECYCLE),
    );
  }
  const lifecycle = { ...DEFAULT_PANEL_LIFECYCLE, ...input.lifecycle };
  if (
    !["keep-alive", "detach", "suspend", "application-managed"].includes(lifecycle.hidden) ||
    !["preserve-host", "remount"].includes(lifecycle.sameDocumentMove) ||
    !["unsupported", "checkpoint-remount", "portal-coupled", "mirror"].includes(
      lifecycle.crossDocumentMove,
    )
  ) {
    throw new TypeError(`Panel ${id} lifecycle must use supported model policies`);
  }
  const constraints = input.constraints === undefined ? {} : input.constraints;
  validateConstraints(constraints, id);
  if (input.title !== undefined && typeof input.title !== "string") {
    throw new TypeError(`Panel ${id} title must be a string`);
  }
  if (input.checkpointRef !== undefined && typeof input.checkpointRef !== "string") {
    throw new TypeError(`Panel ${id} checkpointRef must be a string`);
  }
  return cloneAndFreeze({
    id,
    type,
    typeVersion,
    parameters,
    capabilities,
    constraints: { ...constraints },
    lifecycle,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
  });
}

interface LayoutFrame {
  readonly input: WorkspaceLayoutNode;
  readonly path: string;
  readonly depth: number;
  readonly parentChildren: NodeId[];
  readonly index: number;
}

/**
 * Compile a declarative tree into immutable model records. Generated identities depend only on
 * layout paths; use explicit group/node/split IDs when identity must survive editing the template.
 * This authors one main surface. The runtime still validates the resulting snapshot, and normal
 * kernel canonicalization (including same-axis split flattening) applies on subsequent commands.
 */
export function createWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceSnapshot {
  if (input === null || typeof input !== "object" || !Array.isArray(input.panels)) {
    throw new TypeError("Workspace layout requires a panels array and a layout tree");
  }
  const mainId = surfaceId(nonEmptyString(input.surfaceId ?? "main", "Workspace surfaceId"));
  const applicationLayoutVersion = input.applicationLayoutVersion ?? 1;
  positiveInteger(applicationLayoutVersion, "Workspace applicationLayoutVersion");
  if (
    input.metadata !== undefined &&
    (input.metadata === null ||
      typeof input.metadata !== "object" ||
      Array.isArray(input.metadata) ||
      !isJsonValue(input.metadata))
  ) {
    throw new TypeError("Workspace metadata must be a JSON object");
  }
  const panels = input.panels.map(createPanel);
  const panelIds = new Set<string>();
  const panelTypes = new Map<string, { readonly singleton: boolean }>();
  for (const panel of panels) {
    uniqueId(panelIds, panel.id, "panel");
    const previous = panelTypes.get(panel.type);
    if (previous !== undefined && (previous.singleton || panel.capabilities.singleton)) {
      throw new TypeError(`Singleton panel type ${panel.type} has more than one instance`);
    }
    panelTypes.set(panel.type, { singleton: panel.capabilities.singleton });
  }
  const activeId =
    input.activePanelId === undefined
      ? undefined
      : panelId(nonEmptyString(input.activePanelId, "Workspace activePanelId"));
  if (activeId !== undefined && !panelIds.has(activeId)) {
    throw new TypeError(`Workspace activePanelId ${activeId} does not name a declared panel`);
  }

  const groups: GroupRecord[] = [];
  const nodes: LayoutNode[] = [];
  const groupIds = new Set<string>();
  const nodeIds = new Set<string>();
  const membership = new Map<string, GroupRecord>();
  const seen = new WeakSet<object>();
  const root: NodeId[] = [];
  const pending: LayoutFrame[] = [
    { input: input.layout, path: "root", depth: 0, parentChildren: root, index: 0 },
  ];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) continue;
    const layout = frame.input;
    if (layout === null || typeof layout !== "object") {
      throw new TypeError(`Layout ${frame.path} must be a group or split object`);
    }
    if (seen.has(layout)) {
      throw new TypeError(`Layout ${frame.path} contains a cycle or reuses a layout object`);
    }
    seen.add(layout);
    // The compiler is iterative; the bound also keeps downstream tree consumers stack-safe.
    if (frame.depth > 128) {
      throw new RangeError(`Layout ${frame.path} exceeds the maximum nesting depth of 128`);
    }
    const isGroup = Array.isArray(layout.panels);
    if (isGroup) {
      if (
        layout.axis !== undefined ||
        layout.children !== undefined ||
        layout.weights !== undefined
      ) {
        throw new TypeError(`Layout ${frame.path} cannot be both a group and a split`);
      }
      const group = layout as WorkspaceGroupLayout;
      const id = groupId(nonEmptyString(group.id ?? `panefold:group:${frame.path}`, "Group id"));
      const groupNodeId = nodeId(
        nonEmptyString(group.nodeId ?? `panefold:node:${frame.path}`, `Group ${id} nodeId`),
      );
      uniqueId(groupIds, id, "group");
      uniqueId(nodeIds, groupNodeId, "layout node");
      const groupPanels = group.panels.map((value) =>
        panelId(nonEmptyString(value, `Group ${id} panel id`)),
      );
      const persistent = group.persistent ?? true;
      if (typeof persistent !== "boolean") {
        throw new TypeError(`Group ${id} persistent must be boolean`);
      }
      if (groupPanels.length === 0 && !persistent) {
        throw new TypeError(`Empty group ${id} must be persistent`);
      }
      if (group.region !== undefined && typeof group.region !== "string") {
        throw new TypeError(`Group ${id} region must be a string`);
      }
      const selected =
        group.selectedPanelId === undefined
          ? activeId !== undefined && groupPanels.includes(activeId)
            ? activeId
            : groupPanels[0]
          : panelId(nonEmptyString(group.selectedPanelId, `Group ${id} selectedPanelId`));
      if (selected !== undefined && !groupPanels.includes(selected)) {
        throw new TypeError(`Group ${id} selectedPanelId ${selected} must belong to its panels`);
      }
      if (activeId !== undefined && groupPanels.includes(activeId) && selected !== activeId) {
        throw new TypeError(`Group ${id} must select activePanelId ${activeId}`);
      }
      const record: GroupRecord = {
        id,
        panelIds: groupPanels,
        selectedPanelId: selected ?? panelId(`panefold:empty:${id}`),
        persistent,
        ...(group.region === undefined ? {} : { region: group.region }),
      };
      for (const member of groupPanels) {
        if (!panelIds.has(member)) {
          throw new TypeError(`Group ${id} references undeclared panel ${member}`);
        }
        const owner = membership.get(member);
        if (owner !== undefined) {
          throw new TypeError(
            `Panel ${member} appears more than once in groups ${owner.id} and ${id}`,
          );
        }
        membership.set(member, record);
      }
      groups.push(record);
      nodes.push({ kind: "group", id: groupNodeId, groupId: id });
      frame.parentChildren[frame.index] = groupNodeId;
      continue;
    }
    if (
      layout.panels !== undefined ||
      !Array.isArray(layout.children) ||
      (layout.axis !== "inline" && layout.axis !== "block")
    ) {
      throw new TypeError(
        `Layout ${frame.path} requires group panels or split children and an inline/block axis`,
      );
    }
    const split = layout as WorkspaceSplitLayout;
    if (
      split.nodeId !== undefined ||
      split.selectedPanelId !== undefined ||
      split.region !== undefined ||
      split.persistent !== undefined
    ) {
      throw new TypeError(`Split ${frame.path} cannot contain group-only fields`);
    }
    if (split.children.length < 2 || split.children.length > NORMALIZED_SPLIT_WEIGHT_TOTAL) {
      throw new RangeError(
        `Split ${frame.path} requires between 2 and ${NORMALIZED_SPLIT_WEIGHT_TOTAL} children`,
      );
    }
    const id = nodeId(nonEmptyString(split.id ?? `panefold:split:${frame.path}`, "Split id"));
    uniqueId(nodeIds, id, "layout node");
    const weights = layoutWeights(split.weights, split.children.length, id);
    const children: NodeId[] = [];
    nodes.push({ kind: "split", id, axis: split.axis, children, weights, collapsedChildIds: [] });
    frame.parentChildren[frame.index] = id;
    for (let index = split.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        input: split.children[index] as WorkspaceLayoutNode,
        path: `${frame.path}.${index}`,
        depth: frame.depth + 1,
        parentChildren: children,
        index,
      });
    }
  }
  for (const panel of panels) {
    if (!membership.has(panel.id)) {
      throw new TypeError(`Declared panel ${panel.id} is not assigned to a layout group`);
    }
  }
  const rootNodeId = root[0];
  if (rootNodeId === undefined) throw new TypeError("Workspace requires a root layout node");
  const selectedActiveId =
    activeId ?? groups.find((group) => group.panelIds.length > 0)?.selectedPanelId;
  const activeGroup = selectedActiveId === undefined ? undefined : membership.get(selectedActiveId);
  return createWorkspaceSnapshot({
    applicationLayoutVersion,
    panels,
    groups,
    nodes,
    surfaces: [
      {
        id: mainId,
        kind: "main",
        rootNodeId,
        capabilities: MAIN_SURFACE_CAPABILITIES,
        maximized: false,
      },
    ],
    activation:
      selectedActiveId === undefined
        ? {}
        : { activePanelId: selectedActiveId, activeSurfaceId: mainId },
    focusMemory:
      selectedActiveId === undefined || activeGroup === undefined
        ? { fallback: "workspace-root" }
        : { panelId: selectedActiveId, groupId: activeGroup.id, fallback: "selected-tab" },
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });
}

function nonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function uniqueId(ids: Set<string>, id: string, kind: string): void {
  if (ids.has(id)) throw new TypeError(`Duplicate ${kind} id ${id}; give each ${kind} a unique id`);
  ids.add(id);
}

function layoutWeights(weights: readonly number[] | undefined, count: number, id: NodeId) {
  if (weights !== undefined && (!Array.isArray(weights) || weights.length !== count)) {
    throw new TypeError(`Split ${id} weights must contain one value per child`);
  }
  const input = weights ?? Array.from({ length: count }, () => 1);
  let sum = 0;
  let largest = 0;
  for (const weight of input) {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`Split ${id} weights must be finite positive numbers`);
    }
    sum += weight;
    largest = Math.max(largest, weight);
  }
  // Scaling only overflowing sums retains useful ratios without passing Infinity to normalization.
  return normalizeSplitWeights(
    Number.isFinite(sum)
      ? input
      : input.map((weight) => Math.max(Number.MIN_VALUE, weight / largest)),
  );
}

const NUMERIC_CONSTRAINT_FIELDS = [
  "hardMinInline",
  "hardMinBlock",
  "preferredMinInline",
  "preferredMinBlock",
  "preferredInline",
  "preferredBlock",
  "maxInline",
  "maxBlock",
  "grow",
  "shrink",
  "collapsePriority",
  "preferredAspectRatio",
] as const;

function validateConfigObject(value: unknown, name: string, fields: readonly string[]): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${name} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.includes(key)) {
      throw new TypeError(`${name} contains unsupported field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${name}.${key} must be an enumerable data property`);
    }
  }
}

function validateConstraints(constraints: PanelConstraints, id: PanelId): void {
  validateConfigObject(constraints, `Panel ${id} constraints`, [
    ...NUMERIC_CONSTRAINT_FIELDS,
    "collapsible",
    "resizeDelivery",
  ]);
  for (const name of NUMERIC_CONSTRAINT_FIELDS) {
    const value = constraints[name];
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || (name === "preferredAspectRatio" && value === 0))
    ) {
      throw new RangeError(
        `Panel ${id} constraints.${name} must be finite and ${name === "preferredAspectRatio" ? "positive" : "non-negative"}`,
      );
    }
  }
  if (
    (constraints.maxInline !== undefined &&
      constraints.maxInline < (constraints.hardMinInline ?? 0)) ||
    (constraints.maxBlock !== undefined && constraints.maxBlock < (constraints.hardMinBlock ?? 0))
  ) {
    throw new RangeError(`Panel ${id} maximum constraints cannot be smaller than hard minimums`);
  }
  if (constraints.collapsible !== undefined && typeof constraints.collapsible !== "boolean") {
    throw new TypeError(`Panel ${id} constraints.collapsible must be boolean`);
  }
  if (
    constraints.resizeDelivery !== undefined &&
    !["live", "throttled", "deferred", "adaptive"].includes(constraints.resizeDelivery)
  ) {
    throw new TypeError(`Panel ${id} constraints.resizeDelivery must use a supported policy`);
  }
}
