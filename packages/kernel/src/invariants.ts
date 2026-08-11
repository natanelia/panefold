import {
  isJsonValue,
  type EntityTable,
  type GroupId,
  type NodeId,
  type PanelId,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { NORMALIZED_WEIGHT_TOTAL, compareCanonicalStrings, isFiniteRect } from "./internal";

export interface InvariantViolation {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function violation(
  violations: InvariantViolation[],
  code: string,
  path: string,
  message: string,
): void {
  violations.push({ code, path, message });
}

/**
 * Validates the normalized table contract independently of entity semantics.
 * Relationships may only be trusted after this inventory agrees in both
 * directions: ordered IDs to keyed values and keyed values back to IDs.
 */
export function validateEntityTable<Id extends string, Entity extends { readonly id: Id }>(
  tableName: string,
  table: EntityTable<Id, Entity>,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const idKeys = table.ids.map(String);
  const idSet = new Set(idKeys);
  const entityKeys = Object.keys(table.byId);

  if (idSet.size !== idKeys.length) {
    violation(
      violations,
      "DUPLICATE_TABLE_ID",
      `${tableName}.ids`,
      "Entity table IDs must be unique",
    );
  }

  const canonicalIds = [...idKeys].sort(compareCanonicalStrings);
  if (idKeys.some((id, index) => id !== canonicalIds[index])) {
    violation(
      violations,
      "NON_CANONICAL_TABLE_ORDER",
      `${tableName}.ids`,
      "Entity table IDs must be sorted in canonical lexicographic order",
    );
  }

  idKeys.forEach((id, index) => {
    if (id.trim().length === 0) {
      violation(
        violations,
        "INVALID_ENTITY_ID",
        `${tableName}.ids[${String(index)}]`,
        "Entity IDs must be non-empty strings",
      );
    }
    if (!Object.hasOwn(table.byId, id)) {
      violation(
        violations,
        "MISSING_TABLE_ENTRY",
        `${tableName}.byId.${id}`,
        `ID inventory references missing key "${id}"`,
      );
    }
  });

  for (const key of entityKeys) {
    if (!idSet.has(key)) {
      violation(
        violations,
        "EXTRA_TABLE_ENTRY",
        `${tableName}.byId.${key}`,
        `Key "${key}" is absent from the ID inventory`,
      );
    }

    const entity = table.byId[key] as unknown;
    if (entity === null || typeof entity !== "object" || !("id" in entity)) {
      violation(
        violations,
        "INVALID_TABLE_ENTITY",
        `${tableName}.byId.${key}`,
        "Entity table values must be records with an explicit ID",
      );
      continue;
    }
    const entityId = (entity as { readonly id: unknown }).id;
    if (typeof entityId !== "string" || entityId.trim().length === 0) {
      violation(
        violations,
        "INVALID_ENTITY_ID",
        `${tableName}.byId.${key}.id`,
        "Entity IDs must be non-empty strings",
      );
    } else if (entityId !== key) {
      violation(
        violations,
        "ENTITY_ID_KEY_MISMATCH",
        `${tableName}.byId.${key}.id`,
        `Entity ID "${entityId}" does not match table key "${key}"`,
      );
    }
  }

  return violations;
}

export function validateWorkspace(snapshot: WorkspaceSnapshot): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const panelMembership = new Map<PanelId, GroupId[]>();

  violations.push(
    ...validateEntityTable("panels", snapshot.panels),
    ...validateEntityTable("groups", snapshot.groups),
    ...validateEntityTable("nodes", snapshot.nodes),
    ...validateEntityTable("surfaces", snapshot.surfaces),
  );

  if (typeof snapshot.revision !== "bigint" || snapshot.revision < 0n) {
    violation(violations, "INVALID_REVISION", "revision", "Revision must be a non-negative bigint");
  }

  if (!Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
    violation(
      violations,
      "INVALID_SCHEMA_VERSION",
      "schemaVersion",
      "Schema version must be a positive safe integer",
    );
  }
  if (
    !Number.isSafeInteger(snapshot.applicationLayoutVersion) ||
    snapshot.applicationLayoutVersion < 1
  ) {
    violation(
      violations,
      "INVALID_LAYOUT_VERSION",
      "applicationLayoutVersion",
      "Application layout version must be a positive safe integer",
    );
  }

  for (const groupId of snapshot.groups.ids) {
    const group = snapshot.groups.byId[String(groupId)];
    if (group === undefined) {
      violation(
        violations,
        "MISSING_TABLE_ENTITY",
        `groups.${groupId}`,
        "Group ID has no table value",
      );
      continue;
    }
    if (new Set(group.panelIds).size !== group.panelIds.length) {
      violation(
        violations,
        "DUPLICATE_GROUP_PANEL",
        `groups.${groupId}.panelIds`,
        "A panel appears more than once in a group",
      );
    }
    if (group.panelIds.length === 0 && !group.persistent) {
      violation(
        violations,
        "EMPTY_TRANSIENT_GROUP",
        `groups.${groupId}`,
        "A non-persistent group must contain a panel",
      );
    }
    if (group.panelIds.length > 0 && !group.panelIds.includes(group.selectedPanelId)) {
      violation(
        violations,
        "INVALID_GROUP_SELECTION",
        `groups.${groupId}.selectedPanelId`,
        "Selected panel must belong to its group",
      );
    }
    for (const panelId of group.panelIds) {
      if (snapshot.panels.byId[String(panelId)] === undefined) {
        violation(
          violations,
          "DANGLING_PANEL",
          `groups.${groupId}.panelIds`,
          `Panel "${panelId}" does not exist`,
        );
      }
      const owners = panelMembership.get(panelId) ?? [];
      owners.push(groupId);
      panelMembership.set(panelId, owners);
    }
  }

  for (const panelId of snapshot.panels.ids) {
    const panel = snapshot.panels.byId[String(panelId)];
    if (panel === undefined) {
      violation(
        violations,
        "MISSING_TABLE_ENTITY",
        `panels.${panelId}`,
        "Panel ID has no table value",
      );
      continue;
    }
    const owners = panelMembership.get(panelId) ?? [];
    if (owners.length !== 1) {
      violation(
        violations,
        "INVALID_PANEL_OWNERSHIP",
        `panels.${panelId}`,
        `Panel must have exactly one group owner; found ${owners.length}`,
      );
    }
    if (!Number.isSafeInteger(panel.typeVersion) || panel.typeVersion < 1) {
      violation(
        violations,
        "INVALID_PANEL_VERSION",
        `panels.${panelId}.typeVersion`,
        "Panel type version must be a positive safe integer",
      );
    }
    if (panel.type.trim().length === 0) {
      violation(
        violations,
        "INVALID_PANEL_TYPE",
        `panels.${panelId}.type`,
        "Panel type must be a non-empty string",
      );
    }
    if (!isJsonValue(panel.parameters)) {
      violation(
        violations,
        "INVALID_PANEL_PARAMETERS",
        `panels.${panelId}.parameters`,
        "Panel parameters must contain only finite JSON values",
      );
    }
    for (const [constraintName, value] of Object.entries(panel.constraints)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        violation(
          violations,
          "INVALID_PANEL_CONSTRAINT",
          `panels.${panelId}.constraints.${constraintName}`,
          "Numeric panel constraints must be finite",
        );
      }
    }
    if (
      panel.constraints.preferredAspectRatio !== undefined &&
      panel.constraints.preferredAspectRatio <= 0
    ) {
      violation(
        violations,
        "INVALID_PANEL_CONSTRAINT",
        `panels.${panelId}.constraints.preferredAspectRatio`,
        "Preferred aspect ratio must be greater than zero",
      );
    }
  }

  const groupNodeCounts = new Map<GroupId, number>();
  const reachCount = new Map<NodeId, number>();
  const visit = (nodeId: NodeId, surfacePath: Set<NodeId>, path: string): void => {
    if (surfacePath.has(nodeId)) {
      violation(violations, "LAYOUT_CYCLE", path, `Cycle reaches node "${nodeId}"`);
      return;
    }
    const node = snapshot.nodes.byId[String(nodeId)];
    if (node === undefined) {
      violation(violations, "DANGLING_NODE", path, `Node "${nodeId}" does not exist`);
      return;
    }
    reachCount.set(nodeId, (reachCount.get(nodeId) ?? 0) + 1);
    const nextPath = new Set(surfacePath);
    nextPath.add(nodeId);
    if (node.kind === "group") {
      if (snapshot.groups.byId[String(node.groupId)] === undefined) {
        violation(
          violations,
          "DANGLING_GROUP",
          `nodes.${node.id}.groupId`,
          `Group "${node.groupId}" does not exist`,
        );
      }
      groupNodeCounts.set(node.groupId, (groupNodeCounts.get(node.groupId) ?? 0) + 1);
      return;
    }
    if (node.kind !== "split") {
      violation(
        violations,
        "INVALID_NODE_KIND",
        `nodes.${nodeId}.kind`,
        "Layout node kind must be group or split",
      );
      return;
    }
    if (node.axis !== "inline" && node.axis !== "block") {
      violation(
        violations,
        "INVALID_SPLIT_AXIS",
        `nodes.${node.id}.axis`,
        "Split axis must be inline or block",
      );
    }
    if (node.children.length < 2) {
      violation(
        violations,
        "NON_CANONICAL_SPLIT",
        `nodes.${node.id}.children`,
        "A canonical split must have at least two children",
      );
    }
    if (node.children.length !== node.weights.length) {
      violation(
        violations,
        "WEIGHT_ARITY_MISMATCH",
        `nodes.${node.id}.weights`,
        "Split weights must align one-to-one with children",
      );
    }
    if (new Set(node.children).size !== node.children.length) {
      violation(
        violations,
        "DUPLICATE_SPLIT_CHILD",
        `nodes.${node.id}.children`,
        "A split cannot contain the same child twice",
      );
    }
    if (node.weights.some((weight) => !Number.isSafeInteger(weight) || weight <= 0)) {
      violation(
        violations,
        "INVALID_SPLIT_WEIGHT",
        `nodes.${node.id}.weights`,
        "Canonical weights must be positive safe integers",
      );
    } else if (node.weights.reduce((sum, weight) => sum + weight, 0) !== NORMALIZED_WEIGHT_TOTAL) {
      violation(
        violations,
        "UNNORMALIZED_SPLIT_WEIGHT",
        `nodes.${node.id}.weights`,
        `Canonical weights must sum to ${NORMALIZED_WEIGHT_TOTAL}`,
      );
    }
    if (node.collapsedChildIds.some((child) => !node.children.includes(child))) {
      violation(
        violations,
        "INVALID_COLLAPSED_CHILD",
        `nodes.${node.id}.collapsedChildIds`,
        "Collapsed children must belong to the split",
      );
    }
    node.children.forEach((child, index) => visit(child, nextPath, `${path}.children[${index}]`));
  };

  for (const surfaceId of snapshot.surfaces.ids) {
    const surface = snapshot.surfaces.byId[String(surfaceId)];
    if (surface === undefined) {
      violation(
        violations,
        "MISSING_TABLE_ENTITY",
        `surfaces.${surfaceId}`,
        "Surface ID has no table value",
      );
      continue;
    }
    visit(surface.rootNodeId, new Set(), `surfaces.${surfaceId}.rootNodeId`);
    if (typeof surface.maximized !== "boolean") {
      violation(
        violations,
        "INVALID_SURFACE_STATE",
        `surfaces.${surfaceId}.maximized`,
        "Surface maximized state must be boolean",
      );
    }
    if (surface.kind === "floating" && surface.bounds === undefined) {
      violation(
        violations,
        "MISSING_SURFACE_BOUNDS",
        `surfaces.${surfaceId}.bounds`,
        "In-page floating surfaces require finite restore geometry",
      );
    }
    if (surface.bounds !== undefined && !isFiniteRect(surface.bounds)) {
      violation(
        violations,
        "INVALID_SURFACE_BOUNDS",
        `surfaces.${surfaceId}.bounds`,
        "Surface bounds must be finite and non-negative",
      );
    }
    if (surface.restoreBounds !== undefined && !isFiniteRect(surface.restoreBounds)) {
      violation(
        violations,
        "INVALID_RESTORE_BOUNDS",
        `surfaces.${surfaceId}.restoreBounds`,
        "Restore bounds must be finite and non-negative",
      );
    }
    if (
      surface.ownerEpoch !== undefined &&
      (!Number.isSafeInteger(surface.ownerEpoch) || surface.ownerEpoch < 0)
    ) {
      violation(
        violations,
        "INVALID_OWNER_EPOCH",
        `surfaces.${surfaceId}.ownerEpoch`,
        "Owner epoch must be a non-negative safe integer",
      );
    }
  }

  for (const nodeId of snapshot.nodes.ids) {
    const count = reachCount.get(nodeId) ?? 0;
    if (count !== 1) {
      violation(
        violations,
        "INVALID_NODE_REACHABILITY",
        `nodes.${nodeId}`,
        `Node must be reachable from exactly one surface root; found ${count}`,
      );
    }
  }
  for (const groupId of snapshot.groups.ids) {
    const count = groupNodeCounts.get(groupId) ?? 0;
    if (count !== 1) {
      violation(
        violations,
        "INVALID_GROUP_NODE_OWNERSHIP",
        `groups.${groupId}`,
        `Group must have exactly one reachable group node; found ${count}`,
      );
    }
  }

  const floatingIds = snapshot.surfaces.ids.filter(
    (id) => snapshot.surfaces.byId[String(id)]?.kind === "floating",
  );
  if (
    new Set(snapshot.floatingOrder).size !== snapshot.floatingOrder.length ||
    floatingIds.some((id) => !snapshot.floatingOrder.includes(id)) ||
    snapshot.floatingOrder.some((id) => !floatingIds.includes(id))
  ) {
    violation(
      violations,
      "INVALID_FLOATING_ORDER",
      "floatingOrder",
      "Every floating surface must appear exactly once and no other surface may appear",
    );
  }

  const activePanelId = snapshot.activation.activePanelId;
  if (activePanelId !== undefined && snapshot.panels.byId[String(activePanelId)] === undefined) {
    violation(
      violations,
      "INVALID_ACTIVE_PANEL",
      "activation.activePanelId",
      "Active panel must be live",
    );
  }
  const activeSurfaceId = snapshot.activation.activeSurfaceId;
  if (
    activeSurfaceId !== undefined &&
    snapshot.surfaces.byId[String(activeSurfaceId)] === undefined
  ) {
    violation(
      violations,
      "INVALID_ACTIVE_SURFACE",
      "activation.activeSurfaceId",
      "Active surface must be live",
    );
  }
  if (
    snapshot.focusMemory.panelId !== undefined &&
    snapshot.panels.byId[String(snapshot.focusMemory.panelId)] === undefined
  ) {
    violation(
      violations,
      "INVALID_FOCUS_PANEL",
      "focusMemory.panelId",
      "Focus-memory panel must be live",
    );
  }
  if (
    snapshot.focusMemory.groupId !== undefined &&
    snapshot.groups.byId[String(snapshot.focusMemory.groupId)] === undefined
  ) {
    violation(
      violations,
      "INVALID_FOCUS_GROUP",
      "focusMemory.groupId",
      "Focus-memory group must be live",
    );
  }

  const closedIds = new Set<string>();
  for (const record of snapshot.recoverableClosedPanels) {
    if (closedIds.has(record.id)) {
      violation(
        violations,
        "DUPLICATE_CLOSED_PANEL",
        "recoverableClosedPanels",
        `Closed record "${record.id}" appears more than once`,
      );
    }
    closedIds.add(record.id);
    if (record.id.trim().length === 0) {
      violation(
        violations,
        "INVALID_CLOSED_PANEL_ID",
        "recoverableClosedPanels",
        "Recoverable closed-panel IDs must be non-empty",
      );
    }
    if (typeof record.closedAtRevision !== "bigint" || record.closedAtRevision < 0n) {
      violation(
        violations,
        "INVALID_CLOSED_PANEL_REVISION",
        `recoverableClosedPanels.${record.id}.closedAtRevision`,
        "Closed-panel revision must be a non-negative bigint",
      );
    }
    if (snapshot.panels.byId[String(record.panel.id)] !== undefined) {
      violation(
        violations,
        "LIVE_AND_CLOSED_PANEL",
        "recoverableClosedPanels",
        `Panel "${record.panel.id}" is both live and recoverably closed`,
      );
    }
  }

  if (!isJsonValue(snapshot.metadata)) {
    violation(
      violations,
      "INVALID_METADATA",
      "metadata",
      "Workspace metadata must contain only finite JSON values",
    );
  }

  return violations;
}

export const isValidWorkspace = (snapshot: WorkspaceSnapshot): boolean =>
  validateWorkspace(snapshot).length === 0;
