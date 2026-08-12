import { describe, expect, it } from "vitest";

import {
  createDevtoolsRecorder,
  createMobileWorkspaceProjection,
  createRemoteCommandBridge,
  createTrustedPluginRegistry,
  resolveMobileProfile,
  type DevtoolsSource,
  type RemoteCommandEnvelope,
} from "../src";

describe("trusted plugin registry", () => {
  it("enforces identity and capability boundaries and disposes active plugins", () => {
    const events: string[] = [];
    const registry = createTrustedPluginRegistry<{ readonly workspace: string }>({
      allowedCapabilities: ["panels", "devtools"],
    });
    const plugin = {
      manifest: {
        id: "atlas.review-tools",
        version: "1.0.0",
        capabilities: ["panels", "devtools"],
      },
      activate: (context: { readonly workspace: string }) => {
        events.push(`activate:${context.workspace}`);
        return () => {
          events.push("deactivate");
        };
      },
    } as const;

    expect(registry.register(plugin).ok).toBe(true);
    expect(registry.register(plugin)).toMatchObject({ ok: false, code: "DUPLICATE_ID" });
    expect(
      registry.register({
        manifest: {
          id: "atlas.remote",
          version: "1",
          capabilities: ["collaboration"],
        },
      }),
    ).toMatchObject({ ok: false, code: "CAPABILITY_DENIED" });

    expect(registry.activate(plugin.manifest.id, { workspace: "one-north" })).toEqual({
      ok: true,
      active: true,
    });
    expect(registry.isActive(plugin.manifest.id)).toBe(true);
    registry.dispose();
    expect(events).toEqual(["activate:one-north", "deactivate"]);
  });
});

interface DevtoolsSnapshot {
  readonly revision: bigint;
  readonly secret: string;
}

class DevtoolsFixture implements DevtoolsSource<DevtoolsSnapshot, { readonly label: string }> {
  readonly #listeners = new Set<() => void>();
  #snapshot: DevtoolsSnapshot = { revision: 0n, secret: "token-0" };
  #transactions: { readonly label: string }[] = [];

  public readonly getSnapshot = () => this.#snapshot;
  public readonly getTransactions = () => this.#transactions;
  public readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  public commit(label: string) {
    this.#snapshot = { revision: this.#snapshot.revision + 1n, secret: `token-${label}` };
    this.#transactions = [...this.#transactions, { label }];
    for (const listener of [...this.#listeners]) listener();
  }
}

describe("devtools recorder", () => {
  it("captures bounded, caller-redacted observational evidence", () => {
    const source = new DevtoolsFixture();
    const recorder = createDevtoolsRecorder(source, {
      limit: 2,
      projectSnapshot: (snapshot) => ({ revision: snapshot.revision }),
      projectTransaction: (transaction) => transaction.label,
    });
    source.commit("one");
    source.commit("two");

    expect(recorder.getEntries().map((entry) => entry.sequence)).toEqual([2, 3]);
    expect(recorder.exportJson()).not.toContain("token-");
    expect(recorder.exportJson()).toContain('"revision": "2"');
    recorder.stop();
    source.commit("three");
    expect(recorder.getEntries()).toHaveLength(2);
  });
});

describe("remote command bridge", () => {
  it("validates, deduplicates, and labels remote commands before dispatch", () => {
    const dispatches: Array<{ readonly command: string; readonly origin: string }> = [];
    const bridge = createRemoteCommandBridge(
      {
        dispatch: (command: string, options) => {
          dispatches.push({ command, origin: options.origin });
          return { status: command === "deny" ? "rejected" : "committed" } as const;
        },
      },
      {
        workspaceId: "workspace:atlas",
        localSenderId: "session:local",
        decodeCommand: (wire: { readonly type?: string }) => wire.type,
        acceptedResult: (result) => result.status === "committed",
        commandLabel: (command) => `Remote ${command}`,
      },
    );
    const envelope: RemoteCommandEnvelope<{ readonly type: string }> = {
      protocolVersion: 1,
      workspaceId: "workspace:atlas",
      senderId: "session:peer",
      sequence: 1,
      command: { type: "select" },
    };

    expect(bridge.receive(envelope).status).toBe("applied");
    expect(bridge.receive(envelope).status).toBe("duplicate");
    expect(bridge.receive({ ...envelope, senderId: "session:local", sequence: 2 }).status).toBe(
      "ignored",
    );
    expect(
      bridge.receive({
        ...envelope,
        senderId: "session:peer",
        sequence: 2,
        command: { type: "deny" },
      }).status,
    ).toBe("rejected");
    expect(dispatches).toEqual([
      { command: "select", origin: "remote" },
      { command: "deny", origin: "remote" },
    ]);
    expect(bridge.lastSequence("session:peer")).toBe(2);
  });
});

describe("mobile projection", () => {
  it("projects one active region with accessible coarse-pointer targets", () => {
    const source = {
      revision: "7",
      groups: {
        navigation: {
          id: "navigation",
          label: "Navigation",
          panelIds: ["routes"],
          selectedPanelId: "routes",
        },
        primary: {
          id: "primary",
          label: "Primary",
          panelIds: ["map", "notes"],
          selectedPanelId: "map",
        },
      },
      panels: {
        routes: { id: "routes", title: "Routes" },
        map: { id: "map", title: "Map" },
        notes: { id: "notes", title: "Notes" },
      },
      activePanelId: "map",
    } as const;

    const projection = createMobileWorkspaceProjection(source);
    expect(projection).toMatchObject({
      currentGroupId: "primary",
      currentPanelId: "map",
      minimumTargetSize: 44,
      mode: "single-region",
    });
    expect(projection.panels.map((panel) => panel.id)).toEqual(["map", "notes"]);
    expect(resolveMobileProfile({ inlineSize: 1000, coarsePointer: true })).toEqual({
      compact: true,
      minimumTargetSize: 44,
      navigation: "region-switcher",
    });
    expect(source.groups.primary.panelIds).toEqual(["map", "notes"]);
  });
});
