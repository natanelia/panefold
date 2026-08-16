import { planPanelDropCommand } from "@panefold/kernel";
import {
  BROWSER_WINDOW_SURFACE_CAPABILITIES,
  getEntity,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type GroupId,
  type JsonObject,
  type PanelId,
  type SurfaceId,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";
import { copyInlineStyles } from "./inline-styles";

import type {
  WorkspaceExternalPanelHandler,
  WorkspaceExternalPanelOutcome,
  WorkspaceExternalPanelRequest,
} from "@panefold/react";
import type { WorkspaceRuntime } from "@panefold/runtime";
import {
  BrowserExternalSurfaceAdapter,
  SurfaceOwnershipRegistry,
  SurfaceTransferCoordinator,
  detectBrowserSurfaceCapabilities,
  type BrowserSurfaceMountContext,
  type PreparedSurfaceHandle,
  type SurfaceTransferError,
} from "@panefold/surfaces";

interface DemoPanelCheckpoint extends JsonObject {
  readonly panelId: string;
  readonly title: string;
  readonly revision: string;
  readonly stableHostId: string;
}

interface ExternalPanelLease {
  readonly adapter: BrowserExternalSurfaceAdapter<DemoPanelCheckpoint>;
  readonly destinationSurfaceId: SurfaceId;
  readonly panelId: PanelId;
  readonly sourceGroupId: GroupId;
  readonly sourceSurfaceId: SurfaceId;
  readonly title: string;
  readonly ownerEpoch: number;
  readonly host: HTMLElement;
  readonly parkingElement: HTMLElement;
  readonly notifyReturnedToOwner: (message: string) => void;
  handle?: PreparedSurfaceHandle;
  recovering: boolean;
}

export interface DemoExternalPanelControllerOptions {
  readonly runtime: WorkspaceRuntime;
  readonly getTheme: () => "dark" | "light";
  readonly getDirection: () => "ltr" | "rtl";
  readonly onStatus: (message: string) => void;
}

/**
 * Demo-only application coordinator. The library owns capability, prepared
 * destination, and exclusive-ownership mechanics; this class supplies the Code workbench
 * policy, deterministic IDs, semantic commands, and its stable React host.
 */
export class DemoExternalPanelController {
  readonly #options: DemoExternalPanelControllerOptions;
  readonly #ownership = new SurfaceOwnershipRegistry();
  readonly #leases = new Map<SurfaceId, ExternalPanelLease>();

  public constructor(options: DemoExternalPanelControllerOptions) {
    this.#options = options;
  }

  public readonly handleRequest: WorkspaceExternalPanelHandler = (request) =>
    this.#transfer(request);

  public async returnAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const lease of [...this.#leases.values()]) {
      try {
        await this.#recover(lease, "application close", true);
      } catch (cause) {
        errors.push(cause);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more external panels could not be returned");
    }
  }

  async #transfer(request: WorkspaceExternalPanelRequest): Promise<WorkspaceExternalPanelOutcome> {
    const start = this.#options.runtime.getSnapshot();
    const panel = getEntity(start.panels, panelId(request.panel.id));
    const sourceGroup = getEntity(start.groups, groupId(request.sourceGroup.id));
    const sourceSurface = findSurfaceForGroup(start, sourceGroup?.id);
    if (
      panel === undefined ||
      sourceGroup === undefined ||
      sourceSurface === undefined ||
      sourceSurface.capabilities.crossDocument ||
      !panel.capabilities.popout ||
      panel.lifecycle.crossDocumentMove !== "portal-coupled"
    ) {
      return this.#rejected(
        `${request.panel.title} cannot leave its current surface under the active policy.`,
      );
    }

    const identity = allocateExternalIdentity(start, panel.id, this.#leases.keys());
    const suffix = identity.suffix;
    const destinationSurfaceId = identity.surface;
    const previousOwnerEpoch = this.#ownership.ownerOf(panel.id)?.coordinatorEpoch ?? -1;
    const ownerEpoch = Math.max(identity.candidate, previousOwnerEpoch + 1);
    const adapter = new BrowserExternalSurfaceAdapter<DemoPanelCheckpoint>({
      environment: { sourceWindow: window },
      mount: (context) => this.#mountExternalPanel(lease, request, context),
      onSurfaceLost: ({ reason }) => {
        void this.#recover(lease, `unexpected ${reason}`, false);
      },
    });
    const lease: ExternalPanelLease = {
      adapter,
      destinationSurfaceId,
      panelId: panel.id,
      sourceGroupId: sourceGroup.id,
      sourceSurfaceId: sourceSurface.id,
      title: request.panel.title,
      ownerEpoch,
      host: request.host,
      parkingElement: request.parkingElement,
      notifyReturnedToOwner: request.notifyReturnedToOwner,
      recovering: false,
    };
    this.#leases.set(destinationSurfaceId, lease);

    const capabilities = detectBrowserSurfaceCapabilities({ sourceWindow: window });
    const coordinator = new SurfaceTransferCoordinator<DemoPanelCheckpoint>({
      adapter,
      ownership: this.#ownership,
      sessionNonce: "atlas-demo-session",
      hooks: {
        currentRevision: () => this.#options.runtime.getSnapshot().revision,
        revalidatePolicy: () => {
          const current = this.#options.runtime.getSnapshot();
          const currentPanel = getEntity(current.panels, panel.id);
          const currentGroup = getEntity(current.groups, sourceGroup.id);
          const currentSurface = findSurfaceForGroup(current, currentGroup?.id);
          return (
            currentPanel?.capabilities.popout === true &&
            currentPanel.lifecycle.crossDocumentMove === "portal-coupled" &&
            currentGroup?.panelIds.includes(panel.id) === true &&
            currentSurface?.id === sourceSurface.id &&
            currentSurface.capabilities.crossDocument === false
          );
        },
        commitOwnership: (ownership) => {
          const current = this.#options.runtime.getSnapshot();
          const command = planExternalTransfer(
            current,
            lease,
            ownership.token,
            suffix,
            request.panel.id,
          );
          if (command === undefined) return false;
          const receipt = this.#options.runtime.dispatch(command, {
            origin: request.origin,
            label: `Open ${request.panel.title} in a browser window`,
            baseRevision: ownership.baseRevision,
            history: "barrier",
          });
          return receipt.status === "committed";
        },
        releaseSource: async () => undefined,
        compensateOwnership: async () => {
          const recovered = this.#commitRecovery(lease, "Compensate failed panel transfer");
          if (!recovered) throw new Error("External panel compensation was rejected");
        },
      },
    });

    const bounds = suggestedBounds(request);
    this.#options.onStatus(`Preparing ${request.panel.title} in a new window…`);
    const result = await coordinator.transfer(
      {
        panelId: panel.id,
        sourceSurfaceId: sourceSurface.id,
        destination: {
          destinationSurfaceId,
          kind: "browser-window",
          bounds,
          security: {
            protocolVersion: 1,
            workspaceId: "atlas-demo",
            sessionNonce: "atlas-demo-session",
            allowedOrigins: [window.location.origin],
          },
          presentation: {
            locale: document.documentElement.lang || "en-SG",
            direction: this.#options.getDirection(),
            writingMode: "horizontal-tb",
            stylesheets: collectStylesheets(document),
            themeTokens: {
              "demo-accent": "#58a6ff",
              "demo-background": "#08101d",
            },
          },
          userActivation: navigator.userActivation?.isActive ?? true,
        },
        sourcePolicy: {
          allowBrowserWindow: true,
          allowDocumentPictureInPicture: false,
        },
        destinationCapabilities:
          capabilities["browser-window"] ?? BROWSER_WINDOW_SURFACE_CAPABILITIES,
        panelCapabilities: {
          popout: panel.capabilities.popout,
          pictureInPicture: panel.capabilities.pictureInPicture,
        },
        baseRevision: start.revision,
        coordinatorEpoch: ownerEpoch,
        checkpoint: async () => ({
          panelId: String(panel.id),
          title: panel.title ?? panel.type,
          revision: start.revision.toString(),
          stableHostId: request.host.id,
        }),
        restorationToken: `panel:${String(panel.id)}:surface:${String(destinationSurfaceId)}`,
      },
      request.signal,
    );

    if (!result.ok) {
      if (shouldRetainExternalLease(result.safeSurfaceId, destinationSurfaceId)) {
        const outcome = destinationRetainedOutcome(request.panel.title, result.error);
        this.#options.onStatus(outcome.message);
        return outcome;
      }
      this.#leases.delete(destinationSurfaceId);
      request.parkingElement.append(request.host);
      return this.#rejected(transferFailureMessage(request.panel.title, result.error));
    }

    this.#options.onStatus(
      `${request.panel.title} is live in a separate browser window · revision ${this.#options.runtime
        .getSnapshot()
        .revision.toString()}`,
    );
    return {
      status: "committed",
      message: `${request.panel.title} opened in a new browser window.`,
    };
  }

  #mountExternalPanel(
    lease: ExternalPanelLease,
    request: WorkspaceExternalPanelRequest,
    context: BrowserSurfaceMountContext<DemoPanelCheckpoint>,
  ) {
    lease.handle = context.handle;
    const disposeInlineStyles = copyInlineStyles(document, context.document);
    const shell = context.document.createElement("section");
    shell.className = "demo-app demo-external-app pf-workspace";
    shell.dataset.theme = this.#options.getTheme();
    shell.dir = this.#options.getDirection();

    const header = context.document.createElement("header");
    header.className = "demo-external-header";
    const title = context.document.createElement("div");
    const eyebrow = context.document.createElement("span");
    eyebrow.textContent = "Panefold browser surface";
    const heading = context.document.createElement("strong");
    heading.textContent = context.checkpoint.title;
    title.append(eyebrow, heading);
    const returnButton = context.document.createElement("button");
    returnButton.type = "button";
    returnButton.textContent = "Return to main window";
    returnButton.addEventListener("click", () => {
      void this.#recover(lease, "requested return", true);
    });
    header.append(title, returnButton);

    const content = context.document.createElement("div");
    content.className = "demo-external-content";
    request.host.setAttribute("aria-label", request.panel.title);
    request.host.removeAttribute("aria-labelledby");
    content.append(request.host);
    shell.append(header, content);
    context.root.append(shell);

    return {
      ready: Promise.resolve(),
      dispose: () => {
        disposeInlineStyles();
        request.parkingElement.append(request.host);
        shell.remove();
      },
    };
  }

  async #recover(
    lease: ExternalPanelLease,
    reason: string,
    closeDestination: boolean,
  ): Promise<void> {
    if (lease.recovering || !this.#leases.has(lease.destinationSurfaceId)) return;
    lease.recovering = true;
    try {
      const committed = this.#commitRecovery(lease, `Return panel after ${reason}`);
      if (!committed) {
        this.#options.onStatus("The panel remains in its external window; recovery was rejected.");
        return;
      }
      this.#ownership.recoverSurface(
        lease.destinationSurfaceId,
        lease.sourceSurfaceId,
        lease.ownerEpoch,
      );
      // The application owns this stable host explicitly. Return it before
      // closing the browser resource so focus restoration never races an
      // advisory adapter disposer.
      lease.parkingElement.append(lease.host);
      if (closeDestination && lease.handle !== undefined) {
        await lease.adapter.close(lease.handle);
      }
      this.#leases.delete(lease.destinationSurfaceId);
      const outcome = returnedPanelOutcome(lease.title, reason);
      this.#options.onStatus(outcome.statusMessage);
      if (reason !== "application close") {
        lease.notifyReturnedToOwner(outcome.announcement);
      }
    } finally {
      lease.recovering = false;
    }
  }

  #commitRecovery(lease: ExternalPanelLease, label: string): boolean {
    const snapshot = this.#options.runtime.getSnapshot();
    const surface = getEntity(snapshot.surfaces, lease.destinationSurfaceId);
    if (surface === undefined) return true;
    const originalGroup = getEntity(snapshot.groups, lease.sourceGroupId);
    const originalSurface = findSurfaceForGroup(snapshot, originalGroup?.id);
    const command: WorkspaceCommand | undefined =
      originalGroup !== undefined && originalSurface?.kind === "main"
        ? {
            type: "redock-surface",
            surfaceId: lease.destinationSurfaceId,
            target: { groupId: originalGroup.id },
            expectedOwnerEpoch: surface.ownerEpoch ?? lease.ownerEpoch,
          }
        : planOrphanRecovery(snapshot, lease);
    if (command === undefined) return false;
    return (
      this.#options.runtime.dispatch(command, {
        origin: "recovery",
        label,
        baseRevision: snapshot.revision,
        history: "barrier",
      }).status === "committed"
    );
  }

  #rejected(message: string): WorkspaceExternalPanelOutcome {
    this.#options.onStatus(message);
    return { status: "rejected", message };
  }
}

/** A failed transfer may still have an authoritative destination owner. */
export function shouldRetainExternalLease(
  safeSurfaceId: SurfaceId,
  destinationSurfaceId: SurfaceId,
): boolean {
  return safeSurfaceId === destinationSurfaceId;
}

/** The interaction committed semantically even when follow-up recovery needs attention. */
export function destinationRetainedOutcome(
  title: string,
  error: Pick<SurfaceTransferError, "code" | "message">,
): { readonly status: "committed"; readonly message: string } {
  const reason =
    error.code === "COMPENSATION_FAILED"
      ? "automatic rollback could not be confirmed"
      : error.message;
  return Object.freeze({
    status: "committed",
    message: `${title} remains assigned to its external window because ${reason}. Use Return to main window to retry recovery.`,
  });
}

/** Demo copy kept separate so status and assistive feedback name the panel consistently. */
export function returnedPanelOutcome(
  title: string,
  reason: string,
): { readonly announcement: string; readonly statusMessage: string } {
  return Object.freeze({
    announcement: `${title} returned to the main window.`,
    statusMessage: `${title} returned to the main workspace after ${reason}.`,
  });
}

/**
 * Finds the first complete popout identity that is absent from both the
 * canonical snapshot and in-flight leases. Persisted IDs are consequently
 * respected after a page reload without relying on a process-local counter.
 */
function allocateExternalIdentity(
  snapshot: WorkspaceSnapshot,
  panel: PanelId,
  leasedSurfaces: Iterable<SurfaceId>,
) {
  const reservedSurfaces = new Set([...leasedSurfaces].map(String));
  for (let candidate = 1; candidate < Number.MAX_SAFE_INTEGER; candidate += 1) {
    const suffix = `${String(panel)}:${String(candidate)}`;
    const group = groupId(`popout-group:${suffix}`);
    const groupNode = nodeId(`popout-node:${suffix}`);
    const splitNode = nodeId(`popout-split:${suffix}`);
    const surface = surfaceId(`browser:${suffix}`);
    if (
      getEntity(snapshot.groups, group) === undefined &&
      getEntity(snapshot.nodes, groupNode) === undefined &&
      getEntity(snapshot.nodes, splitNode) === undefined &&
      getEntity(snapshot.surfaces, surface) === undefined &&
      !reservedSurfaces.has(String(surface))
    ) {
      return Object.freeze({ candidate, suffix, surface });
    }
  }
  throw new Error(`No external surface identity remains available for panel ${String(panel)}`);
}

function planExternalTransfer(
  snapshot: WorkspaceSnapshot,
  lease: ExternalPanelLease,
  preparedSurfaceToken: string,
  suffix: string,
  panelIdValue: string,
): WorkspaceCommand | undefined {
  const source = getEntity(snapshot.groups, lease.sourceGroupId);
  if (source === undefined || !source.panelIds.includes(panelId(panelIdValue))) return undefined;
  const transferGroupId =
    source.panelIds.length === 1 ? source.id : groupId(`popout-group:${suffix}`);
  const transfer: WorkspaceCommand = {
    type: "transfer-to-browser-window",
    groupId: transferGroupId,
    surfaceId: lease.destinationSurfaceId,
    ownerEpoch: lease.ownerEpoch,
    preparedSurfaceToken,
  };
  if (source.panelIds.length === 1) return transfer;

  const splitPlan = planPanelDropCommand(
    snapshot,
    {
      panelId: panelId(panelIdValue),
      target: {
        kind: "edge",
        groupId: source.id,
        edge: "inline-end",
        ratio: 0.5,
      },
    },
    {
      newGroupId: transferGroupId,
      newGroupNodeId: nodeId(`popout-node:${suffix}`),
      splitNodeId: nodeId(`popout-split:${suffix}`),
    },
  );
  if (!splitPlan.ok) return undefined;
  return {
    type: "batch",
    commands: [splitPlan.command, transfer].flatMap((command) =>
      command.type === "batch" ? command.commands : [command],
    ),
  };
}

function planOrphanRecovery(
  snapshot: WorkspaceSnapshot,
  lease: ExternalPanelLease,
): WorkspaceCommand | undefined {
  const targetGroup = firstMainGroup(snapshot, lease.destinationSurfaceId);
  if (targetGroup === undefined) return undefined;
  return {
    type: "recover-orphaned-surface",
    surfaceId: lease.destinationSurfaceId,
    expectedOwnerEpoch: lease.ownerEpoch,
    targetGroupId: targetGroup,
    edge: "inline-end",
    splitNodeId: nodeId(
      `surface-recovery:${String(lease.destinationSurfaceId)}:${snapshot.revision.toString()}`,
    ),
    ratio: 0.35,
  };
}

function firstMainGroup(snapshot: WorkspaceSnapshot, excluded: SurfaceId): GroupId | undefined {
  for (const id of snapshot.surfaces.ids) {
    const surface = getEntity(snapshot.surfaces, id);
    if (surface === undefined || surface.id === excluded || surface.kind !== "main") continue;
    const pending = [surface.rootNodeId];
    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined) break;
      const node = getEntity(snapshot.nodes, current);
      if (node?.kind === "group") return node.groupId;
      if (node?.kind === "split") pending.push(...node.children);
    }
  }
  return undefined;
}

function findSurfaceForGroup(snapshot: WorkspaceSnapshot, candidateGroupId: GroupId | undefined) {
  if (candidateGroupId === undefined) return undefined;
  for (const surfaceIdValue of snapshot.surfaces.ids) {
    const surface = getEntity(snapshot.surfaces, surfaceIdValue);
    if (surface === undefined) continue;
    const pending = [surface.rootNodeId];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      const node = getEntity(snapshot.nodes, current);
      if (node?.kind === "group" && node.groupId === candidateGroupId) return surface;
      if (node?.kind === "split") pending.push(...node.children);
    }
  }
  return undefined;
}

function collectStylesheets(ownerDocument: Document): readonly string[] {
  return Object.freeze(
    [...ownerDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')]
      .map((link) => link.href)
      .filter((href) => new URL(href, ownerDocument.baseURI).origin === window.location.origin),
  );
}

function suggestedBounds(request: WorkspaceExternalPanelRequest) {
  const width = 720;
  const height = 560;
  return {
    x: Math.max(0, Math.round(request.position.screenX - width / 2)),
    y: Math.max(0, Math.round(request.position.screenY - 36)),
    width,
    height,
  };
}

function transferFailureMessage(title: string, error: SurfaceTransferError): string {
  if (error.code === "POPUP_BLOCKED") {
    return `${title} stayed in the workspace because the popup was blocked.`;
  }
  if (error.code === "REVISION_CONFLICT") {
    return `${title} stayed in the workspace because the layout changed during transfer.`;
  }
  return `${title} stayed in the workspace: ${error.message}`;
}
