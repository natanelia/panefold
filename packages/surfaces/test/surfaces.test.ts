import {
  MAIN_SURFACE_CAPABILITIES,
  panelId,
  revision,
  surfaceId,
  type JsonValue,
  type SurfaceCapabilities,
} from "@panefold/model";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SurfaceOwnershipRegistry,
  SurfaceTransferCoordinator,
  clampSurfaceRect,
  chooseSurfaceFallback,
  detectBrowserSurfaceCapabilities,
  intersectSurfaceCapabilities,
  type ExternalSurfaceAdapter,
  type PreparedSurfaceHandle,
  type OwnershipToken,
  type PrepareSurfaceRequest,
  type SurfaceTransferStage,
} from "../src";

const sourceSurfaceId = surfaceId("surface:main");
const destinationSurfaceId = surfaceId("surface:external");
const recoverySurfaceId = surfaceId("surface:recovery");
const mapPanelId = panelId("panel:map");

const externalCapabilities: SurfaceCapabilities = Object.freeze({
  nestedLayout: true,
  floating: true,
  popout: true,
  alwaysOnTop: true,
  freePositioning: true,
  crossDocument: true,
  multiScreenPlacement: true,
});

const destination = Object.freeze({
  destinationSurfaceId,
  kind: "browser-window",
  bounds: { x: 20, y: 30, width: 640, height: 480 },
  security: {
    protocolVersion: 1,
    workspaceId: "workspace:test",
    sessionNonce: "session:test",
    allowedOrigins: ["https://example.test"],
  },
  presentation: {
    locale: "en-SG",
    direction: "ltr",
    writingMode: "horizontal-tb",
    stylesheets: ["/workspace.css"],
    themeTokens: { accent: "#58a6ff" },
  },
  userActivation: true,
} as const) satisfies PrepareSurfaceRequest;

class FakeAdapter implements ExternalSurfaceAdapter {
  readonly events: string[] = [];

  public constructor(private readonly failAt?: SurfaceTransferStage) {}

  public async prepare(): Promise<PreparedSurfaceHandle> {
    this.step("prepare");
    return {
      resource: {},
      destinationSurfaceId,
      kind: "browser-window",
      token: "prepared",
      protocolVersion: 1,
    };
  }

  public async bootstrap(): Promise<void> {
    this.step("bootstrap");
  }

  public async mount(): Promise<void> {
    this.step("destination-mount");
  }

  public async waitUntilReady(): Promise<void> {
    this.step("destination-ready");
  }

  public async close(): Promise<void> {
    this.events.push("close");
  }

  private step(stage: SurfaceTransferStage): void {
    this.events.push(stage);
    if (this.failAt === stage) throw new Error(`failed:${stage}`);
  }
}

function fixture(failAt?: SurfaceTransferStage, failCompensation = false) {
  const adapter = new FakeAdapter(failAt);
  const ownership = new SurfaceOwnershipRegistry();
  const events: string[] = [];
  const coordinator = new SurfaceTransferCoordinator({
    adapter,
    ownership,
    sessionNonce: "session:test",
    timeoutMs: 1_000,
    createToken: () => "transfer:1",
    hooks: {
      currentRevision: () => revision(7),
      commitOwnership: () => {
        events.push("commit");
        return true;
      },
      releaseSource: async () => {
        events.push("release");
        if (failAt === "source-release") throw new Error("failed:source-release");
      },
      compensateOwnership: async () => {
        events.push("compensate");
        if (failCompensation) throw new Error("failed:compensation");
      },
    },
  });
  return { adapter, ownership, events, coordinator };
}

function transferRequest(failCheckpoint = false) {
  return {
    panelId: mapPanelId,
    sourceSurfaceId,
    destination,
    sourcePolicy: {
      allowBrowserWindow: true,
      allowDocumentPictureInPicture: true,
    },
    destinationCapabilities: externalCapabilities,
    panelCapabilities: { popout: true, pictureInPicture: true },
    baseRevision: revision(7),
    coordinatorEpoch: 3,
    checkpoint: async (): Promise<JsonValue> => {
      if (failCheckpoint) throw new Error("checkpoint failed");
      return { camera: [1, 2, 3] };
    },
    restorationToken: "map:canvas",
  } as const;
}

describe("surface capabilities and geometry", () => {
  it("intersects capabilities and falls back without requiring permissions", () => {
    const restricted = { ...externalCapabilities, popout: false, crossDocument: false };
    expect(intersectSurfaceCapabilities(externalCapabilities, restricted).popout).toBe(false);
    expect(
      chooseSurfaceFallback("browser-window", [
        { kind: "browser-window", capabilities: restricted },
        { kind: "floating", capabilities: externalCapabilities },
      ]),
    ).toBe("floating");
  });

  it("keeps a minimum visible region after monitor, zoom, or viewport changes", () => {
    expect(
      clampSurfaceRect(
        { x: 4_000, y: -2_000, width: 600, height: 500 },
        { x: 0, y: 0, width: 1_000, height: 800 },
        64,
      ),
    ).toEqual({ x: 936, y: -436, width: 600, height: 500 });
    expect(() =>
      clampSurfaceRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 800, height: 600, safeInsetLeft: -1 },
      ),
    ).toThrow("non-negative");
  });
});

describe("prepared external surface transfer", () => {
  it("separates main-surface egress policy from detected popup capabilities", async () => {
    const { coordinator, adapter } = fixture();
    const detectedPopup = detectBrowserSurfaceCapabilities({
      sourceWindow: {} as Window,
    })["browser-window"];

    expect(MAIN_SURFACE_CAPABILITIES).toMatchObject({ popout: false, crossDocument: false });
    await expect(
      coordinator.transfer({
        ...transferRequest(),
        destinationCapabilities: detectedPopup,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(adapter.events[0]).toBe("prepare");
  });

  it("fails closed for the deprecated ambiguous source-capabilities input", async () => {
    const { coordinator, adapter } = fixture();
    const current = transferRequest();
    const legacy = {
      panelId: current.panelId,
      sourceSurfaceId: current.sourceSurfaceId,
      destination: current.destination,
      sourceCapabilities: externalCapabilities,
      panelCapabilities: current.panelCapabilities,
      baseRevision: current.baseRevision,
      coordinatorEpoch: current.coordinatorEpoch,
      checkpoint: current.checkpoint,
      restorationToken: current.restorationToken,
    } as const;

    await expect(coordinator.transfer(legacy)).resolves.toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED", stage: "capability" },
    });
    expect(adapter.events).toEqual([]);
  });

  it("rejects a denied source policy or incapable destination before opening a window", async () => {
    const deniedSource = fixture();
    await expect(
      deniedSource.coordinator.transfer({
        ...transferRequest(),
        sourcePolicy: {
          allowBrowserWindow: false,
          allowDocumentPictureInPicture: true,
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "CAPABILITY_DENIED" } });
    expect(deniedSource.adapter.events).toEqual([]);

    const deniedDestination = fixture();
    await expect(
      deniedDestination.coordinator.transfer({
        ...transferRequest(),
        destinationCapabilities: { ...externalCapabilities, crossDocument: false },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "CAPABILITY_DENIED" } });
    expect(deniedDestination.adapter.events).toEqual([]);
  });

  it("commits ownership only after prepare, bootstrap, and checkpoint", async () => {
    const { coordinator, ownership, adapter, events } = fixture();
    const result = await coordinator.transfer(transferRequest());

    expect(result.ok).toBe(true);
    expect(adapter.events).toEqual([
      "prepare",
      "bootstrap",
      "destination-mount",
      "destination-ready",
    ]);
    expect(events).toEqual(["commit", "release"]);
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: destinationSurfaceId,
      state: "owned",
      coordinatorEpoch: 3,
    });
  });

  it.each(["prepare", "bootstrap", "destination-mount", "destination-ready"] as const)(
    "retains or compensates ownership when %s fails",
    async (stage) => {
      const { coordinator, ownership, events } = fixture(stage);
      const result = await coordinator.transfer(transferRequest());

      expect(result).toMatchObject({ ok: false, safeSurfaceId: sourceSurfaceId });
      expect(ownership.ownerOf(mapPanelId)).toMatchObject({
        surfaceId: sourceSurfaceId,
        state: "owned",
      });
      expect(events.includes("compensate")).toBe(
        stage === "destination-mount" || stage === "destination-ready",
      );
    },
  );

  it("does not commit and retains source ownership when checkpointing fails", async () => {
    const { coordinator, ownership, events } = fixture();
    const result = await coordinator.transfer(transferRequest(true));

    expect(result).toMatchObject({
      ok: false,
      safeSurfaceId: sourceSurfaceId,
      error: { code: "CHECKPOINT_FAILED", stage: "checkpoint" },
    });
    expect(events).toEqual([]);
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: sourceSurfaceId,
      state: "owned",
    });
  });

  it("keeps the ready destination authoritative when source cleanup must be retried", async () => {
    const { coordinator, ownership, events } = fixture("source-release");
    const result = await coordinator.transfer(transferRequest());

    expect(result).toMatchObject({
      ok: false,
      safeSurfaceId: destinationSurfaceId,
      error: { code: "SOURCE_RELEASE_FAILED", stage: "source-release" },
    });
    expect(events).toEqual(["commit", "release"]);
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: destinationSurfaceId,
      state: "owned",
    });
  });

  it("retains the prepared destination when semantic compensation fails", async () => {
    const { coordinator, ownership, adapter, events } = fixture("destination-mount", true);

    await expect(coordinator.transfer(transferRequest())).resolves.toMatchObject({
      ok: false,
      safeSurfaceId: destinationSurfaceId,
      error: { code: "COMPENSATION_FAILED", stage: "compensation" },
    });
    expect(events).toEqual(["commit", "compensate"]);
    expect(adapter.events).toEqual(["prepare", "bootstrap", "destination-mount"]);
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: destinationSurfaceId,
      state: "destination-pending-ready",
    });
  });

  it.each([
    ["prepare", "prepare", sourceSurfaceId, false],
    ["bootstrap", "bootstrap", sourceSurfaceId, true],
    ["checkpoint", "checkpoint", sourceSurfaceId, true],
    ["mount", "destination-mount", sourceSurfaceId, true],
    ["ready", "destination-ready", sourceSurfaceId, true],
    ["release", "source-release", destinationSurfaceId, false],
    ["compensation", "compensation", destinationSurfaceId, false],
    ["close", "destination-mount", sourceSurfaceId, true],
  ] as const)(
    "bounds an uncooperative %s promise and preserves truthful ownership",
    async (hangingStage, expectedStage, expectedOwner, shouldClose) => {
      let triggerTimeout: (() => void) | undefined;
      const hang = (): Promise<never> => {
        if (triggerTimeout === undefined) throw new Error("transfer timer was not installed");
        triggerTimeout();
        return new Promise<never>(() => undefined);
      };
      const adapterEvents: string[] = [];
      const adapter: ExternalSurfaceAdapter = {
        prepare: () => {
          adapterEvents.push("prepare");
          if (hangingStage === "prepare") return hang();
          return Promise.resolve({
            resource: {},
            destinationSurfaceId,
            kind: "browser-window",
            token: "prepared:timeout",
            protocolVersion: 1,
          });
        },
        bootstrap: () => {
          adapterEvents.push("bootstrap");
          return hangingStage === "bootstrap" ? hang() : Promise.resolve();
        },
        mount: () => {
          adapterEvents.push("destination-mount");
          if (hangingStage === "compensation" || hangingStage === "close") {
            return Promise.reject(new Error("fixture mount failure"));
          }
          return hangingStage === "mount" ? hang() : Promise.resolve();
        },
        waitUntilReady: () => {
          adapterEvents.push("destination-ready");
          return hangingStage === "ready" ? hang() : Promise.resolve();
        },
        close: () => {
          adapterEvents.push("close");
          return hangingStage === "close" ? hang() : Promise.resolve();
        },
      };
      const ownership = new SurfaceOwnershipRegistry();
      const hookEvents: string[] = [];
      const coordinator = new SurfaceTransferCoordinator({
        adapter,
        ownership,
        sessionNonce: "session:test",
        timeoutMs: 1_000,
        createToken: () => `transfer:${hangingStage}`,
        setTimer: (callback) => {
          triggerTimeout = callback;
          return 1;
        },
        clearTimer: () => undefined,
        hooks: {
          currentRevision: () => revision(7),
          commitOwnership: () => {
            hookEvents.push("commit");
            return true;
          },
          releaseSource: () => {
            hookEvents.push("release");
            return hangingStage === "release" ? hang() : Promise.resolve();
          },
          compensateOwnership: () => {
            hookEvents.push("compensate");
            return hangingStage === "compensation" ? hang() : Promise.resolve();
          },
        },
      });
      const request = {
        ...transferRequest(),
        checkpoint: () =>
          hangingStage === "checkpoint" ? hang() : Promise.resolve<JsonValue>({ camera: [] }),
      };

      await expect(coordinator.transfer(request)).resolves.toMatchObject({
        ok: false,
        safeSurfaceId: expectedOwner,
        error: {
          code: hangingStage === "compensation" ? "COMPENSATION_FAILED" : "TRANSFER_TIMEOUT",
          stage: expectedStage,
        },
      });
      expect(ownership.ownerOf(mapPanelId)).toMatchObject({
        surfaceId: expectedOwner,
        state: hangingStage === "compensation" ? "destination-pending-ready" : "owned",
      });
      expect(adapterEvents.includes("close")).toBe(shouldClose);
      expect(hookEvents.includes("compensate")).toBe(
        hangingStage === "mount" ||
          hangingStage === "ready" ||
          hangingStage === "compensation" ||
          hangingStage === "close",
      );
    },
  );

  it("applies a late successful compensation exactly once after reporting indeterminate ownership", async () => {
    let triggerTimeout: (() => void) | undefined;
    let resolveCompensation: () => void = () => undefined;
    const compensation = new Promise<void>((resolve) => {
      resolveCompensation = resolve;
    });
    const adapter = new FakeAdapter("destination-mount");
    const ownership = new SurfaceOwnershipRegistry();
    const coordinator = new SurfaceTransferCoordinator({
      adapter,
      ownership,
      sessionNonce: "session:test",
      timeoutMs: 1_000,
      createToken: () => "transfer:late-compensation",
      setTimer: (callback) => {
        triggerTimeout = callback;
        return 1;
      },
      clearTimer: () => undefined,
      hooks: {
        currentRevision: () => revision(7),
        commitOwnership: () => true,
        releaseSource: async () => undefined,
        compensateOwnership: () => {
          if (triggerTimeout === undefined) throw new Error("compensation timer was not installed");
          triggerTimeout();
          return compensation;
        },
      },
    });

    await expect(coordinator.transfer(transferRequest())).resolves.toMatchObject({
      ok: false,
      safeSurfaceId: destinationSurfaceId,
      error: { code: "COMPENSATION_FAILED", stage: "compensation" },
    });
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: destinationSurfaceId,
      state: "destination-pending-ready",
    });
    expect(adapter.events.filter((event) => event === "close")).toHaveLength(0);

    resolveCompensation();
    await Promise.resolve();
    await Promise.resolve();
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: sourceSurfaceId,
      state: "owned",
    });
    expect(adapter.events.filter((event) => event === "close")).toHaveLength(1);
  });

  it("rejects stale coordinator epochs without replacing an existing owner", () => {
    const ownership = new SurfaceOwnershipRegistry();
    ownership.register(mapPanelId, sourceSurfaceId, 5);

    expect(() => ownership.register(mapPanelId, sourceSurfaceId, 4)).toThrow("stale");
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({ coordinatorEpoch: 5 });
  });

  it("fails before destination preparation when another surface owns the panel", async () => {
    const { coordinator, ownership, adapter, events } = fixture();
    ownership.register(mapPanelId, destinationSurfaceId, 4);

    const result = await coordinator.transfer(transferRequest());

    expect(result).toMatchObject({
      ok: false,
      safeSurfaceId: destinationSurfaceId,
      error: { code: "OWNERSHIP_CONFLICT", stage: "ownership-commit" },
    });
    expect(adapter.events).toEqual([]);
    expect(events).toEqual([]);
    expect(ownership.ownerOf(mapPanelId)).toMatchObject({
      surfaceId: destinationSurfaceId,
      state: "owned",
      coordinatorEpoch: 4,
    });
  });

  it("recovers every panel from an unexpectedly lost surface with one owner each", () => {
    const ownership = new SurfaceOwnershipRegistry();
    ownership.register(mapPanelId, destinationSurfaceId, 4);
    ownership.register(panelId("panel:notes"), destinationSurfaceId, 4);

    expect(ownership.recoverSurface(destinationSurfaceId, recoverySurfaceId, 5)).toEqual([
      mapPanelId,
      panelId("panel:notes"),
    ]);
    expect(
      ownership
        .snapshot()
        .every((owner) => owner.surfaceId === recoverySurfaceId && owner.coordinatorEpoch === 5),
    ).toBe(true);
  });

  it("preserves exclusive ownership under reordered and duplicated transfer messages", () => {
    const secondDestination = surfaceId("surface:external-two");
    const actions = [
      "begin-one",
      "commit-one",
      "ready-one",
      "rollback-one",
      "begin-two",
      "commit-two",
      "ready-two",
      "rollback-two",
    ] as const;

    fc.assert(
      fc.property(fc.array(fc.constantFrom(...actions), { maxLength: 80 }), (events) => {
        const ownership = new SurfaceOwnershipRegistry();
        ownership.register(mapPanelId, sourceSurfaceId, 3);
        const token = (
          suffix: string,
          destinationId: typeof destinationSurfaceId,
        ): OwnershipToken => ({
          token: `transfer:${suffix}`,
          panelId: mapPanelId,
          sourceSurfaceId,
          destinationSurfaceId: destinationId,
          coordinatorEpoch: 3,
          sessionNonce: "session:test",
          baseRevision: revision(7),
        });
        const one = token("one", destinationSurfaceId);
        const two = token("two", secondDestination);

        for (const event of events) {
          if (event === "begin-one") ownership.begin(one);
          else if (event === "commit-one") ownership.commit(one);
          else if (event === "ready-one") ownership.ready(one);
          else if (event === "rollback-one") ownership.rollback(one);
          else if (event === "begin-two") ownership.begin(two);
          else if (event === "commit-two") ownership.commit(two);
          else if (event === "ready-two") ownership.ready(two);
          else ownership.rollback(two);

          const snapshot = ownership.snapshot();
          expect(snapshot).toHaveLength(1);
          expect(snapshot[0]?.panelId).toBe(mapPanelId);
          expect([sourceSurfaceId, destinationSurfaceId, secondDestination]).toContain(
            snapshot[0]?.surfaceId,
          );
        }
      }),
      { numRuns: 500 },
    );
  });
});
