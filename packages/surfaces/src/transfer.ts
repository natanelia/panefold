import type { JsonValue, SurfaceId } from "@panefold/model";

import { supportsExternalKind } from "./capabilities";
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
    let requiresCompensation = false;
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
      throwIfAborted(combined);
      this.#assertCapability(request);
      completed.push("capability");
      this.#registerSourceOwnership(request);
      const preparation = invokeAsPromise(() =>
        this.#options.adapter.prepare(request.destination, combined),
      );
      try {
        prepared = await waitWithSignal(preparation, combined);
      } catch (cause) {
        closeLatePreparation(preparation, this.#options.adapter);
        throw cause;
      }
      const preparedHandle = prepared;
      completed.push("prepare");
      this.#assertPrepared(request, preparedHandle);
      await runWithSignal(
        () => this.#options.adapter.bootstrap(preparedHandle, request.destination, combined),
        combined,
      );
      completed.push("bootstrap");
      const checkpoint = await runWithSignal(() => request.checkpoint(combined), combined);
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

      ownership = this.#createOwnership(request, preparedHandle);
      const ownershipToken = ownership;
      if (!this.#options.ownership.begin(ownershipToken)) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "ownership-commit",
          "The panel is no longer owned by the expected source surface.",
          ["Refresh surface ownership", "Retry from the authoritative surface"],
        );
      }
      requiresCompensation = true;
      throwIfAborted(combined);
      const kernelCommitted = this.#options.hooks.commitOwnership(ownershipToken);
      if (!kernelCommitted) {
        requiresCompensation = false;
        throw failure(
          "OWNERSHIP_CONFLICT",
          "ownership-commit",
          "Semantic ownership could not be committed atomically.",
          ["Keep the panel in its source surface", "Retry after synchronization"],
        );
      }
      if (!this.#options.ownership.commit(ownershipToken)) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "ownership-commit",
          "The ownership registry rejected the committed transfer token.",
          ["Compensate semantic ownership", "Retry after synchronization"],
        );
      }
      completed.push("ownership-commit");
      await runWithSignal(
        () =>
          this.#options.adapter.mount(
            preparedHandle,
            {
              panelId: request.panelId,
              checkpoint,
              ownership: ownershipToken,
              ...(request.restorationToken === undefined
                ? {}
                : { restorationToken: request.restorationToken }),
            },
            combined,
          ),
        combined,
      );
      completed.push("destination-mount");
      await runWithSignal(
        () => this.#options.adapter.waitUntilReady(preparedHandle, combined),
        combined,
      );
      if (!this.#options.ownership.ready(ownershipToken)) {
        throw failure(
          "OWNERSHIP_CONFLICT",
          "destination-ready",
          "Destination readiness did not match the active transfer token.",
          ["Recover the panel to its source surface"],
        );
      }
      destinationReady = true;
      completed.push("destination-ready");
      await runWithSignal(
        () => this.#options.hooks.releaseSource(ownershipToken, combined),
        combined,
      );
      completed.push("source-release");
      return Object.freeze({
        ok: true,
        panelId: request.panelId,
        surfaceId: request.destination.destinationSurfaceId,
        ownership: ownershipToken,
        completedStages: Object.freeze(completed),
      });
    } catch (cause) {
      const error = normalizeFailure(cause, combined, completed.at(-1));
      let safeSurfaceId = destinationReady
        ? request.destination.destinationSurfaceId
        : (this.#options.ownership.ownerOf(request.panelId)?.surfaceId ?? request.sourceSurfaceId);
      let reportedError = error;
      if (!destinationReady && requiresCompensation && ownership !== undefined) {
        const ownershipToken = ownership;
        const compensationController = new AbortController();
        const compensationSignal = compensationController.signal;
        const compensationTimer = setTimer(
          () => compensationController.abort("timeout"),
          this.#timeoutMs,
        );
        const compensation = invokeAsPromise(() =>
          this.#options.hooks.compensateOwnership(ownershipToken, error, compensationSignal),
        );
        try {
          await waitWithSignal(compensation, compensationSignal);
          safeSurfaceId =
            this.#options.ownership.rollback(ownershipToken) ?? request.sourceSurfaceId;
          completed.push("compensation");
        } catch (compensationCause) {
          reportedError = failure(
            "COMPENSATION_FAILED",
            "compensation",
            "Transfer failed and its ownership compensation did not complete authoritatively.",
            ["Recover the panel into the configured recovery surface", "Export diagnostics"],
            compensationCause,
          );
          safeSurfaceId =
            this.#options.ownership.ownerOf(request.panelId)?.surfaceId ?? safeSurfaceId;
          if (compensationSignal.aborted) {
            observeLateCompensation(
              compensation,
              ownershipToken,
              prepared,
              this.#options.ownership,
              this.#options.adapter,
            );
          }
        } finally {
          clearTimer(compensationTimer);
        }
      } else if (!destinationReady && ownership !== undefined) {
        safeSurfaceId = this.#options.ownership.rollback(ownership) ?? request.sourceSurfaceId;
      }
      if (
        !destinationReady &&
        prepared !== undefined &&
        reportedError.code !== "COMPENSATION_FAILED"
      ) {
        const preparedHandle = prepared;
        const cleanupController = new AbortController();
        const cleanupSignal = cleanupController.signal;
        const cleanupTimer = setTimer(() => cleanupController.abort("timeout"), this.#timeoutMs);
        try {
          const cleanup = invokeAsPromise(() => this.#options.adapter.close(preparedHandle));
          await waitWithSignal(cleanup, cleanupSignal);
        } catch (cleanupCause) {
          if (cleanupSignal.reason === "timeout") {
            reportedError = failure(
              "TRANSFER_TIMEOUT",
              reportedError.stage,
              "Surface transfer cleanup exceeded its time budget.",
              ["Authoritative ownership is safe; retry destination cleanup"],
              cleanupCause,
            );
          }
          // Destination cleanup is best effort after authoritative ownership is safe.
        } finally {
          clearTimer(cleanupTimer);
        }
      }
      return Object.freeze({
        ok: false,
        panelId: request.panelId,
        safeSurfaceId,
        error: reportedError,
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
    const sourcePolicy = request.sourcePolicy;
    const destinationCapabilities = request.destinationCapabilities;
    if (
      "sourceCapabilities" in request ||
      sourcePolicy === undefined ||
      destinationCapabilities === undefined
    ) {
      throw failure(
        "CAPABILITY_DENIED",
        "capability",
        "Legacy source capabilities cannot prove an external transfer is allowed.",
        [
          "Provide an explicit source transfer policy",
          "Provide capabilities detected for the prepared destination kind",
        ],
      );
    }
    const sourceAllowed =
      request.destination.kind === "browser-window"
        ? sourcePolicy.allowBrowserWindow
        : sourcePolicy.allowDocumentPictureInPicture;
    const panelAllowed =
      request.destination.kind === "browser-window"
        ? request.panelCapabilities.popout
        : request.panelCapabilities.pictureInPicture;
    if (
      !sourceAllowed ||
      !panelAllowed ||
      !supportsExternalKind(request.destination.kind, destinationCapabilities)
    ) {
      throw failure(
        "CAPABILITY_DENIED",
        "capability",
        `The source policy, panel, or destination does not support ${request.destination.kind}.`,
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

function closeLatePreparation<Checkpoint extends JsonValue>(
  preparation: Promise<PreparedSurfaceHandle>,
  adapter: SurfaceTransferCoordinatorOptions<Checkpoint>["adapter"],
): void {
  void preparation.then(
    (handle) => {
      void invokeAsPromise(() => adapter.close(handle)).catch(() => {
        // A destination prepared after cancellation is abandoned; closing it
        // remains best effort and cannot retain the completed transfer.
      });
    },
    () => {
      // The primary wait already observes the preparation rejection.
    },
  );
}

function observeLateCompensation<Checkpoint extends JsonValue>(
  compensation: Promise<void>,
  ownership: OwnershipToken,
  prepared: PreparedSurfaceHandle | undefined,
  registry: SurfaceTransferCoordinatorOptions<Checkpoint>["ownership"],
  adapter: SurfaceTransferCoordinatorOptions<Checkpoint>["adapter"],
): void {
  void compensation.then(
    () => {
      const recovered = registry.rollback(ownership);
      if (recovered === undefined || prepared === undefined) return;
      void invokeAsPromise(() => adapter.close(prepared)).catch(() => {
        // Late semantic recovery is authoritative even if browser cleanup fails.
      });
    },
    () => {
      // The bounded compensation path already reported this failure.
    },
  );
}

function invokeAsPromise<Value>(operation: () => Value | PromiseLike<Value>): Promise<Value> {
  try {
    return Promise.resolve(operation());
  } catch (cause) {
    return Promise.reject(cause);
  }
}

function runWithSignal<Value>(
  operation: () => Value | PromiseLike<Value>,
  signal: AbortSignal,
): Promise<Value> {
  throwIfAborted(signal);
  return waitWithSignal(invokeAsPromise(operation), signal);
}

function waitWithSignal<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = () => {
      if (finish()) reject(signal.reason);
    };

    // Attach both reactions before observing an already-aborted signal. This
    // contains late rejections from callbacks that ignore cancellation.
    promise.then(
      (value) => {
        if (finish()) resolve(value);
      },
      (cause: unknown) => {
        if (finish()) reject(cause);
      },
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
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
