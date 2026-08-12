import type { JsonValue, SurfaceCapabilities, SurfaceId } from "@panefold/model";

import { SurfaceTransferError } from "./types";
import type {
  ExternalSurfaceAdapter,
  ExternalSurfaceKind,
  PrepareSurfaceRequest,
  PreparedSurfaceHandle,
  SurfaceMountRequest,
} from "./types";

const BROWSER_WINDOW_CAPABILITIES: SurfaceCapabilities = Object.freeze({
  nestedLayout: true,
  floating: false,
  popout: true,
  alwaysOnTop: false,
  freePositioning: true,
  crossDocument: true,
  multiScreenPlacement: false,
});

const DOCUMENT_PIP_CAPABILITIES: SurfaceCapabilities = Object.freeze({
  nestedLayout: false,
  floating: false,
  popout: false,
  alwaysOnTop: true,
  freePositioning: false,
  crossDocument: true,
  multiScreenPlacement: false,
});

export interface DocumentPictureInPictureController {
  requestWindow(options?: { readonly width?: number; readonly height?: number }): Promise<Window>;
}

export interface BrowserSurfaceEnvironment {
  /** Explicit injection keeps package import and tests independent of ambient browser globals. */
  readonly sourceWindow: Window;
  readonly openWindow?: (url: string, target: string, features: string) => Window | null;
  readonly documentPictureInPicture?: DocumentPictureInPictureController;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface BrowserSurfaceMountContext<Checkpoint extends JsonValue = JsonValue> {
  readonly checkpoint: Checkpoint;
  readonly document: Document;
  readonly handle: PreparedSurfaceHandle;
  readonly mount: SurfaceMountRequest<Checkpoint>;
  readonly root: HTMLElement;
  readonly window: Window;
}

export interface BrowserSurfaceMountLease {
  /** Resolves only after the destination renderer can authoritatively own the panel. */
  readonly ready?: Promise<void>;
  /** Called at most once on rollback, intentional close, or unexpected surface loss. */
  readonly dispose?: () => void | Promise<void>;
}

export interface BrowserSurfaceLoss {
  readonly destinationSurfaceId: SurfaceId;
  readonly kind: ExternalSurfaceKind;
  readonly reason: "pagehide" | "closed";
}

export interface BrowserExternalSurfaceAdapterOptions<Checkpoint extends JsonValue = JsonValue> {
  readonly environment: BrowserSurfaceEnvironment;
  readonly mount: (
    context: BrowserSurfaceMountContext<Checkpoint>,
  ) => void | BrowserSurfaceMountLease | Promise<void | BrowserSurfaceMountLease>;
  readonly onSurfaceLost?: (loss: BrowserSurfaceLoss) => void;
}

interface BrowserPreparedResource {
  readonly destinationWindow: Window;
  readonly request: PrepareSurfaceRequest;
  dispose: (() => void | Promise<void>) | undefined;
  intentionalClose: boolean;
  lostNotified: boolean;
  mounted: boolean;
  ready: Promise<void>;
  removeLossListener: () => void;
  stopClosedWatch: () => void;
}

/**
 * Operational same-origin adapter for popup and Document Picture-in-Picture
 * destinations. It creates the browser resource during user activation, but
 * leaves framework rendering to an injected checkpoint/remount callback.
 */
export class BrowserExternalSurfaceAdapter<
  Checkpoint extends JsonValue = JsonValue,
> implements ExternalSurfaceAdapter<Checkpoint> {
  readonly #options: BrowserExternalSurfaceAdapterOptions<Checkpoint>;
  readonly #resources = new WeakSet<BrowserPreparedResource>();

  public constructor(options: BrowserExternalSurfaceAdapterOptions<Checkpoint>) {
    this.#options = options;
  }

  public async prepare(
    request: PrepareSurfaceRequest,
    signal: AbortSignal,
  ): Promise<PreparedSurfaceHandle> {
    throwIfAborted(signal);
    const destinationWindow = await this.#createDestination(request, signal);
    const resource: BrowserPreparedResource = {
      destinationWindow,
      request,
      dispose: undefined,
      intentionalClose: false,
      lostNotified: false,
      mounted: false,
      ready: Promise.resolve(),
      removeLossListener: () => undefined,
      stopClosedWatch: () => undefined,
    };
    this.#resources.add(resource);
    resource.removeLossListener = this.#listenForLoss(resource);
    resource.stopClosedWatch = this.#watchForClosedWindow(resource);

    return Object.freeze({
      resource,
      destinationSurfaceId: request.destinationSurfaceId,
      kind: request.kind,
      token: createOpaqueToken(this.#options.environment.sourceWindow),
      protocolVersion: request.security.protocolVersion,
    });
  }

  public async bootstrap(
    handle: PreparedSurfaceHandle,
    context: PrepareSurfaceRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const resource = this.#resource(handle);
    throwIfAborted(signal);
    this.#assertLive(resource, "bootstrap");
    this.#assertSecurityContext(resource, context);

    const document = resource.destinationWindow.document;
    const { presentation, security } = context;
    document.documentElement.lang = presentation.locale;
    document.documentElement.dir = presentation.direction;
    document.documentElement.style.writingMode = presentation.writingMode;
    document.title = "Panefold workspace surface";

    const head = document.head;
    const body = document.body;
    // This initializes only the app-owned destination DOM. A supplied nonce is
    // copied to generated stylesheet nodes; the adapter neither installs nor
    // claims to enforce a Content Security Policy.
    head.replaceChildren();
    body.replaceChildren();

    head.append(
      createMeta(document, "charset", "utf-8"),
      createMeta(document, "name", "viewport", "width=device-width,initial-scale=1"),
      createMeta(document, "name", "panefold-protocol-version", String(security.protocolVersion)),
      createMeta(document, "name", "panefold-workspace-id", security.workspaceId),
    );

    for (const stylesheet of presentation.stylesheets) {
      const href = validateStylesheetUrl(stylesheet, context, resource.destinationWindow);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      if (security.cspNonce !== undefined) link.nonce = security.cspNonce;
      head.append(link);
    }

    const root = document.createElement("main");
    root.id = "panefold-surface-root";
    root.dataset.panefoldSurface = String(context.destinationSurfaceId);
    root.dataset.panefoldSurfaceKind = context.kind;
    root.dataset.panefoldReady = "false";
    root.setAttribute("aria-label", "External workspace surface");
    for (const [name, value] of Object.entries(presentation.themeTokens)) {
      root.style.setProperty(normalizeThemeToken(name), value);
    }
    body.append(root);
  }

  public async mount(
    handle: PreparedSurfaceHandle,
    request: SurfaceMountRequest<Checkpoint>,
    signal: AbortSignal,
  ): Promise<void> {
    const resource = this.#resource(handle);
    throwIfAborted(signal);
    this.#assertLive(resource, "destination-mount");
    if (resource.mounted) {
      throw new SurfaceTransferError(
        "OWNERSHIP_CONFLICT",
        "destination-mount",
        "A prepared destination can mount only one authoritative panel lease.",
        ["Close the duplicate destination", "Retry with a fresh prepared surface"],
      );
    }
    const document = resource.destinationWindow.document;
    const root = document.getElementById("panefold-surface-root");
    if (root === null) {
      throw new SurfaceTransferError(
        "BOOTSTRAP_FAILED",
        "destination-mount",
        "The destination root was removed before the renderer mounted.",
        ["Keep the panel in its source surface", "Prepare a new destination"],
      );
    }

    resource.mounted = true;
    const lease = await this.#options.mount({
      checkpoint: request.checkpoint,
      document,
      handle,
      mount: request,
      root,
      window: resource.destinationWindow,
    });
    if (lease !== undefined) {
      resource.dispose = lease.dispose;
      resource.ready = lease.ready ?? Promise.resolve();
    }
  }

  public async waitUntilReady(handle: PreparedSurfaceHandle, signal: AbortSignal): Promise<void> {
    const resource = this.#resource(handle);
    throwIfAborted(signal);
    this.#assertLive(resource, "destination-ready");
    await waitWithSignal(resource.ready, signal);
    this.#assertLive(resource, "destination-ready");
    const root = resource.destinationWindow.document.getElementById("panefold-surface-root");
    if (root === null) {
      throw new SurfaceTransferError(
        "DESTINATION_CLOSED",
        "destination-ready",
        "The destination root disappeared before readiness acknowledgement.",
        ["Recover the panel to its source surface"],
      );
    }
    root.dataset.panefoldReady = "true";
  }

  public async close(handle: PreparedSurfaceHandle): Promise<void> {
    const resource = this.#resource(handle);
    if (resource.intentionalClose) return;
    resource.intentionalClose = true;
    resource.removeLossListener();
    resource.stopClosedWatch();
    try {
      await disposeOnce(resource);
    } catch {
      // Application cleanup is isolated so a rejected disposer cannot strand
      // an external browser surface or turn an intentional close into loss.
    }
    if (!resource.destinationWindow.closed) resource.destinationWindow.close();
  }

  async #createDestination(request: PrepareSurfaceRequest, signal: AbortSignal): Promise<Window> {
    if (!request.userActivation) {
      throw new SurfaceTransferError(
        "USER_ACTIVATION_REQUIRED",
        "prepare",
        `${request.kind} requires an active user gesture.`,
        ["Retry from a button or keyboard command", "Keep the panel in-page"],
      );
    }
    if (request.kind === "document-pip") {
      const controller = this.#options.environment.documentPictureInPicture;
      if (controller === undefined) {
        throw new SurfaceTransferError(
          "CAPABILITY_DENIED",
          "prepare",
          "Document Picture-in-Picture is unavailable in this browser.",
          ["Use an in-page floating surface", "Use a supported browser profile"],
        );
      }
      const pipWindow = await waitWithSignal(
        controller.requestWindow({
          ...(request.bounds?.width === undefined
            ? {}
            : { width: Math.max(1, Math.round(request.bounds.width)) }),
          ...(request.bounds?.height === undefined
            ? {}
            : { height: Math.max(1, Math.round(request.bounds.height)) }),
        }),
        signal,
      );
      return pipWindow;
    }

    const openWindow =
      this.#options.environment.openWindow ??
      this.#options.environment.sourceWindow.open.bind(this.#options.environment.sourceWindow);
    const destination = openWindow(
      "about:blank",
      surfaceTargetName(request.destinationSurfaceId),
      popupFeatures(request),
    );
    if (destination === null) {
      throw new SurfaceTransferError(
        "POPUP_BLOCKED",
        "prepare",
        "The browser blocked the workspace popup.",
        ["Allow popups for this application", "Keep the panel in-page"],
      );
    }
    return destination;
  }

  #assertSecurityContext(resource: BrowserPreparedResource, context: PrepareSurfaceRequest): void {
    if (
      context.destinationSurfaceId !== resource.request.destinationSurfaceId ||
      context.kind !== resource.request.kind ||
      context.security.sessionNonce !== resource.request.security.sessionNonce ||
      context.security.workspaceId !== resource.request.security.workspaceId ||
      context.security.protocolVersion !== resource.request.security.protocolVersion
    ) {
      throw new SurfaceTransferError(
        "PROTOCOL_MISMATCH",
        "bootstrap",
        "The destination bootstrap context does not match its prepared session.",
        ["Close the destination", "Prepare it again from the active workspace session"],
      );
    }

    const sourceOrigin = safeOrigin(this.#options.environment.sourceWindow);
    const destinationOrigin = safeOrigin(resource.destinationWindow);
    const allowed = new Set(context.security.allowedOrigins);
    const sameOrigin =
      sourceOrigin !== undefined &&
      (destinationOrigin === sourceOrigin || isInheritedBlankDocument(resource.destinationWindow));
    if (!sameOrigin || !allowed.has(sourceOrigin)) {
      throw new SurfaceTransferError(
        "PROTOCOL_MISMATCH",
        "bootstrap",
        "The external surface is not a same-origin destination allowed by this session.",
        ["Use an explicitly allowed same-origin destination", "Keep the panel in-page"],
      );
    }
  }

  #assertLive(
    resource: BrowserPreparedResource,
    stage: "bootstrap" | "destination-mount" | "destination-ready",
  ) {
    if (!resource.destinationWindow.closed) return;
    throw new SurfaceTransferError(
      "DESTINATION_CLOSED",
      stage,
      "The external surface closed before ownership became ready.",
      ["Recover the panel to its source surface"],
    );
  }

  #listenForLoss(resource: BrowserPreparedResource): () => void {
    const onPageHide = () => {
      this.#notifyLoss(resource, "pagehide");
    };
    resource.destinationWindow.addEventListener("pagehide", onPageHide, { once: true });
    return () => {
      resource.destinationWindow.removeEventListener("pagehide", onPageHide);
    };
  }

  #watchForClosedWindow(resource: BrowserPreparedResource): () => void {
    const setTimer =
      this.#options.environment.setTimer ??
      ((callback: () => void, delayMs: number): unknown =>
        this.#options.environment.sourceWindow.setTimeout(callback, delayMs));
    const clearTimer =
      this.#options.environment.clearTimer ??
      ((handle: unknown): void => {
        this.#options.environment.sourceWindow.clearTimeout(handle as number);
      });
    const check = () => {
      if (resource.intentionalClose || resource.lostNotified) return;
      if (resource.destinationWindow.closed) {
        this.#notifyLoss(resource, "closed");
        return;
      }
      timer = setTimer(check, 250);
    };
    let timer = setTimer(check, 250);
    return () => {
      clearTimer(timer);
    };
  }

  #notifyLoss(resource: BrowserPreparedResource, reason: BrowserSurfaceLoss["reason"]): void {
    if (resource.intentionalClose || resource.lostNotified) return;
    resource.lostNotified = true;
    resource.removeLossListener();
    resource.stopClosedWatch();
    void disposeOnce(resource).catch(() => {
      // Loss recovery is already authoritative; disposal failure must not
      // escape the browser event or prevent the application recovery hook.
    });
    try {
      this.#options.onSurfaceLost?.({
        destinationSurfaceId: resource.request.destinationSurfaceId,
        kind: resource.request.kind,
        reason,
      });
    } catch {
      // Observational recovery callbacks are isolated from adapter ownership.
    }
  }

  #resource(handle: PreparedSurfaceHandle): BrowserPreparedResource {
    const resource = handle.resource as BrowserPreparedResource;
    if (!this.#resources.has(resource)) {
      throw new TypeError("Prepared surface handle belongs to another browser adapter");
    }
    return resource;
  }
}

export function detectBrowserSurfaceCapabilities(
  environment: BrowserSurfaceEnvironment,
): Readonly<Record<ExternalSurfaceKind, SurfaceCapabilities>> {
  return Object.freeze({
    "browser-window": BROWSER_WINDOW_CAPABILITIES,
    "document-pip":
      environment.documentPictureInPicture === undefined
        ? Object.freeze({ ...DOCUMENT_PIP_CAPABILITIES, alwaysOnTop: false, crossDocument: false })
        : DOCUMENT_PIP_CAPABILITIES,
  });
}

function createMeta(
  document: Document,
  attribute: "charset" | "name",
  name: string,
  content?: string,
): HTMLMetaElement {
  const meta = document.createElement("meta");
  if (attribute === "charset") meta.setAttribute("charset", name);
  else {
    meta.name = name;
    meta.content = content ?? "";
  }
  return meta;
}

function normalizeThemeToken(name: string): string {
  const trimmed = name.trim();
  const normalized = trimmed.startsWith("--") ? trimmed : `--${trimmed}`;
  if (!/^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(normalized)) {
    throw new TypeError(`Invalid theme token name: ${name}`);
  }
  return normalized;
}

function validateStylesheetUrl(
  stylesheet: string,
  request: PrepareSurfaceRequest,
  destinationWindow: Window,
): string {
  const url = new URL(stylesheet, destinationWindow.document.baseURI);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SurfaceTransferError(
      "BOOTSTRAP_FAILED",
      "bootstrap",
      `Stylesheet protocol ${url.protocol} is not allowed.`,
      ["Use an allowed HTTP(S) stylesheet"],
    );
  }
  if (!request.security.allowedOrigins.includes(url.origin)) {
    throw new SurfaceTransferError(
      "BOOTSTRAP_FAILED",
      "bootstrap",
      `Stylesheet origin ${url.origin} is not allowed by the surface context.`,
      ["Allow the stylesheet origin explicitly", "Use an application-hosted stylesheet"],
    );
  }
  return url.href;
}

function popupFeatures(request: PrepareSurfaceRequest): string {
  const bounds = request.bounds;
  const values = ["popup=yes"];
  if (bounds !== undefined) {
    values.push(
      `left=${Math.round(bounds.x)}`,
      `top=${Math.round(bounds.y)}`,
      `width=${Math.max(1, Math.round(bounds.width))}`,
      `height=${Math.max(1, Math.round(bounds.height))}`,
    );
  }
  return values.join(",");
}

function surfaceTargetName(surfaceId: SurfaceId): string {
  return `panefold-${String(surfaceId).replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function safeOrigin(window: Window): string | undefined {
  try {
    const origin = window.location.origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

function isInheritedBlankDocument(window: Window): boolean {
  try {
    return window.location.href === "about:blank";
  } catch {
    return false;
  }
}

function createOpaqueToken(window: Window): string {
  const randomUUID = window.crypto?.randomUUID?.bind(window.crypto);
  if (randomUUID !== undefined) return randomUUID();
  const values = new Uint32Array(4);
  window.crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(8, "0")).join("");
}

async function disposeOnce(resource: BrowserPreparedResource): Promise<void> {
  const dispose = resource.dispose;
  resource.dispose = undefined;
  await dispose?.();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

async function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
    };
    const finish = <Value>(callback: (value: Value) => void, value: Value) => {
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(resolve, value),
      (error: unknown) => finish(reject, error),
    );
  });
}
