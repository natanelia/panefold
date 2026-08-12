import type {
  JsonValue,
  PanelId,
  Rect,
  Revision,
  SurfaceCapabilities,
  SurfaceId,
  SurfaceKind,
} from "@panefold/model";

export type ExternalSurfaceKind = Extract<SurfaceKind, "browser-window" | "document-pip">;

export interface SurfaceSecurityContext {
  readonly protocolVersion: number;
  readonly workspaceId: string;
  readonly sessionNonce: string;
  readonly allowedOrigins: readonly string[];
  readonly cspNonce?: string;
}

export interface SurfacePresentationContext {
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
  readonly writingMode: "horizontal-tb" | "vertical-rl" | "vertical-lr";
  readonly stylesheets: readonly string[];
  readonly themeTokens: Readonly<Record<string, string>>;
}

export interface SurfaceCapabilityProfile {
  readonly kind: SurfaceKind;
  readonly capabilities: SurfaceCapabilities;
}

export interface PreparedSurfaceHandle {
  /** Opaque process-local identity. It is never persisted or used as canonical identity. */
  readonly resource: object;
  readonly destinationSurfaceId: SurfaceId;
  readonly kind: ExternalSurfaceKind;
  readonly token: string;
  readonly protocolVersion: number;
}

export interface PrepareSurfaceRequest {
  readonly destinationSurfaceId: SurfaceId;
  readonly kind: ExternalSurfaceKind;
  readonly bounds?: Rect;
  readonly security: SurfaceSecurityContext;
  readonly presentation: SurfacePresentationContext;
  readonly userActivation: boolean;
}

export interface SurfaceMountRequest<Checkpoint extends JsonValue = JsonValue> {
  readonly panelId: PanelId;
  readonly checkpoint: Checkpoint;
  readonly ownership: OwnershipToken;
  readonly restorationToken?: string;
}

export interface ExternalSurfaceAdapter<Checkpoint extends JsonValue = JsonValue> {
  prepare(request: PrepareSurfaceRequest, signal: AbortSignal): Promise<PreparedSurfaceHandle>;
  bootstrap(
    handle: PreparedSurfaceHandle,
    context: PrepareSurfaceRequest,
    signal: AbortSignal,
  ): Promise<void>;
  mount(
    handle: PreparedSurfaceHandle,
    request: SurfaceMountRequest<Checkpoint>,
    signal: AbortSignal,
  ): Promise<void>;
  waitUntilReady(handle: PreparedSurfaceHandle, signal: AbortSignal): Promise<void>;
  close(handle: PreparedSurfaceHandle): Promise<void>;
}

export interface OwnershipToken {
  readonly token: string;
  readonly panelId: PanelId;
  readonly sourceSurfaceId: SurfaceId;
  readonly destinationSurfaceId: SurfaceId;
  readonly coordinatorEpoch: number;
  readonly sessionNonce: string;
  readonly baseRevision: Revision;
}

export type OwnershipState = "owned" | "transferring" | "destination-pending-ready";

export interface PanelOwnership {
  readonly panelId: PanelId;
  readonly surfaceId: SurfaceId;
  readonly coordinatorEpoch: number;
  readonly state: OwnershipState;
  readonly transferToken?: string;
  readonly previousSurfaceId?: SurfaceId;
}

export type SurfaceTransferStage =
  | "capability"
  | "prepare"
  | "bootstrap"
  | "checkpoint"
  | "revalidate"
  | "ownership-commit"
  | "destination-mount"
  | "destination-ready"
  | "source-release"
  | "compensation";

export type SurfaceTransferErrorCode =
  | "CAPABILITY_DENIED"
  | "USER_ACTIVATION_REQUIRED"
  | "POPUP_BLOCKED"
  | "BOOTSTRAP_FAILED"
  | "CHECKPOINT_FAILED"
  | "REVISION_CONFLICT"
  | "OWNERSHIP_CONFLICT"
  | "DESTINATION_MOUNT_FAILED"
  | "DESTINATION_CLOSED"
  | "SOURCE_RELEASE_FAILED"
  | "TRANSFER_TIMEOUT"
  | "TRANSFER_CANCELLED"
  | "COMPENSATION_FAILED"
  | "PROTOCOL_MISMATCH";

export class SurfaceTransferError extends Error {
  public override readonly name = "SurfaceTransferError";

  public constructor(
    public readonly code: SurfaceTransferErrorCode,
    public readonly stage: SurfaceTransferStage,
    message: string,
    public readonly remediation: readonly string[],
    public readonly originalCause?: unknown,
  ) {
    super(message);
  }
}

export type SurfaceTransferResult =
  | {
      readonly ok: true;
      readonly panelId: PanelId;
      readonly surfaceId: SurfaceId;
      readonly ownership: OwnershipToken;
      readonly completedStages: readonly SurfaceTransferStage[];
    }
  | {
      readonly ok: false;
      readonly panelId: PanelId;
      /** The authoritative safe owner after rollback or compensation. */
      readonly safeSurfaceId: SurfaceId;
      readonly error: SurfaceTransferError;
      readonly completedStages: readonly SurfaceTransferStage[];
    };

export interface SurfaceTransferRequest<Checkpoint extends JsonValue = JsonValue> {
  readonly panelId: PanelId;
  readonly sourceSurfaceId: SurfaceId;
  readonly destination: PrepareSurfaceRequest;
  readonly sourceCapabilities: SurfaceCapabilities;
  readonly panelCapabilities: {
    readonly popout: boolean;
    readonly pictureInPicture: boolean;
  };
  readonly baseRevision: Revision;
  readonly coordinatorEpoch: number;
  checkpoint(signal: AbortSignal): Promise<Checkpoint>;
  readonly restorationToken?: string;
}

export interface SurfaceTransferHooks {
  currentRevision(): Revision;
  commitOwnership(token: OwnershipToken): Promise<boolean>;
  releaseSource(token: OwnershipToken): Promise<void>;
  compensateOwnership(token: OwnershipToken, reason: SurfaceTransferError): Promise<void>;
}

export interface SurfaceTransferCoordinatorOptions<Checkpoint extends JsonValue = JsonValue> {
  readonly adapter: ExternalSurfaceAdapter<Checkpoint>;
  readonly ownership: SurfaceOwnershipRegistryPort;
  readonly hooks: SurfaceTransferHooks;
  readonly sessionNonce: string;
  readonly timeoutMs?: number;
  readonly createToken?: () => string;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface SurfaceOwnershipRegistryPort {
  register(panelId: PanelId, surfaceId: SurfaceId, coordinatorEpoch: number): void;
  begin(token: OwnershipToken): boolean;
  commit(token: OwnershipToken): boolean;
  ready(token: OwnershipToken): boolean;
  rollback(token: OwnershipToken): SurfaceId | undefined;
  recoverSurface(
    lostSurfaceId: SurfaceId,
    recoverySurfaceId: SurfaceId,
    coordinatorEpoch: number,
  ): readonly PanelId[];
  ownerOf(panelId: PanelId): PanelOwnership | undefined;
  snapshot(): readonly PanelOwnership[];
}
