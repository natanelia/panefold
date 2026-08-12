import type { JsonValue, SurfaceId } from "@panefold/model";

import { intersectSurfaceCapabilities, supportsExternalKind } from "./capabilities";
import type {
  OwnershipToken,
  PreparedSurfaceHandle,
  SurfaceTransferCoordinatorOptions,
  SurfaceTransferErrorCode,
  SurfaceTransferRequest,
  SurfaceTransferResult,
  SurfaceTransferStage,
} from "./types";
import { SurfaceTransferError } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

export class SurfaceTransferCoordinator<Checkpoint extends JsonValue = JsonValue> {
  readonly #options: SurfaceTransferCoordinatorOptions<Checkpoint>;
  readonly #timeoutMs: number;

  public constructor(options: SurfaceTransferCoordinatorOptions<Checkpoint>) {
    if (options.sessionNonce.length === 0) {
      throw new TypeError("sessionNonce must not be empty");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new RangeError("timeoutMs must be a non-negative safe integer");
    }
    this.#options = options;
    this.#timeoutMs = timeoutMs;
  }

  public async transfer(
    request: SurfaceTransferRequest<Checkpoint>,
    signal?: AbortSignal,
  ): Promise<SurfaceTransferResult> {
    const completed: SurfaceTransferStage[] = [];
    let prepared: PreparedSurfaceHandle | undefined;
    let ownership: OwnershipToken | undefined;
    let committed = false;
    let destinationReady = false;
    const timeoutController = new AbortController();
    const combined = combineSignals(signal, timeoutController.signal);
    const setTimer =
      this.#options.setTimer ??
      ((callback: () => void, delayMs: number): unknown =>
        globalThis.setTimeout(callback, delayMs));
    const clearTimer =
      this.#options.clearTimer ??
      ((handle: unknown): void =>
        globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
    const timer = setTimer(() => timeoutController.abort("timeout"), this.#timeoutMs);

    try {
      this.#assertCapability(request);
      completed.push("capability");
      this.#registerSourceOwnership(request);
      prepared = await this.#options.adapter.prepare(request.destination, combined);
      completed.push("prepare");
      this.#assertPrepared(request, prepared);
      await this.#options.adapter.bootstrap(prepared, request.destination, combined);
      completed.push("bootstrap");
      const checkpoint = await request.checkpoint(combined);
      completed.push("checkpoint");
      throwIfAborted(combined);
      if (this.#options.hooks.currentRevision() !== request.baseRevision) {
        throw failure(
          "REVISION_CONFLICT",
          "revalidate",
          "Workspace revision changed while the destination was being prepared.",
          ["Retry the transfer from the current workspace state"],
        );
      }
      completed.push("revalidate");

      ownership = this.#createOwnership(request, prepared);
      if (!this.#options.ownership.begin(ownership)) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "ownership-commit",
          "The panel is no longer owned by the expected source surface.",
          ["Refresh surface ownership", "Retry from the authoritative surface"],
        );
      }
      const kernelCommitted = await this.#options.hooks.commitOwnership(ownership);
      if (!kernelCommitted) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "ownership-commit",
          "Semantic ownership could not be committed atomically.",
          ["Keep the panel in its source surface", "Retry after synchronization"],
        );
      }
      committed = true;
      if (!this.#options.ownership.commit(ownership)) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "ownership-commit",
          "The ownership registry rejected the committed transfer token.",
          ["Compensate semantic ownership", "Retry after synchronization"],
        );
      }
      completed.push("ownership-commit");
      await this.#options.adapter.mount(
        prepared,
        {
          panelId: request.panelId,
          checkpoint,
          ownership,
          ...(request.restorationToken === undefined
            ? {}
            : { restorationToken: request.restorationToken }),
        },
        combined,
      );
      completed.push("destination-mount");
      await this.#options.adapter.waitUntilReady(prepared, combined);
      if (!this.#options.ownership.ready(ownership)) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "destination-ready",
          "Destination readiness did not match the active transfer token.",
          ["Recover the panel to its source surface"],
        );
      }
      destinationReady = true;
      completed.push("destination-ready");
      await this.#options.hooks.releaseSource(ownership);
      completed.push("source-release");
      return Object.freeze({
        ok: true,
        panelId: request.panelId,
        surfaceId: request.destination.destinationSurfaceId,
        ownership,
        completedStages: Object.freeze(completed),
      });
    } catch (cause) {
      const error = normalizeFailure(cause, combined, completed.at(-1));
      let safeSurfaceId = destinationReady
        ? request.destination.destinationSurfaceId
        : (this.#options.ownership.ownerOf(request.panelId)?.surfaceId ?? request.sourceSurfaceId);

      if (!destinationReady && ownership !== undefined) {
        safeSurfaceId = this.#options.ownership.rollback(ownership) ?? request.sourceSurfaceId;
      }
      if (!destinationReady && committed && ownership !== undefined) {
        try {
          await this.#options.hooks.compensateOwnership(ownership, error);
          completed.push("compensation");
        } catch (compensationCause) {
          return Object.freeze({
            ok: false,
            panelId: request.panelId,
            safeSurfaceId,
            error: failure(
              "COMPENSATION_FAILED",
              "compensation",
              "Transfer failed and its ownership compensation also failed.",
              ["Recover the panel into the configured recovery surface", "Export diagnostics"],
              compensationCause,
            ),
            completedStages: Object.freeze(completed),
          });
        }
      }
      if (!destinationReady && prepared !== undefined) {
        try {
          await this.#options.adapter.close(prepared);
        } catch {
          // Destination cleanup is best effort after authoritative ownership is safe.
        }
      }
      return Object.freeze({
        ok: false,
        panelId: request.panelId,
        safeSurfaceId,
        error,
        completedStages: Object.freeze(completed),
      });
    } finally {
      clearTimer(timer);
    }
  }

  public recoverLostSurface(
    lostSurfaceId: SurfaceId,
    recoverySurfaceId: SurfaceId,
    coordinatorEpoch: number,
  ) {
    return this.#options.ownership.recoverSurface(
      lostSurfaceId,
      recoverySurfaceId,
      coordinatorEpoch,
    );
  }

  #assertCapability(request: SurfaceTransferRequest<Checkpoint>): void {
    if (request.destination.security.sessionNonce !== this.#options.sessionNonce) {
      throw failure(
        "PROTOCOL_MISMATCH",
        "capability",
        "Destination security context is not bound to this workspace session.",
        ["Prepare the destination with the active session context"],
      );
    }
    if (!request.destination.userActivation && request.destination.kind === "browser-window") {
      throw failure(
        "USER_ACTIVATION_REQUIRED",
        "capability",
        "Browser-window transfer requires an active user gesture.",
        ["Retry from a button or keyboard command", "Keep the panel in-page"],
      );
    }
    const capabilities = intersectSurfaceCapabilities(request.sourceCapabilities);
    const panelAllowed =
      request.destination.kind === "browser-window"
        ? request.panelCapabilities.popout
        : request.panelCapabilities.pictureInPicture;
    if (!panelAllowed || !supportsExternalKind(request.destination.kind, capabilities)) {
      throw failure(
        "CAPABILITY_DENIED",
        "capability",
        `The panel or source does not support ${request.destination.kind}.`,
        ["Use an in-page floating surface", "Choose a supported panel"],
      );
    }
  }

  #assertPrepared(
    request: SurfaceTransferRequest<Checkpoint>,
    prepared: PreparedSurfaceHandle,
  ): void {
    if (
      prepared.destinationSurfaceId !== request.destination.destinationSurfaceId ||
      prepared.kind !== request.destination.kind ||
      prepared.protocolVersion !== request.destination.security.protocolVersion
    ) {
      throw failure(
        "PROTOCOL_MISMATCH",
        "prepare",
        "Prepared destination identity or protocol version did not match the request.",
        ["Close the destination", "Upgrade the surface adapter"],
      );
    }
  }

  #registerSourceOwnership(request: SurfaceTransferRequest<Checkpoint>): void {
    try {
      this.#options.ownership.register(
        request.panelId,
        request.sourceSurfaceId,
        request.coordinatorEpoch,
      );
    } catch (cause) {
      throw failure(
        "OWNERSHIP_CONFLICT",
        "ownership-commit",
        "The panel is not authoritatively owned by the expected source surface.",
        ["Refresh surface ownership", "Retry from the authoritative surface"],
        cause,
      );
    }
  }

  #createOwnership(
    request: SurfaceTransferRequest<Checkpoint>,
    prepared: PreparedSurfaceHandle,
  ): OwnershipToken {
    const createToken = this.#options.createToken ?? (() => globalThis.crypto.randomUUID());
    return Object.freeze({
      token: `${prepared.token}:${createToken()}`,
      panelId: request.panelId,
      sourceSurfaceId: request.sourceSurfaceId,
      destinationSurfaceId: request.destination.destinationSurfaceId,
      coordinatorEpoch: request.coordinatorEpoch,
      sessionNonce: this.#options.sessionNonce,
      baseRevision: request.baseRevision,
    });
  }
}

function failure(
  code: SurfaceTransferErrorCode,
  stage: SurfaceTransferStage,
  message: string,
  remediation: readonly string[],
  cause?: unknown,
): SurfaceTransferError {
  return new SurfaceTransferError(code, stage, message, Object.freeze([...remediation]), cause);
}

function normalizeFailure(
  cause: unknown,
  signal: AbortSignal,
  lastStage: SurfaceTransferStage | undefined,
): SurfaceTransferError {
  if (cause instanceof SurfaceTransferError) return cause;
  if (signal.aborted) {
    const timedOut = signal.reason === "timeout";
    return failure(
      timedOut ? "TRANSFER_TIMEOUT" : "TRANSFER_CANCELLED",
      nextStage(lastStage),
      timedOut ? "Surface transfer exceeded its time budget." : "Surface transfer was cancelled.",
      ["The panel remains in or returns to a safe in-page surface"],
      cause,
    );
  }
  const stage = nextStage(lastStage);
  const code: SurfaceTransferErrorCode =
    stage === "prepare"
      ? "POPUP_BLOCKED"
      : stage === "bootstrap"
        ? "BOOTSTRAP_FAILED"
        : stage === "checkpoint"
          ? "CHECKPOINT_FAILED"
          : stage === "destination-mount"
            ? "DESTINATION_MOUNT_FAILED"
            : stage === "source-release"
              ? "SOURCE_RELEASE_FAILED"
              : "DESTINATION_CLOSED";
  return failure(
    code,
    stage,
    `Surface transfer failed during ${stage}.`,
    ["Keep or recover the panel in its source surface", "Retry when the capability is available"],
    cause,
  );
}

function nextStage(last: SurfaceTransferStage | undefined): SurfaceTransferStage {
  const order: readonly SurfaceTransferStage[] = [
    "capability",
    "prepare",
    "bootstrap",
    "checkpoint",
    "revalidate",
    "ownership-commit",
    "destination-mount",
    "destination-ready",
    "source-release",
  ];
  const index = last === undefined ? -1 : order.indexOf(last);
  return order[Math.min(index + 1, order.length - 1)] ?? "prepare";
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (first === undefined) return second;
  return AbortSignal.any([first, second]);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
