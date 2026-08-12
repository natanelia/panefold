// @vitest-environment jsdom

import { panelId, revision, surfaceId, type JsonValue } from "@panefold/model";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserExternalSurfaceAdapter,
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
