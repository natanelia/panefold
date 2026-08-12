// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  createIsolatedPluginFrame,
  type PluginFrameEnvelope,
  type PluginFramePort,
  type PluginManifest,
} from "../src";

class FakePort implements PluginFramePort {
  readonly sent: unknown[] = [];
  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  closed = false;

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  addEventListener(type: "message" | "messageerror", listener: EventListenerOrEventListenerObject) {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(
    type: "message" | "messageerror",
    listener: EventListenerOrEventListenerObject,
  ) {
    this.#listeners.get(type)?.delete(listener);
  }

  emit(data: unknown) {
    const event = { data } as MessageEvent;
    for (const listener of this.#listeners.get("message") ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  close() {
    this.closed = true;
  }
}

const pluginManifest: PluginManifest = {
  schemaVersion: 1,
  id: "atlas.sandbox",
  version: "1.0.0",
  engineRange: "^0.1.0",
  protocolVersion: 1,
  capabilities: ["panels"],
  panelTypes: ["atlas.sandbox-panel"],
  commands: [],
  persistedNamespaces: ["atlas.sandbox"],
};

describe("isolated plugin frame", () => {
  it("uses a same-origin-free sandbox, explicit origin, transferred port, and bounded messages", async () => {
    const host = document.createElement("main");
    host.id = "host";
    document.body.replaceChildren(host);
    const local = new FakePort();
    const remote = new FakePort();
    const messages: PluginFrameEnvelope[] = [];
    const diagnostics: string[] = [];
    let connectedOrigin = "";
    const frame = createIsolatedPluginFrame({
      document,
      container: host,
      manifest: pluginManifest,
      source: "https://plugins.example.test/atlas.html",
      allowedOrigins: ["https://plugins.example.test"],
      sessionNonce: "0123456789abcdef",
      permissions: ["clipboard-read"],
      allowedMessageTypes: ["panel:ready"],
      createChannel: () => ({ port1: local, port2: remote }),
      postConnect: (_target, _message, targetOrigin, transfer) => {
        connectedOrigin = targetOrigin;
        expect(transfer).toEqual([remote]);
      },
      onMessage: (message) => messages.push(message),
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(frame.element.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.element.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.element.getAttribute("referrerpolicy")).toBe("no-referrer");

    const connected = frame.connect();
    frame.element.dispatchEvent(new Event("load"));
    await connected;
    expect(connectedOrigin).toBe("https://plugins.example.test");
    expect(frame.send("host:update", { revision: 1 })).toBe(true);
    expect(local.sent).toHaveLength(1);

    local.emit({
      protocolVersion: 1,
      pluginId: "atlas.sandbox",
      sessionNonce: "0123456789abcdef",
      sequence: 1,
      type: "panel:ready",
      payload: { ready: true },
    });
    local.emit({
      protocolVersion: 1,
      pluginId: "atlas.sandbox",
      sessionNonce: "wrong-wrong-wrong",
      sequence: 2,
      type: "panel:ready",
      payload: {},
    });
    expect(messages).toHaveLength(1);
    expect(diagnostics).toContain("Plugin message failed session authentication");
    frame.dispose();
    expect(local.closed).toBe(true);
    expect(host.children).toHaveLength(0);
  });

  it("rejects non-allowlisted origins", () => {
    expect(() =>
      createIsolatedPluginFrame({
        document,
        container: document.body,
        manifest: pluginManifest,
        source: "https://evil.example/plugin.html",
        allowedOrigins: ["https://plugins.example.test"],
        sessionNonce: "0123456789abcdef",
        allowedMessageTypes: [],
        onMessage: () => undefined,
      }),
    ).toThrow(/not allowlisted/u);
  });
});
