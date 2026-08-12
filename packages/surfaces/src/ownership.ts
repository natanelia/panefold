import type { PanelId, SurfaceId } from "@panefold/model";

import type { OwnershipToken, PanelOwnership, SurfaceOwnershipRegistryPort } from "./types";

export class SurfaceOwnershipRegistry implements SurfaceOwnershipRegistryPort {
  readonly #owners = new Map<PanelId, PanelOwnership>();

  public register(panelId: PanelId, surfaceId: SurfaceId, coordinatorEpoch: number): void {
    validateEpoch(coordinatorEpoch);
    const existing = this.#owners.get(panelId);
    if (existing !== undefined) {
      if (existing.surfaceId !== surfaceId || existing.state !== "owned") {
        throw new Error(`Panel ${panelId} already has an authoritative owner`);
      }
      if (coordinatorEpoch < existing.coordinatorEpoch) {
        throw new Error(`Panel ${panelId} rejected a stale coordinator epoch`);
      }
    }
    this.#owners.set(panelId, frozenOwnership(panelId, surfaceId, coordinatorEpoch, "owned"));
  }

  public begin(token: OwnershipToken): boolean {
    const owner = this.#owners.get(token.panelId);
    if (
      owner === undefined ||
      owner.surfaceId !== token.sourceSurfaceId ||
      owner.coordinatorEpoch !== token.coordinatorEpoch ||
      owner.state !== "owned"
    ) {
      return false;
    }
    this.#owners.set(
      token.panelId,
      frozenOwnership(
        token.panelId,
        token.sourceSurfaceId,
        token.coordinatorEpoch,
        "transferring",
        token.token,
        token.sourceSurfaceId,
      ),
    );
    return true;
  }

  public commit(token: OwnershipToken): boolean {
    const owner = this.#owners.get(token.panelId);
    if (
      owner?.state !== "transferring" ||
      owner.transferToken !== token.token ||
      owner.surfaceId !== token.sourceSurfaceId
    ) {
      return false;
    }
    this.#owners.set(
      token.panelId,
      frozenOwnership(
        token.panelId,
        token.destinationSurfaceId,
        token.coordinatorEpoch,
        "destination-pending-ready",
        token.token,
        token.sourceSurfaceId,
      ),
    );
    return true;
  }

  public ready(token: OwnershipToken): boolean {
    const owner = this.#owners.get(token.panelId);
    if (
      owner?.state !== "destination-pending-ready" ||
      owner.transferToken !== token.token ||
      owner.surfaceId !== token.destinationSurfaceId
    ) {
      return false;
    }
    this.#owners.set(
      token.panelId,
      frozenOwnership(token.panelId, token.destinationSurfaceId, token.coordinatorEpoch, "owned"),
    );
    return true;
  }

  public rollback(token: OwnershipToken): SurfaceId | undefined {
    const owner = this.#owners.get(token.panelId);
    if (owner?.transferToken !== token.token) return undefined;
    const safeSurfaceId = owner.previousSurfaceId ?? token.sourceSurfaceId;
    this.#owners.set(
      token.panelId,
      frozenOwnership(token.panelId, safeSurfaceId, token.coordinatorEpoch, "owned"),
    );
    return safeSurfaceId;
  }

  public recoverSurface(
    lostSurfaceId: SurfaceId,
    recoverySurfaceId: SurfaceId,
    coordinatorEpoch: number,
  ): readonly PanelId[] {
    validateEpoch(coordinatorEpoch);
    const recovered: PanelId[] = [];
    for (const [panelId, owner] of this.#owners) {
      if (owner.surfaceId !== lostSurfaceId) continue;
      this.#owners.set(
        panelId,
        frozenOwnership(panelId, recoverySurfaceId, coordinatorEpoch, "owned"),
      );
      recovered.push(panelId);
    }
    return Object.freeze(recovered.sort(compareStrings));
  }

  public ownerOf(panelId: PanelId): PanelOwnership | undefined {
    return this.#owners.get(panelId);
  }

  public snapshot(): readonly PanelOwnership[] {
    return Object.freeze(
      [...this.#owners.values()].sort((left, right) => compareStrings(left.panelId, right.panelId)),
    );
  }
}

function frozenOwnership(
  panelId: PanelId,
  surfaceId: SurfaceId,
  coordinatorEpoch: number,
  state: PanelOwnership["state"],
  transferToken?: string,
  previousSurfaceId?: SurfaceId,
): PanelOwnership {
  return Object.freeze({
    panelId,
    surfaceId,
    coordinatorEpoch,
    state,
    ...(transferToken === undefined ? {} : { transferToken }),
    ...(previousSurfaceId === undefined ? {} : { previousSurfaceId }),
  });
}

function validateEpoch(epoch: number): void {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError("Coordinator epoch must be a non-negative safe integer");
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
