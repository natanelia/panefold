// @vitest-environment jsdom

import { panelId, revision, surfaceId, type JsonValue } from "@panefold/model";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserExternalSurfaceAdapter,
  SurfaceOwnershipRegistry,
  SurfaceTransferCoordinator,
  SurfaceTransferError,
  detectBrowserSurfaceCapabilities,
  type PrepareSurfaceRequest,
  type PreparedSurfaceHandle,
  type SurfaceMountRequest,
} from "../src";

const sourceSurfaceId = surfaceId("surface:main");
const destinationSurfaceId = surfaceId("surface:browser");
const mapPanelId = panelId("panel:map");

afterEach(() => {
  document.body.replaceChildren();
});

describe("browser external-surface adapter", () => {
  it("bootstraps and mounts with the destination document, context, and readiness lease", async () => {
    const destinationWindow = createDestinationWindow();
    const opened: string[][] = [];
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let disposeCount = 0;
    const adapter = new BrowserExternalSurfaceAdapter<{ readonly camera: readonly number[] }>({
      environment: {
        sourceWindow: window,
        openWindow: (url, target, features) => {
          opened.push([url, target, features]);
          return destinationWindow;
        },
      },
      mount: ({ checkpoint, document: ownerDocument, root, window: ownerWindow }) => {
        expect(ownerDocument).toBe(destinationWindow.document);
        expect(ownerWindow).toBe(destinationWindow);
        const output = ownerDocument.createElement("output");
        output.textContent = checkpoint.camera.join(",");
        root.append(output);
        return {
          ready,
          dispose: () => {
            disposeCount += 1;
          },
        };
      },
    });
    const controller = new AbortController();
    const context = prepareRequest("browser-window");

    const handle = await adapter.prepare(context, controller.signal);
    expect(opened).toEqual([
      ["about:blank", "panefold-surface-browser", "popup=yes,left=20,top=30,width=640,height=480"],
    ]);
    await adapter.bootstrap(handle, context, controller.signal);
    await adapter.mount(handle, mountRequest({ camera: [1, 2, 3] }), controller.signal);

    const readiness = adapter.waitUntilReady(handle, controller.signal);
    expect(
      destinationWindow.document.querySelector<HTMLElement>("#panefold-surface-root")?.dataset
        .panefoldReady,
    ).toBe("false");
    resolveReady();
    await readiness;

    const destinationDocument = destinationWindow.document;
    const root = destinationDocument.querySelector<HTMLElement>("#panefold-surface-root");
    expect(root).toBeTruthy();
    expect(root?.dataset.panefoldReady).toBe("true");
    expect(root?.style.getPropertyValue("--accent")).toBe("#58a6ff");
    expect(root?.textContent).toBe("1,2,3");
    expect(destinationDocument.documentElement.lang).toBe("en-SG");
    expect(destinationDocument.documentElement.dir).toBe("rtl");
    expect(destinationDocument.documentElement.style.writingMode).toBe("vertical-rl");
    expect(destinationDocument.title).toBe("Panefold workspace surface");
    expect(
      destinationDocument
        .querySelector('meta[name="panefold-workspace-id"]')
        ?.getAttribute("content"),
    ).toBe("workspace:test");
    expect(destinationDocument.querySelector("link")?.href).toBe(
      `${window.location.origin}/workspace.css`,
    );
    expect(document.querySelector("#panefold-surface-root")).toBeNull();

    await adapter.close(handle);
    await adapter.close(handle);
    expect(disposeCount).toBe(1);
  });

  it("reports an unexpected page loss once and finalizes its mount lease once", async () => {
    const destinationWindow = createDestinationWindow();
    const losses: string[] = [];
    let disposeCount = 0;
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => ({
        dispose: () => {
          disposeCount += 1;
        },
      }),
      onSurfaceLost: (loss) => {
        losses.push(`${loss.kind}:${loss.destinationSurfaceId}:${loss.reason}`);
      },
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);
    await adapter.waitUntilReady(handle, signal);

    destinationWindow.dispatchEvent(new PageTransitionEvent("pagehide"));
    destinationWindow.dispatchEvent(new PageTransitionEvent("pagehide"));
    await Promise.resolve();

    expect(losses).toEqual(["browser-window:surface:browser:pagehide"]);
    expect(disposeCount).toBe(1);
  });

  it("detects a closed popup even when the browser omits pagehide", async () => {
    const destinationWindow = createDestinationWindow();
    let checkClosed: () => void = () => undefined;
    let closed = false;
    Object.defineProperty(destinationWindow, "closed", {
      configurable: true,
      get: () => closed,
    });
    const losses: string[] = [];
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: {
        sourceWindow: window,
        openWindow: () => destinationWindow,
        setTimer: (callback) => {
          checkClosed = callback;
          return 1;
        },
        clearTimer: () => undefined,
      },
      mount: () => undefined,
      onSurfaceLost: ({ reason }) => {
        losses.push(reason);
      },
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    await adapter.prepare(context, signal);

    closed = true;
    checkClosed();
    expect(losses).toEqual(["closed"]);
  });

  it("contains recovery observer and disposal failures after authoritative loss", async () => {
    const destinationWindow = createDestinationWindow();
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => ({
        dispose: async () => {
          throw new Error("fixture disposal failure");
        },
      }),
      onSurfaceLost: () => {
        throw new Error("fixture observer failure");
      },
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);

    expect(() =>
      destinationWindow.dispatchEvent(new PageTransitionEvent("pagehide")),
    ).not.toThrow();
    await Promise.resolve();
  });

  it("contains a rejected disposer while intentionally closing exactly once", async () => {
    const destinationWindow = createDestinationWindow();
    let disposeCount = 0;
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => ({
        dispose: async () => {
          disposeCount += 1;
          throw new Error("fixture disposal failure");
        },
      }),
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);

    await expect(adapter.close(handle)).resolves.toBeUndefined();
    await expect(adapter.close(handle)).resolves.toBeUndefined();
    expect(disposeCount).toBe(1);
  });

  it("closes synchronously without waiting for a never-settling disposer", async () => {
    const destinationWindow = createDestinationWindow();
    let closed = false;
    let disposeCount = 0;
    Object.defineProperty(destinationWindow, "closed", {
      configurable: true,
      get: () => closed,
    });
    destinationWindow.close = () => {
      closed = true;
    };
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => ({
        dispose: async () => {
          disposeCount += 1;
          await new Promise<void>(() => undefined);
        },
      }),
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);

    const closing = adapter.close(handle);
    expect(closed).toBe(true);
    expect(disposeCount).toBe(1);
    await expect(
      Promise.race([
        closing.then(() => "resolved" as const),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 25)),
      ]),
    ).resolves.toBe("resolved");
    await expect(adapter.close(handle)).resolves.toBeUndefined();
    expect(disposeCount).toBe(1);
  });

  it("times out a never-settling mount, compensates ownership, and closes the popup", async () => {
    const destinationWindow = createDestinationWindow();
    let closed = false;
    let triggerTimeout: (() => void) | undefined;
    Object.defineProperty(destinationWindow, "closed", {
      configurable: true,
      get: () => closed,
    });
    destinationWindow.close = () => {
      closed = true;
    };
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: {
        sourceWindow: window,
        openWindow: () => destinationWindow,
        setTimer: () => 1,
        clearTimer: () => undefined,
      },
      mount: () => {
        if (triggerTimeout === undefined) throw new Error("transfer timer was not installed");
        triggerTimeout();
        return new Promise<never>(() => undefined);
      },
    });
    const ownership = new SurfaceOwnershipRegistry();
    const compensateOwnership = vi.fn(async () => undefined);
    const coordinator = new SurfaceTransferCoordinator({
      adapter,
      ownership,
      sessionNonce: "session:test",
      timeoutMs: 1_000,
      createToken: () => "transfer:mount-timeout",
      setTimer: (callback) => {
        triggerTimeout = callback;
        return 1;
      },
      clearTimer: () => undefined,
      hooks: {
        currentRevision: () => revision(7),
        revalidatePolicy: () => true,
        commitOwnership: () => true,
        releaseSource: async () => undefined,
        compensateOwnership,
      },
    });
    const context = prepareRequest("browser-window");

    await expect(
      coordinator.transfer({
        panelId: mapPanelId,
        sourceSurfaceId,
        destination: context,
        sourcePolicy: {
          allowBrowserWindow: true,
          allowDocumentPictureInPicture: false,
        },
        destinationCapabilities: detectBrowserSurfaceCapabilities({ sourceWindow: window })[
          "browser-window"
        ],
        panelCapabilities: { popout: true, pictureInPicture: false },
        baseRevision: revision(7),
        coordinatorEpoch: 1,
        checkpoint: async () => ({}),
      }),
    ).resolves.toMatchObject({
      ok: false,
      safeSurfaceId: sourceSurfaceId,
      error: { code: "TRANSFER_TIMEOUT", stage: "destination-mount" },
      completedStages: expect.arrayContaining(["ownership-commit", "compensation"]),
    });
    expect(compensateOwnership).toHaveBeenCalledOnce();
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: sourceSurfaceId,
      state: "owned",
    });
    expect(closed).toBe(true);
  });

  it("disposes a mount lease that resolves after abort and destination close exactly once", async () => {
    const destinationWindow = createDestinationWindow();
    let resolveMount: (lease: { readonly dispose: () => void }) => void = () => undefined;
    const mounting = new Promise<{ readonly dispose: () => void }>((resolve) => {
      resolveMount = resolve;
    });
    let disposeCount = 0;
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: {
        sourceWindow: window,
        openWindow: () => destinationWindow,
        setTimer: () => 1,
        clearTimer: () => undefined,
      },
      mount: () => mounting,
    });
    const controller = new AbortController();
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, controller.signal);
    await adapter.bootstrap(handle, context, controller.signal);

    const mountResult = adapter.mount(handle, mountRequest({}), controller.signal);
    controller.abort("fixture abort");
    await expect(mountResult).rejects.toBe("fixture abort");
    await adapter.close(handle);

    resolveMount({
      dispose: () => {
        disposeCount += 1;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(disposeCount).toBe(1);
    await adapter.close(handle);
    expect(disposeCount).toBe(1);
  });

  it("ignores bfcache pagehide and synchronously closes on real source unload", async () => {
    const destinationWindow = createDestinationWindow();
    let closed = false;
    let disposeCount = 0;
    Object.defineProperty(destinationWindow, "closed", {
      configurable: true,
      get: () => closed,
    });
    destinationWindow.close = () => {
      closed = true;
    };
    const onSurfaceLost = vi.fn();
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => ({
        dispose: async () => {
          disposeCount += 1;
          await new Promise<void>(() => undefined);
        },
      }),
      onSurfaceLost,
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);
    await adapter.waitUntilReady(handle, signal);

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    await Promise.resolve();
    expect(closed).toBe(false);

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    // Destination ownership is revoked within the browser event even though
    // application cleanup never settles.
    expect(closed).toBe(true);
    expect(disposeCount).toBe(1);
    expect(onSurfaceLost).not.toHaveBeenCalled();
  });

  it("contains a rejecting disposer during real source unload", async () => {
    const destinationWindow = createDestinationWindow();
    let closed = false;
    Object.defineProperty(destinationWindow, "closed", {
      configurable: true,
      get: () => closed,
    });
    destinationWindow.close = () => {
      closed = true;
    };
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => ({
        dispose: async () => {
          throw new Error("fixture disposal failure");
        },
      }),
    });
    const signal = new AbortController().signal;
    const context = prepareRequest("browser-window");
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);

    expect(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })),
    ).not.toThrow();
    expect(closed).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("uses Document Picture-in-Picture only when explicitly supplied", async () => {
    const destinationWindow = createDestinationWindow();
    const requestWindow = vi.fn(async () => destinationWindow);
    const environment = {
      sourceWindow: window,
      documentPictureInPicture: { requestWindow },
    };
    const adapter = new BrowserExternalSurfaceAdapter({
      environment,
      mount: () => undefined,
    });
    const context = prepareRequest("document-pip");
    const signal = new AbortController().signal;
    const handle = await adapter.prepare(context, signal);

    expect(requestWindow).toHaveBeenCalledWith({ width: 640, height: 480 });
    expect(handle.kind).toBe("document-pip");
    expect(detectBrowserSurfaceCapabilities(environment)["document-pip"]).toMatchObject({
      alwaysOnTop: true,
      crossDocument: true,
      freePositioning: false,
    });
    await adapter.close(handle);
  });

  it("closes a Document Picture-in-Picture window that resolves after preparation abort", async () => {
    const destinationWindow = createDestinationWindow();
    let closed = false;
    let resolveWindow: (value: Window) => void = () => undefined;
    Object.defineProperty(destinationWindow, "closed", {
      configurable: true,
      get: () => closed,
    });
    destinationWindow.close = () => {
      closed = true;
    };
    const requestWindow = new Promise<Window>((resolve) => {
      resolveWindow = resolve;
    });
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: {
        sourceWindow: window,
        documentPictureInPicture: { requestWindow: () => requestWindow },
      },
      mount: () => undefined,
    });
    const controller = new AbortController();

    const preparation = adapter.prepare(prepareRequest("document-pip"), controller.signal);
    controller.abort("fixture abort");
    await expect(preparation).rejects.toBe("fixture abort");
    resolveWindow(destinationWindow);
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(true);
  });

  it("fails safely for blocked, unactivated, unavailable, and untrusted destinations", async () => {
    const signal = new AbortController().signal;
    const blocked = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => null },
      mount: () => undefined,
    });
    await expect(blocked.prepare(prepareRequest("browser-window"), signal)).rejects.toMatchObject({
      code: "POPUP_BLOCKED",
      stage: "prepare",
    });
    await expect(
      blocked.prepare({ ...prepareRequest("browser-window"), userActivation: false }, signal),
    ).rejects.toMatchObject({ code: "USER_ACTIVATION_REQUIRED", stage: "prepare" });
    await expect(blocked.prepare(prepareRequest("document-pip"), signal)).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
      stage: "prepare",
    });

    const destinationWindow = createDestinationWindow();
    const untrusted = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => undefined,
    });
    const context = prepareRequest("browser-window");
    const handle = await untrusted.prepare(context, signal);
    const otherSession = {
      ...context,
      security: { ...context.security, sessionNonce: "session:other" },
    };
    await expect(untrusted.bootstrap(handle, otherSession, signal)).rejects.toBeInstanceOf(
      SurfaceTransferError,
    );
    await adapterCloseIgnoringJSDOM(untrusted, handle);
  });

  it("rejects duplicate mounts and foreign handles", async () => {
    const destinationWindow = createDestinationWindow();
    const adapter = new BrowserExternalSurfaceAdapter({
      environment: { sourceWindow: window, openWindow: () => destinationWindow },
      mount: () => undefined,
    });
    const context = prepareRequest("browser-window");
    const signal = new AbortController().signal;
    const handle = await adapter.prepare(context, signal);
    await adapter.bootstrap(handle, context, signal);
    await adapter.mount(handle, mountRequest({}), signal);
    await expect(adapter.mount(handle, mountRequest({}), signal)).rejects.toMatchObject({
      code: "OWNERSHIP_CONFLICT",
      stage: "destination-mount",
    });
    await expect(adapter.close({ ...handle, resource: {} })).rejects.toThrow(
      "another browser adapter",
    );
    await adapterCloseIgnoringJSDOM(adapter, handle);
  });
});

function prepareRequest(kind: "browser-window" | "document-pip"): PrepareSurfaceRequest {
  return {
    destinationSurfaceId,
    kind,
    bounds: { x: 20, y: 30, width: 640, height: 480 },
    security: {
      protocolVersion: 1,
      workspaceId: "workspace:test",
      sessionNonce: "session:test",
      allowedOrigins: [window.location.origin],
      cspNonce: "nonce-test",
    },
    presentation: {
      locale: "en-SG",
      direction: "rtl",
      writingMode: "vertical-rl",
      stylesheets: [`${window.location.origin}/workspace.css`],
      themeTokens: { accent: "#58a6ff" },
    },
    userActivation: true,
  };
}

function createDestinationWindow(): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const destinationWindow = frame.contentWindow;
  if (destinationWindow === null) throw new Error("JSDOM did not create a child window");
  destinationWindow.document.head?.replaceChildren();
  destinationWindow.document.body?.replaceChildren();
  return destinationWindow;
}

function mountRequest<Checkpoint extends JsonValue>(
  checkpoint: Checkpoint,
): SurfaceMountRequest<Checkpoint> {
  return {
    panelId: mapPanelId,
    checkpoint,
    ownership: {
      token: "ownership:1",
      panelId: mapPanelId,
      sourceSurfaceId,
      destinationSurfaceId,
      coordinatorEpoch: 1,
      sessionNonce: "session:test",
      baseRevision: revision(7),
    },
  };
}

async function adapterCloseIgnoringJSDOM(
  adapter: BrowserExternalSurfaceAdapter,
  handle: PreparedSurfaceHandle,
): Promise<void> {
  // JSDOM's child-window close is implemented, but this helper keeps cleanup
  // assertions focused on the adapter contract rather than window internals.
  await adapter.close(handle);
}
