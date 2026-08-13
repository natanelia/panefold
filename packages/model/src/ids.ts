declare const panelIdBrand: unique symbol;
declare const groupIdBrand: unique symbol;
declare const nodeIdBrand: unique symbol;
declare const surfaceIdBrand: unique symbol;
declare const closedPanelIdBrand: unique symbol;
declare const commandIdBrand: unique symbol;
declare const effectIntentIdBrand: unique symbol;
declare const revisionBrand: unique symbol;

export type PanelId = string & { readonly [panelIdBrand]: "PanelId" };
export type GroupId = string & { readonly [groupIdBrand]: "GroupId" };
export type NodeId = string & { readonly [nodeIdBrand]: "NodeId" };
export type SurfaceId = string & { readonly [surfaceIdBrand]: "SurfaceId" };
export type ClosedPanelId = string & {
  readonly [closedPanelIdBrand]: "ClosedPanelId";
};
export type CommandId = string & { readonly [commandIdBrand]: "CommandId" };
export type EffectIntentId = string & {
  readonly [effectIntentIdBrand]: "EffectIntentId";
};
export type Revision = bigint & { readonly [revisionBrand]: "Revision" };

export type EntityId = PanelId | GroupId | NodeId | SurfaceId;

function nonEmptyId<T extends string>(value: string, name: string): T {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value as T;
}

export const panelId = (value: string): PanelId => nonEmptyId<PanelId>(value, "PanelId");
export const groupId = (value: string): GroupId => nonEmptyId<GroupId>(value, "GroupId");
export const nodeId = (value: string): NodeId => nonEmptyId<NodeId>(value, "NodeId");
export const surfaceId = (value: string): SurfaceId => nonEmptyId<SurfaceId>(value, "SurfaceId");
export const closedPanelId = (value: string): ClosedPanelId =>
  nonEmptyId<ClosedPanelId>(value, "ClosedPanelId");
export const commandId = (value: string): CommandId => nonEmptyId<CommandId>(value, "CommandId");
export const effectIntentId = (value: string): EffectIntentId =>
  nonEmptyId<EffectIntentId>(value, "EffectIntentId");

export function revision(value: bigint | number | string): Revision {
  const parsed = BigInt(value);
  if (parsed < 0n) {
    throw new RangeError("Revision must be non-negative");
  }
  return parsed as Revision;
}

export const INITIAL_REVISION = revision(0n);

export function nextRevision(value: Revision): Revision {
  return revision(value + 1n);
}
