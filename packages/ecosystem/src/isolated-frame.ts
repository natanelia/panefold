import { validateBoundaryValue, type BoundaryLimits } from "./boundary";
import type { PluginManifest } from "./plugins";

export type PluginFramePermission = "clipboard-read" | "clipboard-write" | "fullscreen";

export interface PluginFramePort {
  readonly postMessage: (message: unknown) => void;
  readonly close: () => void;
  readonly start?: () => void;
  readonly addEventListener: (
    type: "message" | "messageerror",
    listener: EventListenerOrEventListenerObject,
  ) => void;
  readonly removeEventListener: (
    type: "message" | "messageerror",
    listener: EventListenerOrEventListenerObject,
  ) => void;
}

export interface PluginFrameChannel {
  readonly port1: PluginFramePort;
  readonly port2: PluginFramePort;
}

export interface PluginFrameEnvelope {
  readonly protocolVersion: number;
  readonly pluginId: string;
  readonly sessionNonce: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: unknown;
}

export interface IsolatedPluginFrameOptions {
  readonly document: Document;
  readonly container: Element;
  readonly manifest: PluginManifest;
  readonly source: string;
  readonly allowedOrigins: readonly string[];
  readonly sessionNonce: string;
  readonly permissions?: readonly PluginFramePermission[];
  readonly allowedMessageTypes: readonly string[];
  readonly boundaryLimits?: Partial<BoundaryLimits>;
  readonly connectTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly createChannel?: () => PluginFrameChannel;
  readonly postConnect?: (
    target: Window,
    message: unknown,
    targetOrigin: string,
    transfer: readonly PluginFramePort[],
  ) => void;
  readonly onMessage: (message: PluginFrameEnvelope) => void;
  readonly onDiagnostic?: (message: string) => void;
}

export interface IsolatedPluginFrame {
  readonly element: HTMLIFrameElement;
  readonly origin: string;
  readonly connect: () => Promise<void>;
  readonly send: (type: string, payload: unknown) => boolean;
  readonly dispose: () => void;
}

/**
 * Creates an untrusted plugin host with a sandboxed iframe and a transferred
 * MessagePort. `allow-same-origin` is intentionally never granted, the target
 * origin is explicit, permissions are allowlisted, and every message is
 * session-bound, sequenced, typed, and bounded.
 */
export function createIsolatedPluginFrame(
  options: IsolatedPluginFrameOptions,
): IsolatedPluginFrame {
  if (options.sessionNonce.length < 16 || options.sessionNonce.length > 512) {
    throw new RangeError("sessionNonce must contain 16 to 512 characters");
  }
  const source = new URL(options.source, options.document.baseURI);
  if (source.protocol !== "https:" && source.protocol !== "http:") {
    throw new TypeError("Plugin frame source must use HTTP or HTTPS");
  }
  if (!options.allowedOrigins.includes(source.origin)) {
    throw new Error(`Plugin frame origin ${source.origin} is not allowlisted`);
  }
  const permissions = options.permissions ?? [];
  if (new Set(permissions).size !== permissions.length) {
    throw new TypeError("Plugin frame permissions must be unique");
  }
  const allowedTypes = new Set(options.allowedMessageTypes);
  if (allowedTypes.size !== options.allowedMessageTypes.length || allowedTypes.size > 256) {
    throw new TypeError("Plugin message types must be unique and contain at most 256 entries");
  }
  for (const type of allowedTypes) validateMessageType(type);
  const timeoutMs = options.connectTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 120_000) {
    throw new RangeError("connectTimeoutMs must be an integer from 0 to 120,000");
  }

  const element = options.document.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts");
  element.setAttribute("referrerpolicy", "no-referrer");
  element.setAttribute("title", `${options.manifest.displayName ?? options.manifest.id} plugin`);
  element.setAttribute("data-panefold-plugin", options.manifest.id);
  if (permissions.length > 0)
    element.setAttribute("allow", [...permissions].sort(compare).join("; "));
  element.src = source.href;
  options.container.append(element);

  let port: PluginFramePort | undefined;
  let connected = false;
  let connecting: Promise<void> | undefined;
  let disposed = false;
  let incomingSequence = 0;
  let outgoingSequence = 0;

  const diagnostic = (message: string) => options.onDiagnostic?.(message);
  const onMessage: EventListener = (event) => {
    const envelope = (event as MessageEvent<unknown>).data;
    const validated = validateEnvelope(envelope, options, allowedTypes, incomingSequence);
    if (!validated.ok) {
      diagnostic(validated.reason);
      return;
    }
    incomingSequence = validated.envelope.sequence;
    try {
      options.onMessage(validated.envelope);
    } catch (error) {
      diagnostic(error instanceof Error ? error.message : "Plugin message observer failed");
    }
  };
  const onMessageError: EventListener = () => diagnostic("Plugin message could not be decoded");

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    port?.removeEventListener("message", onMessage);
    port?.removeEventListener("messageerror", onMessageError);
    port?.close();
    port = undefined;
    element.remove();
  };
  options.signal?.addEventListener("abort", dispose, { once: true });

  return Object.freeze({
    element,
    origin: source.origin,
    connect: () => {
      if (disposed) return Promise.reject(new Error("Plugin frame is disposed"));
      if (connected) return Promise.resolve();
      connecting ??= new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          element.removeEventListener("load", loaded);
          element.removeEventListener("error", failed);
          globalThis.clearTimeout(timer);
        };
        const fail = (error: Error) => {
          cleanup();
          reject(error);
        };
        const failed = () => fail(new Error("Plugin frame failed to load"));
        const loaded = () => {
          const target = element.contentWindow;
          if (target === null) {
            fail(new Error("Plugin frame has no content window"));
            return;
          }
          try {
            const channel =
              options.createChannel?.() ?? (new MessageChannel() as unknown as PluginFrameChannel);
            port = channel.port1;
            port.addEventListener("message", onMessage);
            port.addEventListener("messageerror", onMessageError);
            port.start?.();
            const message = Object.freeze({
              type: "panefold:plugin-connect",
              protocolVersion: options.manifest.protocolVersion,
              pluginId: options.manifest.id,
              sessionNonce: options.sessionNonce,
            });
            if (options.postConnect !== undefined) {
              options.postConnect(target, message, source.origin, [channel.port2]);
            } else {
              target.postMessage(message, source.origin, [
                channel.port2 as unknown as Transferable,
              ]);
            }
            connected = true;
            cleanup();
            resolve();
          } catch (error) {
            fail(error instanceof Error ? error : new Error("Plugin frame connection failed"));
          }
        };
        element.addEventListener("load", loaded, { once: true });
        element.addEventListener("error", failed, { once: true });
        const timer = globalThis.setTimeout(
          () => fail(new Error("Plugin frame connection timed out")),
          timeoutMs,
        );
      });
      return connecting;
    },
    send: (type: string, payload: unknown) => {
      if (!connected || disposed || port === undefined) return false;
      validateMessageType(type);
      const boundary = validateBoundaryValue(payload, options.boundaryLimits);
      if (!boundary.ok) throw new TypeError(`Plugin message ${boundary.path}: ${boundary.reason}`);
      outgoingSequence += 1;
      port.postMessage(
        Object.freeze({
          protocolVersion: options.manifest.protocolVersion,
          pluginId: options.manifest.id,
          sessionNonce: options.sessionNonce,
          sequence: outgoingSequence,
          type,
          payload,
        }),
      );
      return true;
    },
    dispose,
  });
}

type EnvelopeValidation =
  | { readonly ok: true; readonly envelope: PluginFrameEnvelope }
  | { readonly ok: false; readonly reason: string };

function validateEnvelope(
  value: unknown,
  options: IsolatedPluginFrameOptions,
  allowedTypes: ReadonlySet<string>,
  previousSequence: number,
): EnvelopeValidation {
  const boundary = validateBoundaryValue(value, options.boundaryLimits);
  if (!boundary.ok)
    return { ok: false, reason: `Plugin message ${boundary.path}: ${boundary.reason}` };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "Plugin message must be an object" };
  }
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== options.manifest.protocolVersion) {
    return { ok: false, reason: "Plugin message protocol version mismatch" };
  }
  if (record.pluginId !== options.manifest.id || record.sessionNonce !== options.sessionNonce) {
    return { ok: false, reason: "Plugin message failed session authentication" };
  }
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) <= previousSequence) {
    return { ok: false, reason: "Plugin message sequence is stale or invalid" };
  }
  if (typeof record.type !== "string" || !allowedTypes.has(record.type)) {
    return { ok: false, reason: "Plugin message type is not allowed" };
  }
  return {
    ok: true,
    envelope: Object.freeze({
      protocolVersion: record.protocolVersion,
      pluginId: record.pluginId,
      sessionNonce: record.sessionNonce,
      sequence: record.sequence as number,
      type: record.type,
      payload: record.payload,
    }),
  };
}

function validateMessageType(type: string): void {
  if (!/^[a-z][a-z0-9]*(?::[a-z0-9-]+)*$/u.test(type) || type.length > 128) {
    throw new TypeError("Plugin message type must be a bounded namespaced identifier");
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
