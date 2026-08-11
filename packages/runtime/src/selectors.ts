import {
  getEntity,
  type GroupId,
  type GroupRecord,
  type PanelId,
  type PanelRecord,
  type SurfaceId,
  type SurfaceRecord,
  type WorkspaceSnapshot,
} from "@panefold/model";

export type WorkspaceSelector<Value> = (snapshot: WorkspaceSnapshot) => Value;
export type Equality<Value> = (left: Value, right: Value) => boolean;

export const selectRevision = (snapshot: WorkspaceSnapshot) => snapshot.revision;

export const selectActivePanelId = (snapshot: WorkspaceSnapshot) =>
  snapshot.activation.activePanelId;

export const selectPanel =
  (panelId: PanelId): WorkspaceSelector<PanelRecord | undefined> =>
  (snapshot) =>
    getEntity(snapshot.panels, panelId);

export const selectGroup =
  (groupId: GroupId): WorkspaceSelector<GroupRecord | undefined> =>
  (snapshot) =>
    getEntity(snapshot.groups, groupId);

export const selectSurface =
  (surfaceId: SurfaceId): WorkspaceSelector<SurfaceRecord | undefined> =>
  (snapshot) =>
    getEntity(snapshot.surfaces, surfaceId);

export const selectSelectedPanel =
  (groupId: GroupId): WorkspaceSelector<PanelRecord | undefined> =>
  (snapshot) => {
    const group = getEntity(snapshot.groups, groupId);
    return group === undefined ? undefined : getEntity(snapshot.panels, group.selectedPanelId);
  };

export const shallowEqual = <Value extends Readonly<Record<string, unknown>>>(
  left: Value,
  right: Value,
): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]))
  );
};
