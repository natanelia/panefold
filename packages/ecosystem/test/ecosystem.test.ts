import { describe, expect, it } from "vitest";

import {
  createSingleWriterCoordinator,
  createDevtoolsRecorder,
  createMobileWorkspaceProjection,
  createRemoteCommandBridge,
  createRedactedReproduction,
  createTrustedPluginRegistry,
  createWorkspacePacketAuthenticator,
  resolveMobileProfile,
  serializeRedactedReproduction,
  validateBoundaryValue,
  type DurableTransactionPacket,
  type DevtoolsSource,
  type PluginManifest,
  type RemoteCommandEnvelope,
} from "../src";

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    engineRange: "^0.1.0",
    protocolVersion: 1,
    capabilities: ["panels"],
    panelTypes: [],
    commands: [],
    persistedNamespaces: [],
    ...overrides,
  };
}

describe("trusted plugin registry", () => {
  it("enforces identity and capability boundaries and disposes active plugins", () => {
    const events: string[] = [];
    const registry = createTrustedPluginRegistry<{ readonly workspace: string }>({
      allowedCapabilities: ["panels", "devtools"],
      engineVersion: "0.1.0",
      protocolVersion: 1,
    });
    const plugin = {
      manifest: manifest("atlas.review-tools", {
        capabilities: ["panels", "devtools"],
      }),
      activate: (context: Readonly<{ readonly workspace: string }>) => {
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
        manifest: manifest("atlas.remote", {
          capabilities: ["collaboration"],
        }),
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

  it("resolves contribution conflicts independently of registration order", () => {
    const resolve = (ids: readonly string[]) => {
      const registry = createTrustedPluginRegistry<never>({
        allowedCapabilities: ["panels", "commands"],
        engineVersion: "0.1.0",
        protocolVersion: 1,
      });
      for (const id of ids) {
        registry.register({
          manifest: manifest(id, {
            capabilities: ["panels", "commands"],
            panelTypes: ["map.canvas"],
            commands: ["map.zoom"],
          }),
        });
      }
      return registry.resolveContributions();
    };
    expect(resolve(["zeta.tools", "alpha.tools"])).toEqual(resolve(["alpha.tools", "zeta.tools"]));
    expect(resolve(["zeta.tools", "alpha.tools"]).conflicts).toEqual([
      {
        kind: "command",
        id: "map.zoom",
        winnerPluginId: "alpha.tools",
        rejectedPluginIds: ["zeta.tools"],
      },
      {
        kind: "panel",
        id: "map.canvas",
        winnerPluginId: "alpha.tools",
        rejectedPluginIds: ["zeta.tools"],
      },
    ]);
  });
});

describe("single-writer collaboration", () => {
  const packet = (
    overrides: Partial<DurableTransactionPacket<{ readonly type: string }>> = {},
  ): DurableTransactionPacket<{ readonly type: string }> => ({
    protocolVersion: 1,
    workspaceId: "workspace:atlas",
    sessionNonce: "0123456789abcdef",
    senderSurfaceId: "surface:main",
    coordinatorEpoch: 3,
    channel: "transaction",
    transactionId: "transaction:1",
    actorId: "actor:one",
    baseRevision: "0",
    command: { type: "select" },
    ...overrides,
  });

  it("assigns revisions once and rejects stale session, epoch, revision, and duplicate input", () => {
    const applied: string[] = [];
    const coordinator = createSingleWriterCoordinator({
      protocolVersion: 1,
      workspaceId: "workspace:atlas",
      sessionNonce: "0123456789abcdef",
      initialEpoch: 3,
      decodeCommand: (wire: { readonly type: string }) => wire.type,
      apply: (command, context) => {
        applied.push(`${context.assignedRevision}:${command}`);
        return { accepted: true, result: command };
      },
    });

    expect(coordinator.receive(packet())).toEqual({
      status: "applied",
      revision: "1",
      result: "select",
    });
    expect(coordinator.receive(packet())).toEqual({ status: "duplicate", revision: "1" });
    expect(
      coordinator.receive(packet({ transactionId: "transaction:2", baseRevision: "0" })),
    ).toMatchObject({ status: "rejected", code: "REVISION_CONFLICT" });
    expect(
      coordinator.receive(packet({ transactionId: "transaction:3", coordinatorEpoch: 2 })),
    ).toMatchObject({ status: "rejected", code: "STALE_EPOCH" });
    expect(
      coordinator.receive(
        packet({ transactionId: "transaction:4", sessionNonce: "fedcba9876543210" }),
      ),
    ).toMatchObject({ status: "rejected", code: "AUTHENTICATION_FAILED" });
    expect(applied).toEqual(["1:select"]);
  });

  it("keeps lossy presence separate and rejects stale leaders after recovery", () => {
    const coordinator = createSingleWriterCoordinator({
      protocolVersion: 1,
      workspaceId: "workspace:atlas",
      sessionNonce: "0123456789abcdef",
      decodeCommand: (wire: { readonly type: string }) => wire.type,
      decodePresence: (value) =>
        typeof value === "object" && value !== null
          ? (value as { readonly pointer: number })
          : undefined,
      apply: (command) => ({ accepted: true, result: command }),
    });
    const presence = {
      protocolVersion: 1,
      workspaceId: "workspace:atlas",
      sessionNonce: "0123456789abcdef",
      senderSurfaceId: "surface:peer",
      coordinatorEpoch: 0,
      channel: "presence" as const,
      sequence: 1,
      payload: { pointer: 12 },
    };
    expect(coordinator.receive(presence)).toEqual({ status: "presence", sequence: 1 });
    expect(coordinator.receive(presence).status).toBe("ignored");
    expect(coordinator.snapshot()).toMatchObject({ revision: "0", durableReceipts: 0 });
    coordinator.advanceEpoch(1);
    expect(coordinator.snapshot().presence).toEqual({});
    expect(coordinator.receive(presence)).toMatchObject({
      status: "rejected",
      code: "STALE_EPOCH",
    });
  });
});

describe("authenticated bounded boundaries", () => {
  it("signs canonical packets and rejects tampering", async () => {
    const authenticator = await createWorkspacePacketAuthenticator<{ readonly value: string }>({
      keyId: "session:key",
      secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
    });
    const signed = await authenticator.sign({ value: "original" });
    expect(await authenticator.verify(signed)).toBe(true);
    expect(await authenticator.verify({ ...signed, value: "tampered" })).toBe(false);
  });

  it("rejects prototype-sensitive, cyclic, excessive, and non-finite data", () => {
    expect(validateBoundaryValue({ safe: [1, "two"] }).ok).toBe(true);
    expect(validateBoundaryValue({ value: Number.NaN }).ok).toBe(false);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(validateBoundaryValue(cyclic).ok).toBe(false);
    const polluted = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(polluted, "__proto__", { value: "unsafe", enumerable: true });
    expect(validateBoundaryValue(polluted).ok).toBe(false);
    expect(validateBoundaryValue([1, 2], { maxArrayLength: 1 }).ok).toBe(false);
  });

  it("exports deterministic bounded reproductions with safe defaults", () => {
    const input = {
      engineVersion: "0.1.0",
      schemaVersion: 2,
      category: "invariant-defect" as const,
      code: "LAYOUT_CYCLE",
      message: "Invalid layout",
      snapshot: {
        panels: [{ id: "panel:map", title: "Private customer title", parameters: { secret: 1 } }],
        checkpoint: "private document",
      },
      diagnostics: [{ path: "surfaces.byId.main.rootNodeId", token: "private-token" }],
    };
    const first = createRedactedReproduction(input);
    const second = createRedactedReproduction(input);
    expect(first).toEqual(second);
    const json = serializeRedactedReproduction(first);
    expect(json).not.toContain("Private customer title");
    expect(json).not.toContain("private document");
    expect(json).not.toContain("private-token");
    expect(json).toContain("[REDACTED]");
    expect(json.endsWith("\n")).toBe(true);
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
