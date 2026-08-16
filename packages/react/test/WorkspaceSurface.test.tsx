// @vitest-environment jsdom

import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  createDragActor as CreateDragActor,
  createResizeActor as CreateResizeActor,
} from "@panefold/protocol-xstate";
import {
  SurfaceFrameScheduler,
  type MotionDriver,
  type MotionHandle,
  type MotionPlan,
} from "@panefold/motion";

import {
  ENGLISH_WORKSPACE_MESSAGES,
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  solveWorkspaceProjectionLayout,
  type WorkspaceMessageCatalog,
  type WorkspaceCommandAdapter,
  type WorkspaceFloatingResizeEdge,
  type WorkspaceCommandOrigin,
  type WorkspaceGroupDropRequest,
  type WorkspaceGroupDropPlanContext,
  type WorkspacePanelRegistry,
  type WorkspacePanelDropRequest,
  type WorkspacePanelDropPlanContext,
  type WorkspaceExternalPanelHandler,
  type WorkspaceExternalPanelOutcome,
  type WorkspacePanelRenderProps,
  type WorkspaceProjection,
  type WorkspaceResultInterpreter,
  type WorkspaceRuntimeLike,
  type WorkspaceTabPresentationResolver,
  type WorkspaceLayoutSolver,
} from "../src";
import { FLOATING_SURFACE_CHROME_SIZE } from "../src/floating-surface";

const protocolActorInventory = vi.hoisted(() => ({
  drag: { created: 0, started: 0, stopped: 0, active: 0, pointerMoves: 0 },
  resize: { created: 0, started: 0, stopped: 0, active: 0, pointerMoves: 0 },
}));

vi.mock("@panefold/protocol-xstate", async (importOriginal) => {
  const actual = await importOriginal<{
    createDragActor: typeof CreateDragActor;
    createResizeActor: typeof CreateResizeActor;
  }>();
  type ActorKind = keyof typeof protocolActorInventory;
  interface InstrumentableActor {
    start(): unknown;
    stop(): void;
    send(event: { readonly type?: unknown }): void;
  }
  const instrument = (kind: ActorKind, actor: InstrumentableActor) => {
    const counters = protocolActorInventory[kind];
    counters.created += 1;
    const start = actor.start.bind(actor);
    const stop = actor.stop.bind(actor);
    const send = actor.send.bind(actor);
    let active = false;
    Object.defineProperties(actor, {
      start: {
        configurable: true,
        value: () => {
          if (!active) {
            active = true;
            counters.started += 1;
            counters.active += 1;
          }
          return start();
        },
      },
      stop: {
        configurable: true,
        value: () => {
          if (active) {
            active = false;
            counters.stopped += 1;
            counters.active -= 1;
          }
          stop();
        },
      },
      send: {
        configurable: true,
        value: (event: { readonly type?: unknown }) => {
          if (event.type === "POINTER_MOVE") counters.pointerMoves += 1;
          send(event);
        },
      },
    });
  };
  return {
    ...actual,
    createDragActor: (...args: Parameters<typeof actual.createDragActor>) => {
      const actor = actual.createDragActor(...args);
      instrument("drag", actor as unknown as InstrumentableActor);
      return actor;
    },
    createResizeActor: (...args: Parameters<typeof actual.createResizeActor>) => {
      const actor = actual.createResizeActor(...args);
      instrument("resize", actor as unknown as InstrumentableActor);
      return actor;
    },
  };
});

afterEach(() => {
  cleanup();
  for (const counters of Object.values(protocolActorInventory)) {
    counters.created = 0;
    counters.started = 0;
    counters.stopped = 0;
    counters.active = 0;
    counters.pointerMoves = 0;
  }
});

type FixtureCommand =
  | { readonly type: "select"; readonly panelId: string }
  | { readonly type: "activate"; readonly panelId: string }
  | { readonly type: "close"; readonly panelId: string }
  | {
      readonly type: "resize";
      readonly splitId: string;
      readonly weights: readonly number[];
    }
  | {
      readonly type: "move";
      readonly panelId: string;
      readonly groupId: string;
    }
  | {
      readonly type: "reorder";
      readonly panelId: string;
      readonly groupId: string;
      readonly beforePanelId?: string;
      readonly afterPanelId?: string;
    }
  | { readonly type: "drop"; readonly request: WorkspacePanelDropRequest }
  | { readonly type: "group-drop"; readonly request: WorkspaceGroupDropRequest }
  | {
      readonly type: "move-floating";
      readonly surfaceId: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "resize-floating";
      readonly surfaceId: string;
      readonly bounds: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
    }
  | { readonly type: "raise-floating"; readonly surfaceId: string }
  | { readonly type: "maximize-floating"; readonly surfaceId: string }
  | { readonly type: "restore-floating"; readonly surfaceId: string }
  | { readonly type: "minimize-floating"; readonly surfaceId: string }
  | { readonly type: "redock-floating"; readonly surfaceId: string };

interface FixtureSnapshot {
  readonly projection: WorkspaceProjection;
}

type FixtureReceipt =
  | {
      readonly status: "committed";
      readonly origin: WorkspaceCommandOrigin;
      readonly type: FixtureCommand["type"];
    }
  | {
      readonly status: "rejected";
      readonly origin: WorkspaceCommandOrigin;
      readonly type: FixtureCommand["type"];
      readonly result: { readonly error: { readonly message: string } };
    };

const initialProjection: WorkspaceProjection = {
  revision: "0",
  rootNodeId: "root",
  nodes: {
    root: {
      kind: "split",
      id: "root",
      axis: "inline",
      childIds: ["left-node", "right-node"],
      weights: [1, 1],
    },
    "left-node": { kind: "group", id: "left-node", groupId: "left" },
    "right-node": { kind: "group", id: "right-node", groupId: "right" },
  },
  groups: {
    left: {
      id: "left",
      panelIds: ["alpha", "beta"],
      selectedPanelId: "alpha",
      label: "Left",
    },
    right: {
      id: "right",
      panelIds: ["gamma"],
      selectedPanelId: "gamma",
      label: "Right",
    },
  },
  panels: {
    alpha: panel("alpha", "Alpha"),
    beta: panel("beta", "Beta"),
    gamma: panel("gamma", "Gamma"),
  },
  activePanelId: "alpha",
};

const floatingProjection: WorkspaceProjection = {
  ...initialProjection,
  nodes: {
    ...initialProjection.nodes,
    "floating-node": { kind: "group", id: "floating-node", groupId: "floating-group" },
  },
  groups: {
    ...initialProjection.groups,
    "floating-group": {
      id: "floating-group",
      panelIds: ["delta"],
      selectedPanelId: "delta",
      label: "Floating tools",
    },
  },
  panels: {
    ...initialProjection.panels,
    delta: panel("delta", "Delta"),
  },
  floatingSurfaces: [
    {
      id: "floating:delta",
      rootNodeId: "floating-node",
      bounds: { x: 100, y: 80, width: 320, height: 240 },
      maximized: false,
      label: "Floating tools",
    },
  ],
  activePanelId: "delta",
  activeSurfaceId: "floating:delta",
};

const commands: WorkspaceCommandAdapter<FixtureCommand> = {
  selectPanel: (panelId) => ({ type: "select", panelId }),
  activatePanel: (panelId) => ({ type: "activate", panelId }),
  closePanel: (panelId) => ({ type: "close", panelId }),
  resizeSplit: (splitId, weights) => ({ type: "resize", splitId, weights }),
  reorderPanel: (panelId, groupId, placement) => ({
    type: "reorder",
    panelId,
    groupId,
    ...placement,
  }),
  movePanel: (panelId, groupId) => ({ type: "move", panelId, groupId }),
};

const floatingCommands: WorkspaceCommandAdapter<FixtureCommand> = {
  ...commands,
  moveFloatingSurface: (surfaceId, position) => ({
    type: "move-floating",
    surfaceId,
    ...position,
  }),
  resizeFloatingSurface: (surfaceId, bounds) => ({
    type: "resize-floating",
    surfaceId,
    bounds,
  }),
  raiseFloatingSurface: (surfaceId) => ({ type: "raise-floating", surfaceId }),
  maximizeFloatingSurface: (surfaceId) => ({ type: "maximize-floating", surfaceId }),
  restoreFloatingSurface: (surfaceId) => ({ type: "restore-floating", surfaceId }),
  minimizeFloatingSurface: (surfaceId) => ({ type: "minimize-floating", surfaceId }),
  redockFloatingSurface: (surfaceId) => ({ type: "redock-floating", surfaceId }),
};

const directManipulationCommands: WorkspaceCommandAdapter<FixtureCommand> = {
  ...commands,
  planPanelDrop: (request, context) => ({
    command: { type: "drop", request },
    previewRect: fixtureDropPreview(request, context),
  }),
  planGroupDrop: (request, context) => ({
    command: { type: "group-drop", request },
    previewRect: fixtureGroupDropPreview(request, context),
  }),
};

const panels: WorkspacePanelRegistry = {
  fixture: {
    render: ({ panel: item }) => (
      <label>
        {item.title} value
        <input aria-label={`${item.title} value`} defaultValue={item.title} />
      </label>
    ),
  },
};

const INDONESIAN_MESSAGES: WorkspaceMessageCatalog = {
  workspaceLabel: () => "Ruang kerja",
  panelGroupFallback: () => "Grup panel",
  groupFallback: () => "grup",
  panelFallback: () => "panel",
  panelRenderFailed: ({ title }) => `${title} gagal ditampilkan`,
  panelRenderRecovery: () => "Ruang kerja tetap aman. Coba lagi atau tutup panel ini.",
  retry: () => "Coba lagi",
  resizedWorkspacePanes: () => "Mengubah ukuran panel ruang kerja",
  selectedPanel: ({ title }) => `Memilih ${title}`,
  activatedPanel: ({ title }) => `Mengaktifkan ${title}`,
  closedPanel: ({ title }) => `Menutup ${title}`,
  movedPanel: ({ title }) => `Memindahkan ${title}`,
  movedPanelTo: ({ title, group }) => `Memindahkan ${title} ke ${group}`,
  floatedPanel: ({ title }) => `Melayangkan ${title}`,
  floatPanel: ({ title }) => `Layangkan ${title}`,
  moveCancelled: () => "Pemindahan dibatalkan",
  workspaceRegions: () => "Wilayah ruang kerja",
  currentWorkspaceRegion: () => "Wilayah ruang kerja saat ini",
  regionOption: ({ label, panelCount }) => `${label} · ${String(panelCount)} panel`,
  resizeAdjacentPanes: () => "Ubah ukuran panel bersebelahan",
  primaryPanePercent: ({ percent }) => `Panel utama ${String(percent)} persen`,
  closePanel: ({ title }) => `Tutup ${title}`,
  actionsForPanel: ({ title }) => `Tindakan untuk ${title}`,
  panelActions: ({ title }) => `Tindakan ${title}`,
  chooseDestination: () => "Pilih tujuan…",
  moveToGroup: ({ group }) => `Pindahkan ke ${group}`,
  movePanelDialog: ({ title }) => `Pindahkan ${title}`,
  noAvailableGroup: () => "Tidak ada grup tersedia",
  moveInstructions: () => "Gunakan tombol panah, Enter untuk memindahkan, atau Escape untuk batal.",
  missingRenderer: ({ type }) =>
    `Perender ${type} tidak tersedia. Deskriptor dan posisi panel tetap dapat dipulihkan.`,
  noWorkspaceLayout: () => "Belum ada tata letak ruang kerja",
  emptyWorkspaceInstructions: () => "Buka panel atau pulihkan preset untuk memulai.",
  emptyPanelGroupInstructions: ({ group }) =>
    `${group} kosong. Seret panel ke sini atau pilih grup ini sebagai tujuan pemindahan.`,
  commandQueued: ({ label }) => `${label} masuk antrean`,
  commandRejected: ({ label, reason }) =>
    reason === undefined ? `${label} ditolak` : `${label} ditolak: ${reason}`,
  resizeDidNotCommit: ({ status }) => `Perubahan ukuran tidak tersimpan (${status}).`,
};

describe("WorkspaceSurface", () => {
  it("replaces labels, interpolations, and outcome announcements with a typed catalog", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection, "close");
    const announcements: string[] = [];
    render(
      <WorkspaceRuntimeProvider runtime={runtime}>
        <div style={{ width: 1000, height: 700 }}>
          <WorkspaceSurface
            projector={(snapshot: FixtureSnapshot) => snapshot.projection}
            commands={commands}
            panels={panels}
            layoutBounds={{ inlineStart: 0, blockStart: 0, inlineSize: 1000, blockSize: 700 }}
            messageCatalog={INDONESIAN_MESSAGES}
            onAnnouncement={(message) => announcements.push(message)}
          />
        </div>
      </WorkspaceRuntimeProvider>,
    );

    expect(screen.getByLabelText("Ruang kerja")).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Ubah ukuran panel bersebelahan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tindakan untuk Alpha" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Beta" }));
    expect(announcements.at(-1)).toBe("Memilih Beta");
    await user.click(
      requiredElement(
        screen.getByRole("tab", { name: "Beta" }).querySelector('[title="Tutup Beta"]'),
      ),
    );
    expect(announcements.at(-1)).toBe("Menutup Beta ditolak: Denied by fixture policy");
  });

  it("projects accessible tabs, tabpanels, and keyboard tab behavior", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);

    expect(await screen.findByRole("tablist", { name: "Left" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("separator", { name: /resize adjacent/i })).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "Alpha" })).toBeTruthy();

    screen.getByRole("tab", { name: "Alpha" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(screen.getByRole("tabpanel", { name: "Beta" })).toBeTruthy();
    });
    expect(runtime.getSnapshot().projection.activePanelId).toBe("beta");
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");
  });

  it("projects same-document floating surfaces without modal semantics", async () => {
    const runtime = new FixtureRuntime(floatingProjection);
    const user = userEvent.setup();
    renderWorkspace(runtime, { commands: floatingCommands });

    const frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("role")).toBeNull();
    expect(frame?.getAttribute("aria-modal")).toBeNull();
    expect(frame?.style.left).toBe("100px");
    expect(frame?.style.top).toBe("80px");
    expect(frame?.style.width).toBe("320px");
    expect(frame?.style.height).toBe("240px");
    expect(screen.getByRole("tabpanel", { name: "Delta" })).toBeTruthy();
    expect(document.querySelectorAll('[data-workspace-panel-host="delta"]')).toHaveLength(1);

    screen.getByLabelText("Move Floating tools floating window").focus();
    await user.tab({ shift: true });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest("[data-workspace-floating-surface]")).toBeNull();
  });

  it("combines a sole floating panel tab and window chrome into one header row", () => {
    const runtime = new FixtureRuntime(floatingProjection);
    renderWorkspace(runtime, { commands: floatingCommands });

    const frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    const titlebar = frame?.querySelector(".pf-floating-titlebar");
    const compactTabStrip = titlebar?.querySelector(".pf-tab-strip");
    expect(frame?.getAttribute("data-compact-header")).toBe("true");
    expect(compactTabStrip).not.toBeNull();
    expect(
      compactTabStrip?.querySelector('[role="tab"][data-workspace-panel-tab="delta"]'),
    ).not.toBeNull();
    expect(frame?.querySelectorAll(".pf-tab-strip")).toHaveLength(1);
    expect(frame?.querySelector('[data-workspace-panel-controls="delta"]')).not.toBeNull();

    const tab = compactTabStrip?.querySelector<HTMLElement>(
      '[role="tab"][data-workspace-panel-tab="delta"]',
    );
    expect(tab).not.toBeNull();
    if (tab !== null && tab !== undefined) {
      installPointerCapture(tab);
      fireEvent.pointerDown(tab, { button: 0, pointerId: 40, clientX: 120, clientY: 100 });
      expect(frame?.dataset.floatingManipulation).toBe("idle");
      fireEvent.pointerCancel(tab, { pointerId: 40 });
    }
  });

  it("keeps separate floating title and tab rows when the window contains multiple panels", () => {
    const floatingGroup = floatingProjection.groups["floating-group"];
    if (floatingGroup === undefined) throw new Error("Expected the floating group fixture");
    const runtime = new FixtureRuntime({
      ...floatingProjection,
      groups: {
        ...floatingProjection.groups,
        "floating-group": {
          ...floatingGroup,
          panelIds: ["delta", "epsilon"],
        },
      },
      panels: {
        ...floatingProjection.panels,
        epsilon: panel("epsilon", "Epsilon"),
      },
    });
    renderWorkspace(runtime, { commands: floatingCommands });

    const frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frame?.getAttribute("data-compact-header")).toBe("false");
    expect(frame?.querySelector(".pf-floating-titlebar .pf-tab-strip")).toBeNull();
    expect(frame?.querySelector(".pf-floating-content .pf-tab-strip")).not.toBeNull();
    expect(frame?.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it("projects canonical z-order and raises a background float from the keyboard", async () => {
    const projection: WorkspaceProjection = {
      ...floatingProjection,
      nodes: {
        ...floatingProjection.nodes,
        "epsilon-node": { kind: "group", id: "epsilon-node", groupId: "epsilon-group" },
      },
      groups: {
        ...floatingProjection.groups,
        "epsilon-group": {
          id: "epsilon-group",
          panelIds: ["epsilon"],
          selectedPanelId: "epsilon",
          label: "Epsilon tools",
        },
      },
      panels: {
        ...floatingProjection.panels,
        epsilon: panel("epsilon", "Epsilon"),
      },
      floatingSurfaces: [
        ...(floatingProjection.floatingSurfaces ?? []),
        {
          id: "floating:epsilon",
          rootNodeId: "epsilon-node",
          bounds: { x: 180, y: 140, width: 300, height: 220 },
          maximized: false,
          label: "Epsilon tools",
        },
      ],
      activePanelId: "epsilon",
      activeSurfaceId: "floating:epsilon",
    };
    const runtime = new FixtureRuntime(projection);
    renderWorkspace(runtime, { commands: floatingCommands });
    const deltaFrame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    const epsilonFrame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:epsilon"]',
    );
    expect(deltaFrame?.style.zIndex).toBe("1");
    expect(epsilonFrame?.style.zIndex).toBe("2");

    const deltaTitlebar = screen.getByLabelText("Move Floating tools floating window");
    deltaTitlebar.focus();
    await userEvent.keyboard("{Enter}");

    expect(runtime.lastCommand).toEqual({
      type: "raise-floating",
      surfaceId: "floating:delta",
    });
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");
    expect(deltaFrame?.style.zIndex).toBe("2");
  });

  it("previews a floating titlebar drag and commits one semantic move", async () => {
    const runtime = new FixtureRuntime(floatingProjection);
    const frames = createManualFrameScheduler();
    renderWorkspace(runtime, { commands: floatingCommands, frameScheduler: frames.scheduler });
    const frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frame).not.toBeNull();
    const titlebar = screen.getByLabelText("Move Floating tools floating window");
    installPointerCapture(titlebar);

    fireEvent.pointerDown(titlebar, {
      button: 0,
      pointerId: 41,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerMove(titlebar, {
      pointerId: 41,
      clientX: 170,
      clientY: 140,
    });
    expect(frame?.style.left).toBe("100px");
    frames.flush();
    expect(frame?.style.left).toBe("150px");
    expect(frame?.style.top).toBe("120px");
    fireEvent.pointerUp(titlebar, {
      pointerId: 41,
      clientX: 170,
      clientY: 140,
    });

    expect(runtime.lastCommand).toEqual({
      type: "move-floating",
      surfaceId: "floating:delta",
      x: 150,
      y: 120,
    });
    expect(runtime.transactions).toHaveLength(1);
    expect(runtime.transactions[0]?.origin).toBe("pointer");
  });

  it("moves a minimized floating surface from its titlebar without exposing resize handles", () => {
    const runtime = new FixtureRuntime({
      ...floatingProjection,
      floatingSurfaces: (floatingProjection.floatingSurfaces ?? []).map((surface) => ({
        ...surface,
        minimized: true,
      })),
    });
    const frames = createManualFrameScheduler();
    renderWorkspace(runtime, { commands: floatingCommands, frameScheduler: frames.scheduler });
    const frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frame?.style.height).toBe(`${String(FLOATING_SURFACE_CHROME_SIZE)}px`);
    expect(frame?.querySelector(".pf-floating-resize-handle")).toBeNull();
    const titlebar = screen.getByLabelText("Move Floating tools floating window");
    installPointerCapture(titlebar);

    fireEvent.pointerDown(titlebar, {
      button: 0,
      pointerId: 42,
      clientX: 120,
      clientY: 95,
    });
    fireEvent.pointerMove(titlebar, {
      pointerId: 42,
      clientX: 170,
      clientY: 125,
    });
    frames.flush();
    expect(frame?.style.left).toBe("150px");
    expect(frame?.style.top).toBe("110px");
    fireEvent.pointerUp(titlebar, {
      pointerId: 42,
      clientX: 170,
      clientY: 125,
    });

    expect(runtime.lastCommand).toEqual({
      type: "move-floating",
      surfaceId: "floating:delta",
      x: 150,
      y: 110,
    });
    expect(runtime.transactions.at(-1)?.origin).toBe("pointer");
  });

  it("does not structurally animate content when its floating frame moves", () => {
    const runtime = new FixtureRuntime(floatingProjection);
    const frames = createManualFrameScheduler();
    const driver = new RecordingMotionDriver();
    renderWorkspace(runtime, {
      commands: floatingCommands,
      frameScheduler: frames.scheduler,
      motionDriver: driver,
    });
    const titlebar = screen.getByLabelText("Move Floating tools floating window");
    installPointerCapture(titlebar);

    fireEvent.pointerDown(titlebar, {
      button: 0,
      pointerId: 51,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerMove(titlebar, {
      pointerId: 51,
      clientX: 170,
      clientY: 140,
    });
    frames.flush();
    fireEvent.pointerUp(titlebar, {
      pointerId: 51,
      clientX: 170,
      clientY: 140,
    });

    expect(driver.plans.map((plan) => plan.targetId)).not.toContain("floating-node");
  });

  it("cancels a floating gesture when its captured projection revision changes", () => {
    const runtime = new FixtureRuntime(floatingProjection);
    const frames = createManualFrameScheduler();
    renderWorkspace(runtime, { commands: floatingCommands, frameScheduler: frames.scheduler });
    const frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    const titlebar = screen.getByLabelText("Move Floating tools floating window");
    installPointerCapture(titlebar);

    fireEvent.pointerDown(titlebar, {
      button: 0,
      pointerId: 52,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerMove(titlebar, {
      pointerId: 52,
      clientX: 180,
      clientY: 150,
    });
    frames.flush();
    expect(frame?.style.left).toBe("160px");

    act(() => {
      runtime.publishProjection({ ...floatingProjection, revision: "1" });
    });
    expect(frame?.style.left).toBe("100px");
    fireEvent.pointerUp(titlebar, {
      pointerId: 52,
      clientX: 180,
      clientY: 150,
    });
    expect(runtime.transactions).toHaveLength(0);
  });

  it("supports keyboard resize and floating minimize, maximize, restore, and redock controls", async () => {
    const runtime = new FixtureRuntime(floatingProjection);
    const user = userEvent.setup();
    const resizeFloatingSurface = vi.fn(
      ({ title, edge }: { readonly title: string; readonly edge: WorkspaceFloatingResizeEdge }) =>
        `Ubah ukuran ${title} dari ${edge === "right" ? "kanan" : edge}`,
    );
    renderWorkspace(runtime, {
      commands: floatingCommands,
      messageCatalog: { ...ENGLISH_WORKSPACE_MESSAGES, resizeFloatingSurface },
    });

    const resizeHandle = await screen.findByRole("separator", {
      name: "Ubah ukuran Floating tools dari kanan",
    });
    expect(resizeFloatingSurface).toHaveBeenCalledWith({ title: "Floating tools", edge: "right" });
    expect(resizeHandle.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizeHandle.getAttribute("aria-valuemin")).toBe("0");
    expect(resizeHandle.getAttribute("aria-valuemax")).toBe("100");
    expect(resizeHandle.getAttribute("aria-valuenow")).toBe("42");
    const frameBeforeResize = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frameBeforeResize?.querySelectorAll('[role="separator"]')).toHaveLength(4);
    expect(
      frameBeforeResize?.querySelector('[data-resize-edge="bottom-right"]')?.getAttribute("role"),
    ).toBeNull();
    expect(
      frameBeforeResize
        ?.querySelector('[data-resize-edge="bottom-right"]')
        ?.getAttribute("tabindex"),
    ).toBeNull();

    resizeHandle.focus();
    await user.keyboard("{ArrowRight}");
    expect(runtime.lastCommand).toMatchObject({
      type: "resize-floating",
      surfaceId: "floating:delta",
      bounds: { width: 328, height: 240 },
    });
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");

    await user.click(
      screen.getByRole("button", { name: "Maximize Floating tools floating window" }),
    );
    let frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frame?.getAttribute("data-maximized")).toBe("true");
    expect(frame?.style.width).toBe("1000px");
    expect(frame?.style.height).toBe("700px");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Restore Floating tools floating window" }),
    );

    await user.click(
      screen.getByRole("button", { name: "Restore Floating tools floating window" }),
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText("Move Floating tools floating window"),
    );
    await user.click(
      screen.getByRole("button", { name: "Minimize Floating tools floating window" }),
    );
    frame = document.querySelector<HTMLElement>(
      '[data-workspace-floating-surface="floating:delta"]',
    );
    expect(frame?.getAttribute("data-minimized")).toBe("true");
    expect(screen.queryByRole("tabpanel", { name: "Delta" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Restore Floating tools floating window" }),
    );
    expect(
      document.querySelector('[data-workspace-panel-host="delta"]')?.getAttribute("data-lifecycle"),
    ).toBe("suspended");

    await user.click(
      screen.getByRole("button", { name: "Restore Floating tools floating window" }),
    );
    expect(screen.getByRole("tabpanel", { name: "Delta" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dock Floating tools in the workspace" }));
    expect(document.querySelector('[data-workspace-floating-surface="floating:delta"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Delta" }));
    expect(runtime.lastCommand).toEqual({
      type: "redock-floating",
      surfaceId: "floating:delta",
    });
  });

  it("names an unlabeled tablist from the localized group fallback heading", async () => {
    const projection: WorkspaceProjection = {
      ...initialProjection,
      groups: {
        ...initialProjection.groups,
        left: {
          id: "left",
          panelIds: ["alpha", "beta"],
          selectedPanelId: "alpha",
        },
      },
    };
    renderWorkspace(new FixtureRuntime(projection));

    const tablist = await screen.findByRole("tablist", { name: "Panel group" });
    const headingId = tablist.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId ?? "")?.textContent).toBe("Panel group");
  });

  it("keeps close affordances in their tabs without breaking tablist semantics", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);

    const tablist = await screen.findByRole("tablist", { name: "Left" });
    expect(Array.from(tablist.children).map((child) => child.getAttribute("role"))).toEqual([
      "tab",
      "tab",
    ]);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(alpha.getAttribute("aria-keyshortcuts")).toBe("Delete");
    expect(beta.querySelector('[data-workspace-tab-close="beta"]')?.textContent).toBe("×");
    expect(
      screen.getByRole("button", { name: "Actions for Alpha" }).closest("[role=tablist]"),
    ).toBeNull();

    fireEvent.click(requiredElement(beta.querySelector('[data-workspace-tab-close="beta"]')), {
      detail: 1,
    });
    expect(runtime.lastCommand).toEqual({ type: "close", panelId: "beta" });
    expect(runtime.transactions.at(-1)?.origin).toBe("pointer");
  });

  it("commits semantic splitter steps with keyboard origin and useful scale", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);
    const splitter = await screen.findByRole("separator", {
      name: /resize adjacent/i,
    });
    splitter.focus();

    await userEvent.keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(runtime.getSnapshot().projection.revision).toBe("1");
    });
    const root = runtime.getSnapshot().projection.nodes.root;
    expect(root?.kind).toBe("split");
    if (root?.kind === "split") {
      expect(root.weights[0]).toBeCloseTo(1.04);
      expect(root.weights[1]).toBeCloseTo(0.96);
    }
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");
  });

  it("uses one geometry projection for pointer preview and commit", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const frames = createManualFrameScheduler();
    let workspaceProjectionRenders = 0;
    const view = renderWorkspace(runtime, {
      frameScheduler: frames.scheduler,
      tabPresentation: () => {
        workspaceProjectionRenders += 1;
        return { placement: "block-start", content: "icon-and-label" };
      },
    });
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    installPointerCapture(splitter);
    const firstChild = requiredElement(
      view.container.querySelector('[data-workspace-split="root"] > .pf-split-child'),
    );
    expect(firstChild.dataset.inlineSize).toBe("497");

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 7, clientX: 497, clientY: 0 });
    const rendersAtPointerStart = workspaceProjectionRenders;
    fireEvent.pointerMove(splitter, { pointerId: 7, clientX: 550, clientY: 0 });
    fireEvent.pointerMove(splitter, { pointerId: 7, clientX: 597, clientY: 0 });
    expect(firstChild.dataset.inlineSize).toBe("497");
    expect(protocolActorInventory.resize.pointerMoves).toBe(0);
    expect(workspaceProjectionRenders).toBe(rendersAtPointerStart);
    act(() => {
      frames.flush();
    });

    const previewSize = firstChild.dataset.inlineSize;
    expect(previewSize).toBe("597");
    expect(protocolActorInventory.resize.pointerMoves).toBe(1);
    expect(workspaceProjectionRenders).toBe(rendersAtPointerStart);
    expect(runtime.getSnapshot().projection.revision).toBe("0");

    fireEvent.pointerUp(splitter, { pointerId: 7, clientX: 597, clientY: 0 });
    await waitFor(() => {
      expect(runtime.getSnapshot().projection.revision).toBe("1");
    });
    expect(firstChild.dataset.inlineSize).toBe(previewSize);
    expect(protocolActorInventory.resize.pointerMoves).toBe(2);
    expect(protocolActorInventory.resize.active).toBe(0);
    expect(runtime.transactions.at(-1)?.origin).toBe("pointer");
  });

  it("refreshes cached preview targets when a same-axis split gains a child", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const frames = createManualFrameScheduler();
    const view = renderWorkspace(runtime, { frameScheduler: frames.scheduler });
    const originalSplitter = await screen.findByRole("separator", {
      name: /resize adjacent/i,
    });
    const originalRightChild = requiredElement(
      view.container.querySelector('[data-workspace-split-child="right-node"]'),
    );
    installPointerCapture(originalSplitter);

    fireEvent.pointerDown(originalSplitter, {
      button: 0,
      pointerId: 74,
      clientX: 497,
      clientY: 0,
    });
    fireEvent.pointerMove(originalSplitter, {
      pointerId: 74,
      clientX: 520,
      clientY: 0,
    });
    act(() => {
      frames.flush();
    });
    fireEvent.pointerCancel(originalSplitter, {
      pointerId: 74,
      clientX: 520,
      clientY: 0,
    });

    const current = runtime.getSnapshot().projection;
    const root = current.nodes.root;
    if (root?.kind !== "split") throw new Error("Expected the fixture root split");
    act(() => {
      runtime.publishProjection({
        ...current,
        revision: "1",
        nodes: {
          ...current.nodes,
          root: {
            ...root,
            childIds: ["left-node", "right-node", "middle-node"],
            weights: [1, 1, 1],
          },
          "middle-node": { kind: "group", id: "middle-node", groupId: "middle" },
        },
        groups: {
          ...current.groups,
          middle: {
            id: "middle",
            panelIds: [],
            selectedPanelId: "",
            label: "Middle",
          },
        },
      });
    });

    const splitters = screen.getAllByRole("separator", { name: /resize adjacent/i });
    expect(splitters).toHaveLength(2);
    expect(splitters[0]).toBe(originalSplitter);
    expect(view.container.querySelector('[data-workspace-split-child="right-node"]')).toBe(
      originalRightChild,
    );
    const newSplitter = requiredElement(splitters[1] ?? null);
    const middleChild = requiredElement(
      view.container.querySelector('[data-workspace-split-child="middle-node"]'),
    );
    installPointerCapture(newSplitter);
    const start = Number(newSplitter.dataset.inlineStart);
    const initialMiddleSize = middleChild.style.getPropertyValue("--pf-split-size");
    const initialSplitterPosition = newSplitter.dataset.inlineStart;

    fireEvent.pointerDown(newSplitter, {
      button: 0,
      pointerId: 75,
      clientX: start,
      clientY: 0,
    });
    fireEvent.pointerMove(newSplitter, {
      pointerId: 75,
      clientX: start + 80,
      clientY: 0,
    });
    act(() => {
      frames.flush();
    });

    expect(middleChild.style.getPropertyValue("--pf-split-size")).not.toBe(initialMiddleSize);
    expect(newSplitter.dataset.inlineStart).not.toBe(initialSplitterPosition);
    expect(runtime.transactions).toHaveLength(0);

    fireEvent.pointerCancel(newSplitter, {
      pointerId: 75,
      clientX: start + 80,
      clientY: 0,
    });
  });

  it("commits constrained solved weights after a pointer overshoots a hard minimum", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const frames = createManualFrameScheduler();
    const view = renderWorkspace(runtime, {
      frameScheduler: frames.scheduler,
      layoutSolver: hardMinimumLayoutSolver,
    });
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    installPointerCapture(splitter);
    const firstChild = requiredElement(
      view.container.querySelector('[data-workspace-split="root"] > .pf-split-child'),
    );

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 8, clientX: 497, clientY: 0 });
    fireEvent.pointerMove(splitter, { pointerId: 8, clientX: 900, clientY: 0 });
    act(() => {
      frames.flush();
    });
    expect(firstChild.dataset.inlineSize).toBe("544");

    fireEvent.pointerUp(splitter, { pointerId: 8, clientX: 900, clientY: 0 });
    expect(runtime.lastCommand?.type).toBe("resize");
    if (runtime.lastCommand?.type === "resize") {
      const total = runtime.lastCommand.weights.reduce((sum, weight) => sum + weight, 0);
      expect((runtime.lastCommand.weights[0] ?? 0) / total).toBeCloseTo(544 / 994);
    }
    await waitFor(() => {
      expect(firstChild.dataset.inlineSize).toBe("544");
    });
  });

  it("commits the final constrained pointer sample before a coalesced frame runs", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const frames = createManualFrameScheduler();
    const view = renderWorkspace(runtime, {
      frameScheduler: frames.scheduler,
      layoutSolver: hardMinimumLayoutSolver,
    });
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    installPointerCapture(splitter);
    const firstChild = requiredElement(
      view.container.querySelector('[data-workspace-split="root"] > .pf-split-child'),
    );

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 9, clientX: 497, clientY: 0 });
    fireEvent.pointerMove(splitter, { pointerId: 9, clientX: 900, clientY: 0 });
    expect(frames.hasPending()).toBe(true);
    expect(firstChild.dataset.inlineSize).toBe("497");

    fireEvent.pointerUp(splitter, { pointerId: 9, clientX: 900, clientY: 0 });

    expect(frames.hasPending()).toBe(false);
    expect(runtime.lastCommand?.type).toBe("resize");
    if (runtime.lastCommand?.type === "resize") {
      const total = runtime.lastCommand.weights.reduce((sum, weight) => sum + weight, 0);
      expect((runtime.lastCommand.weights[0] ?? 0) / total).toBeCloseTo(544 / 994);
    }
    await waitFor(() => {
      expect(firstChild.dataset.inlineSize).toBe("544");
    });
  });

  it("commits constrained solved weights after a keyboard step hits a hard minimum", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, { layoutSolver: hardMinimumLayoutSolver });
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    const firstChild = requiredElement(
      view.container.querySelector('[data-workspace-split="root"] > .pf-split-child'),
    );
    splitter.focus();

    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(runtime.lastCommand?.type).toBe("resize");
    if (runtime.lastCommand?.type === "resize") {
      const total = runtime.lastCommand.weights.reduce((sum, weight) => sum + weight, 0);
      expect((runtime.lastCommand.weights[0] ?? 0) / total).toBeCloseTo(544 / 994);
    }
    await waitFor(() => {
      expect(firstChild.dataset.inlineSize).toBe("544");
    });
  });

  it("keeps pointer ownership in the resize actor and restores geometry on cancellation", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const frames = createManualFrameScheduler();
    const view = renderWorkspace(runtime, { frameScheduler: frames.scheduler });
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    installPointerCapture(splitter);
    const firstChild = requiredElement(
      view.container.querySelector('[data-workspace-split="root"] > .pf-split-child'),
    );

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 11, clientX: 497, clientY: 0 });
    expect(splitter.dataset.resizeState).toBe("armed");
    fireEvent.pointerMove(splitter, { pointerId: 12, clientX: 650, clientY: 0 });
    fireEvent.pointerUp(splitter, { pointerId: 12, clientX: 650, clientY: 0 });
    expect(frames.hasPending()).toBe(false);
    expect(firstChild.dataset.inlineSize).toBe("497");
    expect(runtime.transactions).toHaveLength(0);

    fireEvent.pointerMove(splitter, { pointerId: 11, clientX: 570, clientY: 0 });
    act(() => {
      frames.flush();
    });
    expect(firstChild.dataset.inlineSize).toBe("570");
    expect(splitter.dataset.resizeState).toBe("resizing");

    fireEvent.pointerCancel(splitter, { pointerId: 11, clientX: 570, clientY: 0 });
    await waitFor(() => {
      expect(firstChild.dataset.inlineSize).toBe("497");
      expect(splitter.dataset.resizeState).toBe("idle");
    });
    expect(runtime.transactions).toHaveLength(0);
  });

  it("creates protocol actors only for active interactions and closes every owning scope", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime);
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    installPointerCapture(splitter);
    installPointerCapture(alpha);

    expect(protocolActorInventory).toMatchObject({
      drag: { created: 0, active: 0 },
      resize: { created: 0, active: 0 },
    });

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 81, clientX: 497, clientY: 0 });
    expect(protocolActorInventory.resize).toMatchObject({ created: 1, started: 1, active: 1 });
    fireEvent.pointerCancel(splitter, { pointerId: 81, clientX: 497, clientY: 0 });
    expect(protocolActorInventory.resize).toMatchObject({ stopped: 1, active: 0 });

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 82, clientX: 100, clientY: 20 });
    expect(protocolActorInventory.drag).toMatchObject({ created: 1, started: 1, active: 1 });
    fireEvent.pointerCancel(alpha, { pointerId: 82, clientX: 100, clientY: 20 });
    expect(protocolActorInventory.drag).toMatchObject({ stopped: 1, active: 0 });

    splitter.focus();
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(protocolActorInventory.resize).toMatchObject({
      created: 2,
      started: 2,
      stopped: 2,
      active: 0,
    });

    const currentAlpha = screen.getByRole("tab", { name: "Alpha" });
    installPointerCapture(currentAlpha);
    fireEvent.pointerDown(currentAlpha, {
      button: 0,
      pointerId: 83,
      clientX: 100,
      clientY: 20,
    });
    expect(protocolActorInventory.drag.active).toBe(1);
    view.unmount();
    expect(protocolActorInventory.drag).toMatchObject({ stopped: 2, active: 0 });

    const secondView = renderWorkspace(new FixtureRuntime(initialProjection));
    const secondSplitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    installPointerCapture(secondSplitter);
    fireEvent.pointerDown(secondSplitter, {
      button: 0,
      pointerId: 84,
      clientX: 497,
      clientY: 0,
    });
    expect(protocolActorInventory.resize.active).toBe(1);
    secondView.unmount();
    expect(protocolActorInventory.resize).toMatchObject({ stopped: 3, active: 0 });
  });

  it("maps keyboard steps through logical axes in RTL", async () => {
    const inlineRuntime = new FixtureRuntime(initialProjection);
    const inlineView = renderWorkspace(inlineRuntime, { direction: "rtl" });
    const inlineSplitter = await screen.findByRole("separator", {
      name: /resize adjacent/i,
    });
    inlineSplitter.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(inlineRuntime.getSnapshot().projection.revision).toBe("1");
    });
    const inlineRoot = inlineRuntime.getSnapshot().projection.nodes.root;
    expect(inlineRoot?.kind === "split" ? inlineRoot.weights[0] : undefined).toBeCloseTo(0.96);
    inlineView.unmount();

    const root = initialProjection.nodes.root;
    if (root?.kind !== "split") throw new Error("Fixture requires a root split");
    const blockRuntime = new FixtureRuntime({
      ...initialProjection,
      nodes: { ...initialProjection.nodes, root: { ...root, axis: "block" } },
    });
    renderWorkspace(blockRuntime, { direction: "rtl" });
    const blockSplitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    blockSplitter.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(blockRuntime.getSnapshot().projection.revision).toBe("1");
    });
    const blockRoot = blockRuntime.getSnapshot().projection.nodes.root;
    expect(blockRoot?.kind === "split" ? blockRoot.weights[0] : undefined).toBeCloseTo(1.04);
  });

  it("adapts structural FLIP plans to reduced motion", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const driver = new RecordingMotionDriver();
    renderWorkspace(runtime, { motion: "reduced", motionDriver: driver });

    act(() => {
      runtime.dispatch(
        { type: "resize", splitId: "root", weights: [1.4, 0.6] },
        { origin: "application", label: "External layout change" },
      );
    });

    await waitFor(() => {
      expect(driver.plans.length).toBeGreaterThan(0);
    });
    for (const plan of driver.plans) {
      expect(plan.durationMs).toBeLessThanOrEqual(90);
      expect(plan.keyframes).not.toHaveProperty("transform");
    }
  });

  it("announces rejection instead of a false success", async () => {
    const runtime = new FixtureRuntime(initialProjection, "select");
    renderWorkspace(runtime);

    await userEvent.click(await screen.findByRole("tab", { name: "Beta" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /selected beta was rejected.*denied by fixture/i,
      );
    });
    expect(runtime.getSnapshot().projection.activePanelId).toBe("alpha");
    expect(screen.getByRole("status").textContent).not.toBe("Selected Beta");
  });

  it("restores focus to the next eligible tab after keyboard close", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    alpha.focus();

    await userEvent.keyboard("{Delete}");

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "Alpha" })).toBeNull();
      expect(screen.getByRole("tab", { name: "Beta" })).toBe(document.activeElement);
    });
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");
  });

  it("creates distinct DOM relationships for colliding unsafe panel IDs", async () => {
    const leftGroup = initialProjection.groups.left;
    if (leftGroup === undefined) throw new Error("Missing left fixture group");
    const collisionProjection: WorkspaceProjection = {
      ...initialProjection,
      groups: {
        ...initialProjection.groups,
        left: {
          ...leftGroup,
          panelIds: ["a/b", "a?b"],
          selectedPanelId: "a/b",
        },
      },
      panels: {
        ...initialProjection.panels,
        "a/b": panel("a/b", "Slash"),
        "a?b": panel("a?b", "Question"),
      },
      activePanelId: "a/b",
    };
    const runtime = new FixtureRuntime(collisionProjection);
    renderWorkspace(runtime);

    const slash = await screen.findByRole("tab", { name: "Slash" });
    const question = screen.getByRole("tab", { name: "Question" });
    const slashPanelId = slash.getAttribute("aria-controls");
    const questionPanelId = question.getAttribute("aria-controls");
    expect(slash.id).not.toBe(question.id);
    expect(slashPanelId).not.toBe(questionPanelId);
    expect(document.getElementById(slashPanelId ?? "missing")).toBeTruthy();
    expect(document.getElementById(questionPanelId ?? "missing")).toBeTruthy();
  });

  it("applies explicit and system reduced-motion preferences", async () => {
    const explicitRuntime = new FixtureRuntime(initialProjection);
    const explicit = renderWorkspace(explicitRuntime, { motion: "reduced" });
    expect(
      explicit.container.querySelector(".pf-workspace")?.getAttribute("data-effective-motion"),
    ).toBe("reduced");
    explicit.unmount();

    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });
    const systemRuntime = new FixtureRuntime(initialProjection);
    const system = renderWorkspace(systemRuntime);
    await waitFor(() => {
      expect(
        system.container.querySelector(".pf-workspace")?.getAttribute("data-effective-motion"),
      ).toBe("reduced");
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("projects one selectable region on a compact coarse-pointer surface without mutating topology", async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });
    const runtime = new FixtureRuntime(initialProjection);
    function CompactFixture() {
      const [groupId, setGroupId] = useState("left");
      return (
        <WorkspaceRuntimeProvider runtime={runtime}>
          <div style={{ width: 390, height: 700 }}>
            <WorkspaceSurface
              projector={(snapshot: FixtureSnapshot) => snapshot.projection}
              commands={commands}
              panels={panels}
              layoutBounds={{ inlineStart: 0, blockStart: 0, inlineSize: 390, blockSize: 700 }}
              workspaceLabel="Compact fixture workspace"
              responsive="auto"
              compactGroupId={groupId}
              onCompactGroupChange={setGroupId}
            />
          </div>
        </WorkspaceRuntimeProvider>
      );
    }
    render(<CompactFixture />);

    const workspace = screen.getByLabelText("Compact fixture workspace");
    await waitFor(() => {
      expect(workspace.dataset.responsiveProjection).toBe("single-region");
    });
    expect(
      (
        screen.getByRole("combobox", {
          name: "Current workspace region",
        }) as HTMLSelectElement
      ).value,
    ).toBe("left");
    expect(screen.getByRole("tab", { name: "Alpha" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Gamma" })).toBeNull();
    const canonicalRoot = runtime.getSnapshot().projection.rootNodeId;

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Current workspace region" }),
      "right",
    );
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Gamma" })).toBeTruthy();
    });
    expect(runtime.getSnapshot().projection.rootNodeId).toBe(canonicalRoot);
    expect(runtime.transactions).toHaveLength(0);
    expect(
      (
        screen.getByRole("combobox", {
          name: "Current workspace region",
        }) as HTMLSelectElement
      ).value,
    ).toBe("right");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("keeps every available panel and container action in the ellipsis menu", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime, { commands: directManipulationCommands });

    await user.click(await screen.findByRole("button", { name: "Actions for Alpha" }));

    expect(screen.getByRole("menuitem", { name: "Move Alpha tab after Beta" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Choose destination/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Split left" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Close Alpha" })).toBeTruthy();
    const moveContainer = screen.getByRole("menuitem", {
      name: "Move Left panel container",
    });
    expect(moveContainer).toBeTruthy();

    await user.click(moveContainer);
    expect(screen.getByRole("dialog", { name: "Move Left panel container" })).toBeTruthy();
  });

  it("provides arrow, boundary, and Escape behavior for panel action menus", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);
    const trigger = await screen.findByRole("button", { name: "Actions for Alpha" });

    await user.click(trigger);

    const items = screen.getAllByRole("menuitem");
    await waitFor(() => {
      expect(items[0]).toBe(document.activeElement);
    });

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toBe(document.activeElement);
    await user.keyboard("{End}");
    expect(items.at(-1)).toBe(document.activeElement);
    await user.keyboard("{Home}");
    expect(items[0]).toBe(document.activeElement);
    await user.keyboard("{ArrowUp}");
    expect(items.at(-1)).toBe(document.activeElement);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Alpha actions" })).toBeNull();
      expect(trigger).toBe(document.activeElement);
    });
  });

  it("dismisses panel action menus on outside focus and pointer interaction", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);
    const trigger = await screen.findByRole("button", { name: "Actions for Alpha" });
    const outside = screen.getByRole("tab", { name: "Gamma" });

    await user.click(trigger);
    outside.focus();
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Alpha actions" })).toBeNull();
      expect(outside).toBe(document.activeElement);
    });

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Alpha actions" })).toBeNull();
    });
  });

  it("uses a non-modal move dialog and restores its invoking trigger", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection);
    const announcements: string[] = [];
    renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onExternalPanelRequest: () => ({ status: "rejected" }),
      onAnnouncement: (message) => announcements.push(message),
    });
    let trigger = await screen.findByRole("button", { name: "Actions for Alpha" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /choose destination/i }));

    let dialog = screen.getByRole("dialog", { name: "Move Alpha" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    await waitFor(() => {
      expect(dialog).toBe(document.activeElement);
      expect(announcements).toEqual(["Left"]);
    });

    act(() => {
      runtime.publishProjection(runtime.getSnapshot().projection);
    });
    expect(announcements).toEqual(["Left"]);
    expect(runtime.transactions).toHaveLength(0);

    await user.keyboard("{Tab}");
    expect(announcements.at(-1)).toBe("Split left");
    expect(dialog).toBe(document.activeElement);
    expect(runtime.transactions).toHaveLength(0);

    await user.keyboard("{Tab}");
    expect(announcements.at(-1)).toBe("Open in new window");
    expect(dialog).toBe(document.activeElement);
    expect(runtime.transactions).toHaveLength(0);

    await user.keyboard("{Tab}");
    expect(announcements.at(-1)).toBe("Left");
    expect(dialog).toBe(document.activeElement);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(announcements.at(-1)).toBe("Open in new window");
    expect(dialog).toBe(document.activeElement);
    expect(runtime.transactions).toHaveLength(0);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(announcements.at(-1)).toBe("Split left");
    expect(dialog).toBe(document.activeElement);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(announcements.at(-1)).toBe("Left");
    expect(dialog).toBe(document.activeElement);
    expect(runtime.transactions).toHaveLength(0);

    await user.keyboard("{ArrowDown}");
    expect(announcements.at(-1)).toBe("Right");
    expect(runtime.transactions).toHaveLength(0);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Move Alpha" })).toBeNull();
      expect(trigger).toBe(document.activeElement);
    });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /choose destination/i }));
    dialog = screen.getByRole("dialog", { name: "Move Alpha" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Move Alpha" })).toBeNull();
      trigger = screen.getByRole("button", { name: "Actions for Alpha" });
      expect(trigger).toBe(document.activeElement);
    });
    expect(runtime.getSnapshot().projection.groups.right?.panelIds).toContain("alpha");
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");
  });

  it("preserves a stable host through selection changes and a panel move", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);

    const input = (await screen.findByRole("textbox", {
      name: "Alpha value",
    })) as HTMLInputElement;
    const host = input.closest("[data-workspace-panel-host]");
    await userEvent.clear(input);
    await userEvent.type(input, "local draft survives");

    await userEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(runtime.transactions.at(-1)?.origin).toBe("pointer");
    await userEvent.click(screen.getByRole("tab", { name: "Alpha" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Alpha value" })).toBe(input);
    });
    expect(input.value).toBe("local draft survives");
    expect(input.closest("[data-workspace-panel-host]")).toBe(host);

    runtime.dispatch(
      { type: "move", panelId: "alpha", groupId: "right" },
      { origin: "application", label: "Move Alpha to Right" },
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Alpha value" })).toBe(input);
    });
    expect(input.value).toBe("local draft survives");
    expect(input.closest("[data-workspace-panel-host]")).toBe(host);
  });

  it("aborts each lifecycle lease before delivering its replacement", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const events: string[] = [];
    const abortCounts = new Map<AbortSignal, number>();
    const lifecycleRegistry: WorkspacePanelRegistry = {
      fixture: {
        render: panels.fixture?.render ?? (() => null),
        onLifecycleChange: (change) => {
          if (change.panelId !== "alpha") return;
          events.push(`callback:${change.reason}:${change.current}:${change.signal.aborted}`);
          change.signal.addEventListener(
            "abort",
            () => {
              abortCounts.set(change.signal, (abortCounts.get(change.signal) ?? 0) + 1);
              events.push(`abort:${change.current}`);
              expect(change.signal.reason).toMatchObject({
                kind: "panefold-panel-lifecycle-ended",
                panelId: "alpha",
              });
            },
            { once: true },
          );
        },
      },
    };
    const view = renderWorkspace(runtime, { registry: lifecycleRegistry });
    await waitFor(() => {
      expect(events).toContain("callback:mount:active:false");
    });

    await userEvent.click(screen.getByRole("tab", { name: "Beta" }));
    await userEvent.click(screen.getByRole("tab", { name: "Alpha" }));
    act(() => {
      runtime.dispatch(
        { type: "move", panelId: "alpha", groupId: "right" },
        { origin: "application", label: "Move Alpha" },
      );
    });
    await waitFor(() => {
      expect(events).toContain("callback:same-document-move:active:false");
    });

    expect(events).toEqual([
      "callback:mount:active:false",
      "abort:active",
      "callback:selection:suspended:false",
      "abort:suspended",
      "callback:selection:active:false",
      "abort:active",
      "callback:same-document-move:active:false",
    ]);
    view.unmount();
    expect(events.at(-1)).toBe("abort:active");
    expect([...abortCounts.values()].every((count) => count === 1)).toBe(true);
    expect(abortCounts.size).toBe(4);
  });

  it("keeps heavy-content fixtures mounted while cooperatively suspending hidden panels", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection);
    const mounts = new Map<string, number>();
    const unmounts = new Map<string, number>();
    const transitions: string[] = [];

    function HeavyFixture({ panel: item, lifecycle }: WorkspacePanelRenderProps) {
      const mountIdentity = useRef({ panelId: item.id });
      useEffect(() => {
        mounts.set(item.id, (mounts.get(item.id) ?? 0) + 1);
        return () => {
          unmounts.set(item.id, (unmounts.get(item.id) ?? 0) + 1);
        };
      }, [item.id]);

      return (
        <div data-heavy-fixture={mountIdentity.current.panelId} data-fixture-lifecycle={lifecycle}>
          <label>
            Editor for {item.title}
            <textarea defaultValue={`draft:${item.id}`} />
          </label>
          <svg role="img" aria-label={`Map for ${item.title}`} data-map-fixture="true" />
          <table data-grid-fixture="true">
            <caption>Grid for {item.title}</caption>
            <tbody>
              <tr>
                <td>row</td>
              </tr>
            </tbody>
          </table>
          <video aria-label={`Media for ${item.title}`} preload="none" data-media-fixture="true" />
          <iframe
            title={`Frame for ${item.title}`}
            srcDoc="<!doctype html><p>isolated fixture</p>"
            sandbox=""
            data-iframe-fixture="true"
          />
          <div data-microfrontend-fixture="true">Microfrontend fixture</div>
        </div>
      );
    }

    const lifecycleRegistry: WorkspacePanelRegistry = {
      fixture: {
        render: HeavyFixture,
        onLifecycleChange: ({ panelId, previous, current }) => {
          transitions.push(`${panelId}:${previous ?? "mount"}->${current}`);
        },
      },
    };
    const view = renderWorkspace(runtime, { registry: lifecycleRegistry });

    const alphaEditor = (await screen.findByLabelText("Editor for Alpha")) as HTMLTextAreaElement;
    const alphaHost = alphaEditor.closest<HTMLElement>("[data-workspace-panel-host]");
    const alphaMap = alphaHost?.querySelector("[data-map-fixture]");
    const alphaGrid = alphaHost?.querySelector("[data-grid-fixture]");
    const alphaMedia = alphaHost?.querySelector("[data-media-fixture]");
    const alphaFrame = alphaHost?.querySelector("[data-iframe-fixture]");
    const alphaMicrofrontend = alphaHost?.querySelector("[data-microfrontend-fixture]");
    expect(alphaHost).toBeTruthy();

    await waitFor(() => {
      expect(mounts.get("alpha")).toBe(1);
      expect(mounts.get("beta")).toBe(1);
      expect(mounts.get("gamma")).toBe(1);
    });

    await user.clear(alphaEditor);
    await user.type(alphaEditor, "unsaved heavy-content state");
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await user.click(screen.getByRole("tab", { name: "Beta" }));
      await waitFor(() => {
        expect(alphaHost?.dataset.lifecycle).toBe("suspended");
        expect(alphaHost?.hidden).toBe(true);
        expect(alphaHost?.inert).toBe(true);
      });
      await user.click(screen.getByRole("tab", { name: "Alpha" }));
    }

    runtime.dispatch(
      { type: "move", panelId: "alpha", groupId: "right" },
      { origin: "application", label: "Move Alpha to Right" },
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Editor for Alpha")).toBe(alphaEditor);
      expect(alphaHost?.parentElement?.dataset.workspacePanelSlot).toBe("right");
    });
    expect(alphaEditor.value).toBe("unsaved heavy-content state");
    expect(alphaHost?.querySelector("[data-map-fixture]")).toBe(alphaMap);
    expect(alphaHost?.querySelector("[data-grid-fixture]")).toBe(alphaGrid);
    expect(alphaHost?.querySelector("[data-media-fixture]")).toBe(alphaMedia);
    expect(alphaHost?.querySelector("[data-iframe-fixture]")).toBe(alphaFrame);
    expect(alphaHost?.querySelector("[data-microfrontend-fixture]")).toBe(alphaMicrofrontend);
    expect(mounts.get("alpha")).toBe(1);
    expect(unmounts.get("alpha")).toBeUndefined();
    expect(transitions).toContain("alpha:mount->active");
    expect(transitions).toContain("alpha:active->suspended");
    expect(transitions).toContain("alpha:suspended->active");

    view.unmount();
    expect(unmounts.get("alpha")).toBe(1);
    expect(unmounts.get("beta")).toBe(1);
    expect(unmounts.get("gamma")).toBe(1);
  });

  it("drags a tab to another group through one revision-bound drop command", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, { commands: directManipulationCommands });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, {
      button: 0,
      pointerId: 41,
      pointerType: "mouse",
      clientX: 100,
      clientY: 20,
      screenX: 120,
      screenY: 40,
    });
    fireEvent.pointerMove(alpha, {
      pointerId: 41,
      pointerType: "mouse",
      clientX: 750,
      clientY: 350,
      screenX: 770,
      screenY: 370,
    });

    const overlay = await waitForElement(view.container, "[data-workspace-panel-drag]");
    expect(overlay.dataset.workspaceDropKind).toBe("center");
    expect(overlay.dataset.workspaceDropTarget).toBe("center:right-node");

    fireEvent.pointerUp(alpha, {
      pointerId: 41,
      pointerType: "mouse",
      clientX: 750,
      clientY: 350,
      screenX: 770,
      screenY: 370,
    });

    expect(runtime.transactions).toHaveLength(1);
    expect(runtime.transactions[0]?.type).toBe("drop");
    expect(runtime.getSnapshot().projection.groups.right?.panelIds).toContain("alpha");
    expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
  });

  it("drags an intact panel container from accessible empty tab-strip space", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, { commands: directManipulationCommands });
    const handle = await screen.findByRole("button", { name: "Move Left panel container" });
    expect(handle.classList.contains("pf-group-drag-region")).toBe(true);
    expect(handle.textContent).toBe("");
    expect(handle.parentElement?.classList.contains("pf-tab-strip")).toBe(true);
    expect(handle.closest('[role="tablist"]')).toBeNull();
    installPointerCapture(handle);

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 141,
      pointerType: "mouse",
      clientX: 480,
      clientY: 20,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 141,
      pointerType: "mouse",
      clientX: 750,
      clientY: 350,
    });

    const overlay = await waitForElement(view.container, "[data-workspace-group-drag]");
    expect(overlay.dataset.workspaceDropKind).toBe("swap");
    expect(overlay.dataset.workspaceDropTarget).toBe("swap:right-node");

    fireEvent.pointerUp(handle, {
      pointerId: 141,
      pointerType: "mouse",
      clientX: 750,
      clientY: 350,
    });

    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "group-drop", origin: "pointer" }),
    ]);
    expect(runtime.lastCommand?.type).toBe("group-drop");
    if (runtime.lastCommand?.type === "group-drop") {
      expect(runtime.lastCommand.request.sourceGroup.id).toBe("left");
      expect(runtime.lastCommand.request.sourcePanels.map((panel) => panel.id)).toEqual([
        "alpha",
        "beta",
      ]);
      expect(runtime.lastCommand.request.target).toEqual({ kind: "swap" });
    }
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toEqual(["alpha", "beta"]);
    expect(runtime.getSnapshot().projection.nodes.root).toMatchObject({
      kind: "split",
      childIds: ["right-node", "left-node"],
    });
    expect(view.container.querySelector("[data-workspace-group-drag]")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Move Left panel container" })).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move Left panel container" })).toBe(
        document.activeElement,
      );
    });
  });

  it("moves a panel container from keyboard-accessible empty tab-strip space", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime, { commands: directManipulationCommands });
    const user = userEvent.setup();
    const handle = await screen.findByRole("button", { name: "Move Left panel container" });

    await user.click(handle);
    const dialog = screen.getByRole("dialog", { name: "Move Left panel container" });
    expect(dialog.textContent).toContain("Swap Left and Right panel containers");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog.textContent).toContain("Move Left below Right");
    await user.keyboard("{Tab}{Enter}");

    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "group-drop", origin: "keyboard" }),
    ]);
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toEqual(["alpha", "beta"]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move Left panel container" })).toBe(
        document.activeElement,
      );
    });
  });

  it("keeps pointer candidate hover silent and announces only the final drop result", async () => {
    const announcements: string[] = [];
    const frames = createManualFrameScheduler();
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      frameScheduler: frames.scheduler,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 42, clientX: 100, clientY: 20 });
    for (const position of [
      { clientX: 750, clientY: 350, kind: "center" },
      { clientX: 10, clientY: 350, kind: "edge" },
      { clientX: 1100, clientY: 350, kind: "external" },
      { clientX: 750, clientY: 350, kind: "center" },
    ] as const) {
      fireEvent.pointerMove(alpha, { pointerId: 42, ...position });
      act(() => frames.flush());
      expect(
        requiredElement(view.container.querySelector("[data-workspace-panel-drag]")).dataset
          .workspaceDropKind,
      ).toBe(position.kind);
      expect(announcements).toEqual([]);
    }

    fireEvent.pointerUp(alpha, { pointerId: 42, clientX: 750, clientY: 350 });

    expect(announcements).toEqual(["Moved Alpha to Right"]);
    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "drop", origin: "pointer" }),
    ]);
  });

  it("does not invalidate a selected inactive tab drag when pointerdown moves focus", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, { commands: directManipulationCommands });
    const gamma = await screen.findByRole("tab", { name: "Gamma" });
    installPointerCapture(gamma);

    fireEvent.pointerDown(gamma, {
      button: 0,
      pointerId: 43,
      pointerType: "mouse",
      clientX: 750,
      clientY: 20,
    });
    fireEvent.focus(gamma);
    expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("armed");
    expect(runtime.getSnapshot().projection.revision).toBe("0");
    expect(runtime.transactions).toHaveLength(0);

    fireEvent.pointerMove(gamma, {
      pointerId: 43,
      pointerType: "mouse",
      clientX: 250,
      clientY: 350,
    });
    expect(
      (await waitForElement(view.container, "[data-workspace-panel-drag]")).dataset
        .workspaceDropTarget,
    ).toBe("center:left-node");
    fireEvent.pointerUp(gamma, {
      pointerId: 43,
      pointerType: "mouse",
      clientX: 250,
      clientY: 350,
    });

    expect(runtime.transactions.map((transaction) => transaction.type)).toEqual(["drop"]);
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toContain("gamma");
  });

  it("reorders tabs in one command without remounting content and coalesces raw drag samples", async () => {
    const renderCounts = new Map<string, number>();
    const mounts = new Map<string, number>();
    let reorderCommandCreations = 0;
    let groupProjectionRenders = 0;
    const ReorderStatePanel = ({ item }: { readonly item: WorkspacePanelRenderProps["panel"] }) => {
      renderCounts.set(item.id, (renderCounts.get(item.id) ?? 0) + 1);
      useEffect(() => {
        mounts.set(item.id, (mounts.get(item.id) ?? 0) + 1);
      }, [item.id]);
      return <input aria-label={`${item.title} reorder state`} defaultValue={item.title} />;
    };
    const registry: WorkspacePanelRegistry = {
      fixture: {
        render: ({ panel: item }) => <ReorderStatePanel item={item} />,
      },
    };
    const reorderCommands: WorkspaceCommandAdapter<FixtureCommand> = {
      ...directManipulationCommands,
      reorderPanel: (panelId, groupId, placement) => {
        reorderCommandCreations += 1;
        return { type: "reorder", panelId, groupId, ...placement };
      },
    };
    const frames = createManualFrameScheduler();
    const projectionWithValuePanels: WorkspaceProjection = {
      ...initialProjection,
      panels: Object.fromEntries(
        Object.entries(initialProjection.panels).map(([panelId, panelView]) => [
          panelId,
          {
            ...panelView,
            parameters: Object.freeze({ panelId }),
            lifecyclePolicy: {
              hidden: "suspend" as const,
              sameDocumentMove: "preserve-host" as const,
              crossDocumentMove: "unsupported" as const,
            },
          },
        ]),
      ),
    };
    const runtime = new FixtureRuntime(projectionWithValuePanels, undefined, {
      recreatePanelViews: true,
    });
    const popupDocument = document.implementation.createHTMLDocument("Reordered panel popup");
    const view = renderWorkspace(runtime, {
      registry,
      commands: reorderCommands,
      frameScheduler: frames.scheduler,
      onExternalPanelRequest: (request) => {
        popupDocument.body.append(request.host);
        return { status: "committed" };
      },
      tabPresentation: () => {
        groupProjectionRenders += 1;
        return { placement: "block-start", content: "icon-and-label" };
      },
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const tablist = screen.getByRole("tablist", { name: "Left" });
    setElementRect(tablist, { left: 0, top: 0, width: 300, height: 34 });
    setElementRect(alpha, { left: 0, top: 0, width: 120, height: 34 });
    setElementRect(beta, { left: 120, top: 0, width: 180, height: 34 });
    installPointerCapture(beta);
    const alphaHost = requiredElement(
      view.container.querySelector('[data-workspace-panel-host="alpha"]'),
    );
    const betaHost = requiredElement(
      view.container.querySelector('[data-workspace-panel-host="beta"]'),
    );
    const gammaHost = requiredElement(
      view.container.querySelector('[data-workspace-panel-host="gamma"]'),
    );
    const hostWriteTrackers = [alphaHost, betaHost, gammaHost].map(trackStableHostWrites);
    const hostDestinations = new Set(
      [alphaHost, betaHost, gammaHost].map((host) => {
        if (host.parentElement === null) throw new Error("Expected a stable host destination");
        return host.parentElement;
      }),
    );
    const hostAppendSpies = Array.from(hostDestinations, (destination) =>
      vi.spyOn(destination, "append"),
    );
    const stableHostWriteCount = () =>
      hostWriteTrackers.reduce((total, tracker) => total + tracker.count(), 0);
    const stableHostAppendCount = () =>
      hostAppendSpies.reduce((total, spy) => total + spy.mock.calls.length, 0);
    const hostsBeforeCommit = new Map(
      ["alpha", "beta", "gamma"].map((panelId) => [
        panelId,
        view.container.querySelector(`[data-workspace-panel-host="${panelId}"]`),
      ]),
    );
    const betaEditor = screen.getByLabelText<HTMLInputElement>("Beta reorder state");
    betaEditor.value = "local state survives";
    const projectionsBeforeDrag = groupProjectionRenders;

    fireEvent.pointerDown(beta, {
      button: 0,
      pointerId: 47,
      pointerType: "mouse",
      clientX: 210,
      clientY: 17,
    });
    fireEvent.pointerMove(beta, {
      pointerId: 47,
      pointerType: "mouse",
      clientX: 20,
      clientY: 17,
    });
    expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
    expect(frames.hasPending()).toBe(true);
    expect(protocolActorInventory.drag.pointerMoves).toBe(0);
    act(() => frames.flush());
    expect(protocolActorInventory.drag.pointerMoves).toBe(1);
    expect(groupProjectionRenders).toBe(projectionsBeforeDrag);
    const overlay = requiredElement(view.container.querySelector("[data-workspace-panel-drag]"));
    expect(overlay.dataset.workspaceDropKind).toBe("reorder");
    expect(overlay.dataset.workspaceDropTarget).toBe("reorder:left:before:alpha");
    expect(view.container.querySelector("[data-workspace-tab-reorder-indicator]")).toBeTruthy();
    const rendersAfterOverlayMount = new Map(renderCounts);
    const projectionsAfterOverlayMount = groupProjectionRenders;

    for (let clientX = 21; clientX < 51; clientX += 1) {
      fireEvent.pointerMove(beta, {
        pointerId: 47,
        pointerType: "mouse",
        clientX,
        clientY: 17,
      });
    }
    expect(frames.hasPending()).toBe(true);
    expect(protocolActorInventory.drag.pointerMoves).toBe(1);
    act(() => frames.flush());
    expect(protocolActorInventory.drag.pointerMoves).toBe(2);
    expect(renderCounts).toEqual(rendersAfterOverlayMount);
    expect(groupProjectionRenders).toBe(projectionsAfterOverlayMount);
    expect(runtime.transactions).toHaveLength(0);
    expect(reorderCommandCreations).toBe(0);
    const rendersBeforeCommit = new Map(renderCounts);
    const panelsBeforeCommit = runtime.getSnapshot().projection.panels;

    fireEvent.pointerUp(beta, {
      pointerId: 47,
      pointerType: "mouse",
      clientX: 20,
      clientY: 17,
    });

    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "reorder", origin: "pointer" }),
    ]);
    expect(reorderCommandCreations).toBe(1);
    expect(protocolActorInventory.drag.pointerMoves).toBe(3);
    expect(protocolActorInventory.drag.active).toBe(0);
    expect(runtime.getSnapshot().projection.revision).toBe("1");
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toEqual(["beta", "alpha"]);
    expect(runtime.getSnapshot().projection.panels).not.toBe(panelsBeforeCommit);
    for (const panelId of Object.keys(panelsBeforeCommit)) {
      const previousPanel = panelsBeforeCommit[panelId];
      const nextPanel = runtime.getSnapshot().projection.panels[panelId];
      expect(nextPanel).not.toBe(previousPanel);
      expect(nextPanel?.parameters).toBe(previousPanel?.parameters);
      expect(nextPanel?.lifecyclePolicy).not.toBe(previousPanel?.lifecyclePolicy);
      expect(nextPanel?.lifecyclePolicy).toEqual(previousPanel?.lifecyclePolicy);
    }
    expect(view.container.querySelector('[data-workspace-panel-host="beta"]')).toBe(betaHost);
    for (const [panelId, host] of hostsBeforeCommit) {
      expect(view.container.querySelector(`[data-workspace-panel-host="${panelId}"]`)).toBe(host);
    }
    expect(screen.getByLabelText<HTMLInputElement>("Beta reorder state")).toBe(betaEditor);
    expect(betaEditor.value).toBe("local state survives");
    expect(renderCounts).toEqual(rendersBeforeCommit);
    expect(stableHostAppendCount()).toBe(0);
    expect(stableHostWriteCount()).toBe(0);
    expect(mounts).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 1],
        ["gamma", 1],
      ]),
    );

    for (const tracker of hostWriteTrackers) tracker.reset();
    for (const spy of hostAppendSpies) spy.mockClear();
    act(() => {
      runtime.dispatch(
        { type: "select", panelId: "beta" },
        { origin: "application", label: "Select Beta" },
      );
    });
    expect(alphaHost.hidden).toBe(true);
    expect(betaHost.hidden).toBe(false);
    expect(stableHostAppendCount()).toBeGreaterThan(0);
    expect(stableHostWriteCount()).toBeGreaterThan(0);

    for (const tracker of hostWriteTrackers) tracker.reset();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Beta" }));
    await user.click(screen.getByRole("menuitem", { name: "Open in new window" }));
    await waitFor(() => {
      expect(betaHost.ownerDocument).toBe(popupDocument);
      expect(betaHost.getAttribute("aria-label")).toBe("Beta");
      expect(betaHost.getAttribute("aria-labelledby")).toBeNull();
    });
    expect(stableHostWriteCount()).toBeGreaterThan(0);

    const rendersBeforePanelChange = new Map(renderCounts);
    const current = runtime.getSnapshot().projection;
    const currentBeta = current.panels.beta;
    if (currentBeta === undefined) throw new Error("Expected Beta panel view");
    act(() => {
      runtime.publishProjection({
        ...current,
        revision: "3",
        panels: {
          ...current.panels,
          beta: {
            ...currentBeta,
            title: "Beta revised",
            parameters: Object.freeze({ panelId: "beta", version: 2 }),
          },
        },
      });
    });
    expect(renderCounts.get("beta")).toBe((rendersBeforePanelChange.get("beta") ?? 0) + 1);
    expect(renderCounts.get("alpha")).toBe(rendersBeforePanelChange.get("alpha"));
    expect(renderCounts.get("gamma")).toBe(rendersBeforePanelChange.get("gamma"));
    expect(betaEditor.getAttribute("aria-label")).toBe("Beta revised reorder state");
  });

  it("keeps the fixed reorder marker in viewport coordinates for an offset workspace", async () => {
    const frames = createManualFrameScheduler();
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      frameScheduler: frames.scheduler,
    });
    const workspace = screen.getByLabelText("Fixture workspace");
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const tablist = screen.getByRole("tablist", { name: "Left" });
    setElementRect(workspace, { left: 240, top: 160, width: 1000, height: 700 });
    setElementRect(tablist, { left: 240, top: 160, width: 300, height: 34 });
    setElementRect(alpha, { left: 240, top: 160, width: 120, height: 34 });
    setElementRect(beta, { left: 360, top: 160, width: 180, height: 34 });
    installPointerCapture(beta);

    fireEvent.pointerDown(beta, {
      button: 0,
      pointerId: 48,
      pointerType: "mouse",
      clientX: 450,
      clientY: 177,
    });
    fireEvent.pointerMove(beta, {
      pointerId: 48,
      pointerType: "mouse",
      clientX: 250,
      clientY: 177,
    });
    act(() => frames.flush());

    const indicator = requiredElement(
      view.container.querySelector("[data-workspace-tab-reorder-indicator]"),
    );
    expect(indicator.hidden).toBe(false);
    expect(indicator.style.getPropertyValue("--pf-drop-x")).toBe("238.5px");
    expect(indicator.style.getPropertyValue("--pf-drop-y")).toBe("164px");
    expect(indicator.style.getPropertyValue("--pf-drop-width")).toBe("3px");
    expect(indicator.style.getPropertyValue("--pf-drop-height")).toBe("26px");

    fireEvent.pointerCancel(beta, { pointerId: 48, pointerType: "mouse" });
  });

  it("autoscrolls only inside the tab strip and translates cached reorder geometry", async () => {
    const frames = createManualFrameScheduler();
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      frameScheduler: frames.scheduler,
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const tablist = screen.getByRole("tablist", { name: "Left" });
    const workspace = screen.getByLabelText("Fixture workspace");
    setElementRect(workspace, { left: 0, top: 0, width: 1000, height: 700 });
    setElementRect(tablist, { left: 0, top: 0, width: 200, height: 34 });
    setElementRect(alpha, { left: 0, top: 0, width: 100, height: 34 });
    setElementRect(beta, { left: 100, top: 0, width: 100, height: 34 });
    Object.defineProperties(tablist, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 500 },
    });
    tablist.scrollLeft = 0;
    let alphaMeasurements = 0;
    let betaMeasurements = 0;
    let rootMeasurements = 0;
    let stripMeasurements = 0;
    const measureAlpha = alpha.getBoundingClientRect.bind(alpha);
    const measureBeta = beta.getBoundingClientRect.bind(beta);
    alpha.getBoundingClientRect = () => {
      alphaMeasurements += 1;
      return measureAlpha();
    };
    beta.getBoundingClientRect = () => {
      betaMeasurements += 1;
      return measureBeta();
    };
    const measureRoot = workspace.getBoundingClientRect.bind(workspace);
    const measureStrip = tablist.getBoundingClientRect.bind(tablist);
    workspace.getBoundingClientRect = () => {
      rootMeasurements += 1;
      return measureRoot();
    };
    tablist.getBoundingClientRect = () => {
      stripMeasurements += 1;
      return measureStrip();
    };
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, {
      button: 0,
      pointerId: 49,
      pointerType: "mouse",
      clientX: 50,
      clientY: 17,
    });
    const measurementsAtDragStart = [
      alphaMeasurements,
      betaMeasurements,
      rootMeasurements,
      stripMeasurements,
    ];
    expect(measurementsAtDragStart).toEqual([1, 1, 1, 1]);
    fireEvent.pointerMove(alpha, {
      pointerId: 49,
      pointerType: "mouse",
      clientX: 195,
      clientY: 80,
    });
    act(() => frames.flush());
    expect(tablist.scrollLeft).toBe(0);

    fireEvent.pointerMove(alpha, {
      pointerId: 49,
      pointerType: "mouse",
      clientX: 160,
      clientY: 17,
    });
    act(() => frames.flush());
    const indicator = requiredElement(
      view.container.querySelector("[data-workspace-tab-reorder-indicator]"),
    );
    const indicatorBeforeScroll = indicator.style.getPropertyValue("--pf-drop-x");

    fireEvent.pointerMove(alpha, {
      pointerId: 49,
      pointerType: "mouse",
      clientX: 195,
      clientY: 17,
    });
    act(() => frames.flush());
    expect(tablist.scrollLeft).toBeGreaterThan(0);
    expect(indicator.style.getPropertyValue("--pf-drop-x")).not.toBe(indicatorBeforeScroll);
    expect([alphaMeasurements, betaMeasurements, rootMeasurements, stripMeasurements]).toEqual(
      measurementsAtDragStart,
    );

    fireEvent.pointerUp(alpha, {
      pointerId: 49,
      pointerType: "mouse",
      clientX: 195,
      clientY: 17,
    });
    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "reorder", origin: "pointer" }),
    ]);
    expect([alphaMeasurements, betaMeasurements, rootMeasurements, stripMeasurements]).toEqual([
      2, 2, 1, 2,
    ]);
  });

  it("repaints and commits the translated reorder target after manual tab-strip scroll", async () => {
    const frames = createManualFrameScheduler();
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      frameScheduler: frames.scheduler,
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const tablist = screen.getByRole("tablist", { name: "Left" });
    setElementRect(tablist, { left: 0, top: 0, width: 200, height: 34 });
    setElementRect(alpha, { left: 0, top: 0, width: 100, height: 34 });
    setElementRect(beta, { left: 100, top: 0, width: 100, height: 34 });
    Object.defineProperties(tablist, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 500 },
    });
    tablist.scrollLeft = 0;
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, {
      button: 0,
      pointerId: 50,
      pointerType: "mouse",
      clientX: 50,
      clientY: 17,
    });
    fireEvent.pointerMove(alpha, {
      pointerId: 50,
      pointerType: "mouse",
      clientX: 100,
      clientY: 17,
    });
    act(() => frames.flush());
    const overlay = requiredElement(view.container.querySelector("[data-workspace-panel-drag]"));
    const indicator = requiredElement(
      view.container.querySelector("[data-workspace-tab-reorder-indicator]"),
    );
    expect(overlay.dataset.workspaceDropTarget).toBe("reorder:left:before:beta");
    const indicatorBeforeScroll = indicator.style.getPropertyValue("--pf-drop-x");

    tablist.scrollLeft = 20;
    fireEvent.scroll(tablist);
    expect(frames.hasPending()).toBe(true);
    act(() => frames.flush());

    expect(overlay.dataset.workspaceDropTarget).toBe("reorder:left:before:beta");
    expect(indicator.style.getPropertyValue("--pf-drop-x")).not.toBe(indicatorBeforeScroll);
    const indicatorAfterSameSlotScroll = indicator.style.getPropertyValue("--pf-drop-x");

    tablist.scrollLeft = 80;
    fireEvent.scroll(tablist);
    act(() => frames.flush());

    expect(overlay.dataset.workspaceDropTarget).toBe("reorder:left:append");
    expect(indicator.style.getPropertyValue("--pf-drop-x")).not.toBe(indicatorAfterSameSlotScroll);
    expect(runtime.transactions).toHaveLength(0);

    fireEvent.pointerUp(alpha, {
      pointerId: 50,
      pointerType: "mouse",
      clientX: 100,
      clientY: 17,
    });

    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "reorder", origin: "pointer" }),
    ]);
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toEqual(["beta", "alpha"]);
  });

  it("cancels active reorder geometry when an observed inner tab resizes", async () => {
    const resizeObservers = installControllableResizeObserver();
    try {
      const announcements: string[] = [];
      const frames = createManualFrameScheduler();
      const runtime = new FixtureRuntime(initialProjection);
      const view = renderWorkspace(runtime, {
        commands: directManipulationCommands,
        frameScheduler: frames.scheduler,
        onAnnouncement: (message) => announcements.push(message),
      });
      const alpha = await screen.findByRole("tab", { name: "Alpha" });
      const beta = screen.getByRole("tab", { name: "Beta" });
      const tablist = screen.getByRole("tablist", { name: "Left" });
      setElementRect(tablist, { left: 0, top: 0, width: 300, height: 34 });
      setElementRect(alpha, { left: 0, top: 0, width: 120, height: 34 });
      setElementRect(beta, { left: 120, top: 0, width: 180, height: 34 });
      installPointerCapture(beta);

      fireEvent.pointerDown(beta, {
        button: 0,
        pointerId: 51,
        pointerType: "mouse",
        clientX: 210,
        clientY: 17,
      });
      fireEvent.pointerMove(beta, {
        pointerId: 51,
        pointerType: "mouse",
        clientX: 20,
        clientY: 17,
      });
      act(() => frames.flush());
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeTruthy();
      const tabObserver = resizeObservers.instances.find((observer) => observer.hasObserved(alpha));
      if (tabObserver === undefined) throw new Error("Expected an active tab ResizeObserver");

      setElementRect(alpha, { left: 0, top: 0, width: 180, height: 34 });
      act(() => tabObserver.notify());
      await act(async () => Promise.resolve());

      expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
      expect(protocolActorInventory.drag.active).toBe(0);
      expect(runtime.transactions).toHaveLength(0);
      expect(announcements).toEqual(["The workspace changed before the panel could be moved."]);
      expect(document.activeElement).toBe(beta);
    } finally {
      resizeObservers.restore();
    }
  });

  it("synchronously rejects stale inner tab geometry at pointer release", async () => {
    const announcements: string[] = [];
    const frames = createManualFrameScheduler();
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      frameScheduler: frames.scheduler,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const tablist = screen.getByRole("tablist", { name: "Left" });
    setElementRect(tablist, { left: 0, top: 0, width: 300, height: 34 });
    setElementRect(alpha, { left: 0, top: 0, width: 120, height: 34 });
    setElementRect(beta, { left: 120, top: 0, width: 180, height: 34 });
    installPointerCapture(beta);

    fireEvent.pointerDown(beta, {
      button: 0,
      pointerId: 52,
      pointerType: "mouse",
      clientX: 210,
      clientY: 17,
    });
    fireEvent.pointerMove(beta, {
      pointerId: 52,
      pointerType: "mouse",
      clientX: 20,
      clientY: 17,
    });
    act(() => frames.flush());
    expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeTruthy();

    setElementRect(alpha, { left: 0, top: 0, width: 180, height: 34 });
    fireEvent.pointerUp(beta, {
      pointerId: 52,
      pointerType: "mouse",
      clientX: 20,
      clientY: 17,
    });
    await act(async () => Promise.resolve());

    expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
    expect(protocolActorInventory.drag.active).toBe(0);
    expect(runtime.transactions).toHaveLength(0);
    expect(announcements).toEqual(["The workspace changed before the panel could be moved."]);
    expect(document.activeElement).toBe(beta);
  });

  it("cancels cached physical drag geometry on an owner-window resize", async () => {
    const announcements: string[] = [];
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);
    fireEvent.pointerDown(alpha, { button: 0, pointerId: 50, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 50, clientX: 750, clientY: 350 });
    await waitForElement(view.container, "[data-workspace-panel-drag]");

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
      expect(protocolActorInventory.drag.active).toBe(0);
    });
    expect(announcements).toEqual(["The workspace changed before the panel could be moved."]);
    expect(runtime.transactions).toHaveLength(0);
  });

  it("offers neighbor tab reorder through keyboard and menu routes", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime, { commands: directManipulationCommands });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    alpha.focus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toEqual(["beta", "alpha"]);
    expect(runtime.transactions.at(-1)).toMatchObject({ type: "reorder", origin: "keyboard" });

    await userEvent.click(screen.getByRole("button", { name: "Actions for Alpha" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move Alpha tab before Beta" }));
    expect(runtime.getSnapshot().projection.groups.left?.panelIds).toEqual(["alpha", "beta"]);
    expect(runtime.transactions.at(-1)).toMatchObject({ type: "reorder", origin: "menu" });
  });

  it("keeps inactive-group menu reorder to one history entry while restoring tab focus", async () => {
    const delta = panel("delta", "Delta");
    const projection: WorkspaceProjection = {
      ...initialProjection,
      groups: {
        ...initialProjection.groups,
        right: {
          id: "right",
          panelIds: ["gamma", "delta"],
          selectedPanelId: "gamma",
          label: "Right",
        },
      },
      panels: { ...initialProjection.panels, delta },
      activePanelId: "alpha",
    };
    const announcements: string[] = [];
    const runtime = new FixtureRuntime(projection);
    renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Actions for Gamma" }));
    await user.click(screen.getByRole("menuitem", { name: "Move Gamma tab after Delta" }));
    await act(async () => Promise.resolve());

    expect(runtime.getSnapshot().projection.groups.right?.panelIds).toEqual(["delta", "gamma"]);
    expect(runtime.getSnapshot().projection.activePanelId).toBe("alpha");
    expect(runtime.transactions).toEqual([
      expect.objectContaining({ type: "reorder", origin: "menu" }),
    ]);
    expect(announcements).toEqual(["Moved Gamma tab after Delta"]);
    expect(screen.getByRole("tab", { name: "Gamma" })).toBe(document.activeElement);
  });

  it("keeps a retained empty group visible, accessible, and available to pointer and keyboard moves", async () => {
    const root = initialProjection.nodes.root;
    const right = initialProjection.groups.right;
    if (root?.kind !== "split" || right === undefined)
      throw new Error("Missing empty-group fixture");
    const projection: WorkspaceProjection = {
      ...initialProjection,
      nodes: {
        ...initialProjection.nodes,
        root: { ...root, weights: [1000, 1] },
      },
      groups: {
        ...initialProjection.groups,
        right: { ...right, panelIds: [], selectedPanelId: "" },
      },
    };
    const runtime = new FixtureRuntime(projection);
    const view = renderWorkspace(runtime, { commands: directManipulationCommands });
    const emptyGroup = requiredElement(
      view.container.querySelector('[data-workspace-group="right"]'),
    );
    const placeholder = await screen.findByRole("note");

    expect(emptyGroup.dataset.empty).toBe("true");
    expect(emptyGroup.getAttribute("aria-describedby")).toBe(placeholder.id);
    expect(placeholder.textContent).toMatch(/Right is empty.*move destination/i);
    expect(emptyGroup.style.getPropertyValue("--pf-empty-group-inline-size")).toBe("96px");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Alpha" }));
    expect(screen.getByRole("menuitem", { name: "Move to Right" })).toBeTruthy();
    await user.keyboard("{Escape}");

    const alpha = screen.getByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);
    fireEvent.pointerDown(alpha, {
      button: 0,
      pointerId: 45,
      pointerType: "mouse",
      clientX: 100,
      clientY: 20,
    });
    // The solved right group is a one-pixel sliver. Its view-only acquisition
    // target expands inward to 96px, so this point can still redock Alpha.
    fireEvent.pointerMove(alpha, {
      pointerId: 45,
      pointerType: "mouse",
      clientX: 950,
      clientY: 350,
    });
    const overlay = await waitForElement(view.container, "[data-workspace-panel-drag]");
    expect(overlay.dataset.workspaceDropKind).toBe("center");
    expect(overlay.dataset.workspaceDropTarget).toBe("center:right-node");
    fireEvent.pointerUp(alpha, {
      pointerId: 45,
      pointerType: "mouse",
      clientX: 950,
      clientY: 350,
    });

    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-workspace-group="right"] [data-workspace-panel-tab="alpha"]',
        ),
      ).toBeTruthy();
      expect(view.container.querySelector('[data-workspace-empty-group="right"]')).toBeNull();
    });
    expect(runtime.transactions.at(-1)?.type).toBe("drop");
  });

  it("keeps drag actor pointer ownership and cancels without dispatch", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, { commands: directManipulationCommands });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 51, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 52, clientX: 750, clientY: 350 });
    fireEvent.pointerUp(alpha, { pointerId: 52, clientX: 750, clientY: 350 });
    expect(runtime.transactions).toHaveLength(0);
    expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();

    fireEvent.pointerMove(alpha, { pointerId: 51, clientX: 750, clientY: 350 });
    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeTruthy();
    });
    fireEvent.pointerCancel(alpha, { pointerId: 51, clientX: 750, clientY: 350 });

    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
      expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
    });
    expect(runtime.transactions).toHaveLength(0);
  });

  it("cancels a projected drop when the workspace revision changes mid-drag", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const announcements: string[] = [];
    const view = renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);
    fireEvent.pointerDown(alpha, { button: 0, pointerId: 55, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 55, clientX: 750, clientY: 350 });
    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeTruthy();
    });

    act(() => {
      runtime.dispatch(
        { type: "select", panelId: "beta" },
        { origin: "application", label: "Concurrent selection" },
      );
    });
    fireEvent.pointerUp(alpha, { pointerId: 55, clientX: 750, clientY: 350 });

    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
    });
    expect(runtime.transactions.map((transaction) => transaction.type)).toEqual(["select"]);
    expect(announcements.at(-1)).toMatch(/workspace changed/i);
  });

  it("cancels retained drop plans when direction or layout bounds change mid-drag", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const announcements: string[] = [];
    const surface = (direction: "ltr" | "rtl", inlineSize: number) => (
      <WorkspaceRuntimeProvider runtime={runtime}>
        <div style={{ width: inlineSize, height: 700 }}>
          <WorkspaceSurface
            projector={(snapshot: FixtureSnapshot) => snapshot.projection}
            commands={directManipulationCommands}
            panels={panels}
            direction={direction}
            layoutBounds={{ inlineStart: 0, blockStart: 0, inlineSize, blockSize: 700 }}
            workspaceLabel="Geometry epoch fixture"
            onAnnouncement={(message) => announcements.push(message)}
          />
        </div>
      </WorkspaceRuntimeProvider>
    );
    const view = render(surface("ltr", 1000));
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 56, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 56, clientX: 750, clientY: 350 });
    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeTruthy();
    });
    view.rerender(surface("rtl", 1000));
    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
    });
    fireEvent.pointerUp(alpha, { pointerId: 56, clientX: 750, clientY: 350 });
    expect(runtime.transactions).toHaveLength(0);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 57, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 57, clientX: 700, clientY: 350 });
    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeTruthy();
    });
    view.rerender(surface("rtl", 900));
    await waitFor(() => {
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
    });
    fireEvent.pointerUp(alpha, { pointerId: 57, clientX: 700, clientY: 350 });

    expect(runtime.transactions).toHaveLength(0);
    expect(announcements.filter((message) => /workspace changed/i.test(message))).toHaveLength(2);
  });

  it("previews and dispatches a logical-edge split exactly once", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, { commands: directManipulationCommands });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 61, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 61, clientX: 10, clientY: 350 });
    const overlay = await waitForElement(view.container, "[data-workspace-panel-drag]");
    expect(overlay.dataset.workspaceDropKind).toBe("edge");
    expect(overlay.dataset.workspaceDropEdge).toBe("inline-start");
    expect(view.container.querySelector(".pf-panel-drop-preview:not([hidden])")).toBeTruthy();

    fireEvent.pointerUp(alpha, { pointerId: 61, clientX: 10, clientY: 350 });
    expect(runtime.transactions).toHaveLength(1);
    const command = runtime.lastCommand;
    expect(command?.type).toBe("drop");
    if (command?.type === "drop") {
      expect(command.request.revision).toBe("0");
      expect(command.request.target).toEqual({
        kind: "edge",
        edge: "inline-start",
        ratio: 0.5,
      });
      expect(command.request.targetNodeId).toBe("left-node");
      expect(command.request.sourcePanels.map((panel) => panel.id)).toEqual(["alpha", "beta"]);
    }
  });

  it.each([
    {
      boundary: "right in LTR",
      direction: "ltr" as const,
      clientX: 1000,
      clientY: 350,
      edge: "inline-end" as const,
    },
    {
      boundary: "left in RTL",
      direction: "rtl" as const,
      clientX: 0,
      clientY: 350,
      edge: "inline-end" as const,
    },
    {
      boundary: "bottom",
      direction: "ltr" as const,
      clientX: 750,
      clientY: 700,
      edge: "block-end" as const,
    },
  ])(
    "keeps the exact physical $boundary boundary available for an edge drop",
    async ({ direction, clientX, clientY, edge }) => {
      const runtime = new FixtureRuntime(initialProjection);
      const view = renderWorkspace(runtime, { commands: directManipulationCommands, direction });
      const alpha = await screen.findByRole("tab", { name: "Alpha" });
      installPointerCapture(alpha);

      fireEvent.pointerDown(alpha, { button: 0, pointerId: 62, clientX: 100, clientY: 20 });
      fireEvent.pointerMove(alpha, { pointerId: 62, clientX, clientY });
      const overlay = await waitForElement(view.container, "[data-workspace-panel-drag]");
      expect(overlay.dataset.workspaceDropKind).toBe("edge");
      expect(overlay.dataset.workspaceDropEdge).toBe(edge);
      expect(overlay.dataset.workspaceDropTarget).toBe(`edge:right-node:${edge}`);

      fireEvent.pointerUp(alpha, { pointerId: 62, clientX, clientY });
      expect(runtime.transactions).toHaveLength(1);
      const command = runtime.lastCommand;
      expect(command?.type).toBe("drop");
      if (command?.type === "drop") {
        expect(command.request.target).toEqual({ kind: "edge", edge, ratio: 0.5 });
      }
    },
  );

  it("falls back to an external target at an exact boundary without an internal drop plan", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      onExternalPanelRequest: () => ({ status: "rejected" }),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 63, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 63, clientX: 1000, clientY: 350 });
    const overlay = await waitForElement(view.container, "[data-workspace-panel-drag]");
    expect(overlay.dataset.workspaceDropKind).toBe("external");

    fireEvent.pointerCancel(alpha, { pointerId: 63, clientX: 1000, clientY: 350 });
  });

  it("commits the exact command retained by the application preview plan", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    let plannedCommand: FixtureCommand | undefined;
    const plannedCommands: WorkspaceCommandAdapter<FixtureCommand> = {
      ...commands,
      planPanelDrop: (request) => {
        const command = { type: "drop", request } as const;
        if (
          request.targetGroup.id === "left" &&
          request.target.kind === "edge" &&
          request.target.edge === "inline-start"
        ) {
          plannedCommand = command;
        }
        return {
          command,
          previewRect: {
            inlineStart: 0,
            blockStart: 0,
            inlineSize: 240,
            blockSize: 700,
          },
        };
      },
    };
    const view = renderWorkspace(runtime, { commands: plannedCommands });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 63, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 63, clientX: 10, clientY: 350 });
    const preview = requiredElement(view.container.querySelector(".pf-panel-drop-preview"));
    await waitFor(() => {
      expect(preview.style.getPropertyValue("--pf-drop-width")).toBe("240px");
    });
    expect(preview.style.getPropertyValue("--pf-drop-width")).toBe("240px");
    fireEvent.pointerUp(alpha, { pointerId: 63, clientX: 10, clientY: 350 });

    expect(runtime.lastCommand).toBe(plannedCommand);
  });

  it("treats an unavailable application plan as no destination and restores tab focus", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const announcements: string[] = [];
    const rejectingCommands: WorkspaceCommandAdapter<FixtureCommand> = {
      ...commands,
      planPanelDrop: () => undefined,
    };
    const view = renderWorkspace(runtime, {
      commands: rejectingCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);
    fireEvent.pointerDown(alpha, { button: 0, pointerId: 62, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 62, clientX: 10, clientY: 350 });
    fireEvent.pointerUp(alpha, { pointerId: 62, clientX: 10, clientY: 350 });

    await waitFor(() => {
      expect(alpha).toBe(document.activeElement);
      expect(view.container.querySelector("[data-workspace-panel-drag]")).toBeNull();
    });
    expect(runtime.transactions).toHaveLength(0);
    expect(announcements.at(-1)).toMatch(/no destination/i);
  });

  it("recovers from a throwing reorder command factory and permits the next drag", async () => {
    const announcements: string[] = [];
    const throwingCommands: WorkspaceCommandAdapter<FixtureCommand> = {
      ...directManipulationCommands,
      reorderPanel: () => {
        throw new Error("reorder factory exploded");
      },
    };
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime, {
      commands: throwingCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    const tablist = screen.getByRole("tablist", { name: "Left" });
    setElementRect(tablist, { left: 0, top: 0, width: 300, height: 34 });
    setElementRect(alpha, { left: 0, top: 0, width: 120, height: 34 });
    setElementRect(beta, { left: 120, top: 0, width: 180, height: 34 });
    installPointerCapture(beta);

    fireEvent.pointerDown(beta, { button: 0, pointerId: 64, clientX: 210, clientY: 17 });
    fireEvent.pointerUp(beta, { pointerId: 64, clientX: 20, clientY: 17 });
    await act(async () => Promise.resolve());

    expect(protocolActorInventory.drag).toMatchObject({ active: 0, stopped: 1 });
    expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
    expect(document.activeElement).toBe(beta);
    expect(announcements).toEqual(["The panel placement is no longer available."]);
    expect(runtime.transactions).toHaveLength(0);

    fireEvent.pointerDown(beta, { button: 0, pointerId: 65, clientX: 210, clientY: 17 });
    expect(protocolActorInventory.drag.active).toBe(1);
    fireEvent.pointerCancel(beta, { pointerId: 65, clientX: 210, clientY: 17 });
    expect(protocolActorInventory.drag.active).toBe(0);
  });

  it("bounds dispatch failures, restores focus, and disposes before the next drag", async () => {
    const announcements: string[] = [];
    const runtime = new FixtureRuntime(initialProjection);
    runtime.dispatch = () => {
      throw new Error(`dispatch exploded ${"x".repeat(1_000)}`);
    };
    renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const focus = vi.spyOn(alpha, "focus");
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 66, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(alpha, { pointerId: 66, clientX: 750, clientY: 350 });
    await act(async () => Promise.resolve());

    expect(protocolActorInventory.drag).toMatchObject({ active: 0, stopped: 1 });
    expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(alpha);
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toMatch(/^dispatch exploded/);
    expect(announcements[0]?.length).toBe(512);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 67, clientX: 100, clientY: 20 });
    expect(protocolActorInventory.drag.active).toBe(1);
    fireEvent.pointerCancel(alpha, { pointerId: 67, clientX: 100, clientY: 20 });
    expect(protocolActorInventory.drag.active).toBe(0);
  });

  it("disposes a committing actor when result interpretation throws", async () => {
    const announcements: string[] = [];
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime, {
      commands: directManipulationCommands,
      interpretResult: () => {
        throw new Error("result interpretation exploded");
      },
      onAnnouncement: (message) => announcements.push(message),
    });
    let alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, { button: 0, pointerId: 68, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(alpha, { pointerId: 68, clientX: 750, clientY: 350 });
    await act(async () => Promise.resolve());

    expect(protocolActorInventory.drag).toMatchObject({ active: 0, stopped: 1 });
    expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
    expect(announcements).toEqual(["result interpretation exploded"]);

    alpha = screen.getByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);
    fireEvent.pointerDown(alpha, { button: 0, pointerId: 69, clientX: 750, clientY: 20 });
    expect(protocolActorInventory.drag.active).toBe(1);
    fireEvent.pointerCancel(alpha, { pointerId: 69, clientX: 750, clientY: 20 });
    expect(protocolActorInventory.drag.active).toBe(0);
  });

  it("invokes external detach synchronously with stable host, parking, and pointer coordinates", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const popupDocument = document.implementation.createHTMLDocument("Panel popup");
    let received: Parameters<WorkspaceExternalPanelHandler>[0] | undefined;
    const handler: WorkspaceExternalPanelHandler = (request) => {
      received = request;
      popupDocument.body.append(request.host);
      return { status: "committed" };
    };
    const view = renderWorkspace(runtime, { onExternalPanelRequest: handler });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);

    fireEvent.pointerDown(alpha, {
      button: 0,
      pointerId: 71,
      pointerType: "pen",
      clientX: 100,
      clientY: 20,
      screenX: 140,
      screenY: 60,
    });
    fireEvent.pointerMove(alpha, {
      pointerId: 71,
      pointerType: "pen",
      clientX: 1100,
      clientY: 350,
      screenX: 1140,
      screenY: 390,
    });
    expect(
      (await waitForElement(view.container, "[data-workspace-panel-drag]")).dataset
        .workspaceDropKind,
    ).toBe("external");
    fireEvent.pointerUp(alpha, {
      pointerId: 71,
      pointerType: "pen",
      clientX: 1100,
      clientY: 350,
      screenX: 1140,
      screenY: 390,
    });

    // No promise turn is required: popup-sensitive work happened in pointerup.
    expect(received).toBeDefined();
    expect(received?.host.dataset.workspacePanelHost).toBe("alpha");
    expect(received?.parkingElement.dataset.workspaceLayer).toBe("stable-content");
    expect(received?.position).toEqual({
      clientX: 1100,
      clientY: 350,
      screenX: 1140,
      screenY: 390,
    });
    expect(received?.pointer).toEqual({ pointerId: 71, pointerType: "pen" });
    expect(received?.signal).toBeInstanceOf(AbortSignal);
    expect(received?.signal.aborted).toBe(false);
    expect(received?.host.ownerDocument).toBe(popupDocument);
    expect(received?.host.getAttribute("aria-labelledby")).toBeNull();
    expect(received?.host.getAttribute("aria-label")).toBe("Alpha");
    expect(received?.host.hidden).toBe(false);
    expect(runtime.transactions).toHaveLength(0);

    act(() => {
      runtime.dispatch(
        { type: "select", panelId: "beta" },
        { origin: "application", label: "Select Beta" },
      );
    });
    expect(received?.host.ownerDocument).toBe(popupDocument);
    if (received === undefined) throw new Error("Expected an external panel request");
    received.parkingElement.append(received.host);
    act(() => {
      runtime.dispatch(
        { type: "select", panelId: "alpha" },
        { origin: "application", label: "Return Alpha" },
      );
    });
    await waitFor(() => {
      expect(received?.host.ownerDocument).toBe(document);
      expect(received?.host.parentElement?.dataset.workspacePanelSlot).toBe("left");
      expect(received?.host.getAttribute("aria-labelledby")).toBe(alpha.id);
      expect(received?.host.getAttribute("aria-label")).toBeNull();
    });

    act(() => {
      received?.notifyReturnedToOwner("Alpha returned to the main window.");
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(alpha);
      expect(view.container.querySelector(".pf-live-region")?.textContent).toBe(
        "Alpha returned to the main window.",
      );
    });
  });

  it("owns an async external transfer actor until resolve or reject and then disposes it", async () => {
    const exercise = async (settlement: "resolve" | "reject", pointerId: number) => {
      let resolve: ((outcome: WorkspaceExternalPanelOutcome) => void) | undefined;
      let reject: ((cause: unknown) => void) | undefined;
      const pending = new Promise<WorkspaceExternalPanelOutcome>(
        (resolvePromise, rejectPromise) => {
          resolve = resolvePromise;
          reject = rejectPromise;
        },
      );
      const view = renderWorkspace(new FixtureRuntime(initialProjection), {
        onExternalPanelRequest: () => pending,
      });
      const alpha = await screen.findByRole("tab", { name: "Alpha" });
      installPointerCapture(alpha);

      fireEvent.pointerDown(alpha, {
        button: 0,
        pointerId,
        pointerType: "mouse",
        clientX: 100,
        clientY: 20,
      });
      fireEvent.pointerUp(alpha, {
        pointerId,
        pointerType: "mouse",
        clientX: 1100,
        clientY: 350,
      });

      expect(protocolActorInventory.drag.active).toBe(1);
      await act(async () => {
        if (settlement === "resolve") resolve?.({ status: "committed" });
        else reject?.(new Error("popup transfer failed"));
        await pending.catch(() => undefined);
      });
      await waitFor(() => {
        expect(protocolActorInventory.drag.active).toBe(0);
      });
      view.unmount();
    };

    await exercise("resolve", 72);
    await exercise("reject", 73);
    expect(protocolActorInventory.drag).toMatchObject({
      created: 2,
      started: 2,
      stopped: 2,
      active: 0,
    });
  });

  it("times out a pending pointer handoff, aborts it, and ignores late settlement", async () => {
    let resolvePending: ((outcome: WorkspaceExternalPanelOutcome) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const pending = new Promise<WorkspaceExternalPanelOutcome>((resolve) => {
      resolvePending = resolve;
    });
    const announcements: string[] = [];
    const view = renderWorkspace(new FixtureRuntime(initialProjection), {
      externalPanelRequestTimeoutMs: 25,
      onAnnouncement: (message) => announcements.push(message),
      onExternalPanelRequest: (request) => {
        receivedSignal = request.signal;
        return pending;
      },
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    const focus = vi.spyOn(alpha, "focus");
    installPointerCapture(alpha);

    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(alpha, { button: 0, pointerId: 74, clientX: 100, clientY: 20 });
      fireEvent.pointerUp(alpha, { pointerId: 74, clientX: 1100, clientY: 350 });

      expect(receivedSignal?.aborted).toBe(false);
      expect(protocolActorInventory.drag.active).toBe(1);
      await act(async () => {
        vi.advanceTimersByTime(25);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(receivedSignal?.aborted).toBe(true);
      expect(receivedSignal?.reason).toBe("timeout");
      expect(protocolActorInventory.drag).toMatchObject({ active: 0, stopped: 1 });
      expect(screen.getByLabelText("Fixture workspace").dataset.panelDragState).toBe("idle");
      expect(focus).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(alpha);
      expect(announcements).toEqual(["Could not open Alpha in a new window"]);

      resolvePending?.({ status: "committed", message: "late success must be ignored" });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(protocolActorInventory.drag).toMatchObject({ active: 0, stopped: 1 });
      expect(focus).toHaveBeenCalledTimes(1);
      expect(announcements).toEqual(["Could not open Alpha in a new window"]);
    } finally {
      vi.useRealTimers();
      view.unmount();
    }
  });

  it("aborts pending menu handoffs on unmount and suppresses their late outcome", async () => {
    let resolvePending: ((outcome: WorkspaceExternalPanelOutcome) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const pending = new Promise<WorkspaceExternalPanelOutcome>((resolve) => {
      resolvePending = resolve;
    });
    const announcements: string[] = [];
    const view = renderWorkspace(new FixtureRuntime(initialProjection), {
      onAnnouncement: (message) => announcements.push(message),
      onExternalPanelRequest: (request) => {
        receivedSignal = request.signal;
        return pending;
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Alpha" }));
    await user.click(screen.getByRole("menuitem", { name: "Open in new window" }));
    expect(receivedSignal?.aborted).toBe(false);

    view.unmount();

    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedSignal?.reason).toBe("surface-unmounted");
    resolvePending?.({ status: "committed", message: "late menu success" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(announcements).toEqual([]);
  });

  it("ignores a retained return callback after a synchronous handoff surface unmounts", async () => {
    const popupDocument = document.implementation.createHTMLDocument("Detached panel");
    let notifyReturned: ((message: string) => void) | undefined;
    let externalHost: HTMLElement | undefined;
    const announcements: string[] = [];
    const view = renderWorkspace(new FixtureRuntime(initialProjection), {
      onAnnouncement: (message) => announcements.push(message),
      onExternalPanelRequest: (request) => {
        externalHost = request.host;
        notifyReturned = request.notifyReturnedToOwner;
        popupDocument.body.append(request.host);
        return { status: "committed" };
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Alpha" }));
    await user.click(screen.getByRole("menuitem", { name: "Open in new window" }));
    if (externalHost === undefined || notifyReturned === undefined) {
      throw new Error("Expected a synchronous external handoff");
    }
    expect(externalHost.ownerDocument).toBe(popupDocument);
    const writes = trackStableHostWrites(externalHost);
    const announcementsBeforeUnmount = [...announcements];

    view.unmount();
    writes.reset();
    act(() => {
      notifyReturned?.("Late return must be ignored");
    });
    await act(async () => Promise.resolve());

    expect(writes.count()).toBe(0);
    expect(externalHost.ownerDocument).toBe(popupDocument);
    expect(announcements).toEqual(announcementsBeforeUnmount);
  });

  it("rejects invalid external request deadlines", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() =>
        renderWorkspace(new FixtureRuntime(initialProjection), {
          externalPanelRequestTimeoutMs: -1,
        }),
      ).toThrow(/externalPanelRequestTimeoutMs must be a non-negative safe integer/);
      expect(() =>
        renderWorkspace(new FixtureRuntime(initialProjection), {
          externalPanelRequestTimeoutMs: 1.5,
        }),
      ).toThrow(/externalPanelRequestTimeoutMs must be a non-negative safe integer/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("projects an adopted portal host as visible without inventing active semantics", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const popupDocument = document.implementation.createHTMLDocument("Panel popup");
    const alphaRenders: WorkspacePanelRenderProps[] = [];
    const registry: WorkspacePanelRegistry = {
      fixture: {
        render: (props) => {
          if (props.panel.id === "alpha") alphaRenders.push(props);
          return <span>{props.panel.title}</span>;
        },
      },
    };
    renderWorkspace(runtime, {
      registry,
      onExternalPanelRequest: (request) => {
        popupDocument.body.append(request.host);
        return { status: "committed" };
      },
    });
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "Actions for Alpha" });
    await user.click(trigger);
    const renderCountBeforeAdoption = alphaRenders.length;

    await user.click(screen.getByRole("menuitem", { name: "Open in new window" }));
    await waitFor(() => {
      expect(alphaRenders.length).toBeGreaterThan(renderCountBeforeAdoption);
    });
    expect(alphaRenders.at(-1)).toMatchObject({
      active: true,
      selected: true,
      lifecycle: "active",
    });

    const current = runtime.getSnapshot().projection;
    const rightNode = current.nodes["right-node"];
    const rightGroup = current.groups.right;
    if (rightNode === undefined || rightGroup === undefined) {
      throw new Error("Expected right-hand fixture topology");
    }
    act(() => {
      runtime.publishProjection({
        ...current,
        revision: "1",
        rootNodeId: "right-node",
        nodes: { "right-node": rightNode },
        groups: { right: rightGroup },
        activePanelId: "gamma",
      });
    });

    await waitFor(() => {
      expect(alphaRenders.at(-1)).toMatchObject({
        active: false,
        selected: true,
        lifecycle: "visible",
      });
    });
    const externalHost = popupDocument.querySelector<HTMLElement>(
      '[data-workspace-panel-host="alpha"]',
    );
    expect(externalHost?.hidden).toBe(false);
    expect(externalHost?.getAttribute("aria-hidden")).toBe("false");
  });

  it("announces unavailable outside detach without dispatching", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const announcements: string[] = [];
    renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onAnnouncement: (message) => announcements.push(message),
    });
    const alpha = await screen.findByRole("tab", { name: "Alpha" });
    installPointerCapture(alpha);
    fireEvent.pointerDown(alpha, { button: 0, pointerId: 72, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(alpha, { pointerId: 72, clientX: 1100, clientY: 350 });
    fireEvent.pointerUp(alpha, { pointerId: 72, clientX: 1100, clientY: 350 });
    expect(runtime.transactions).toHaveLength(0);
    expect(announcements.at(-1)).toMatch(/new window is unavailable/i);
  });

  it("supports vertical tab keyboard navigation and icon-only accessible names", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const iconRegistry: WorkspacePanelRegistry = {
      fixture: {
        render: panels.fixture?.render ?? (() => null),
        icon: <svg data-testid="fixture-icon" />,
      },
    };
    renderWorkspace(runtime, {
      registry: iconRegistry,
      tabPresentation: { placement: "inline-start", content: "icon-only" },
    });

    const tablist = await screen.findByRole("tablist", { name: "Left" });
    expect(tablist.getAttribute("aria-orientation")).toBe("vertical");
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha.getAttribute("title")).toBe("Alpha");
    expect(alpha.querySelector(".pf-tab-title")?.classList.contains("pf-visually-hidden")).toBe(
      true,
    );
    expect(alpha.querySelector(".pf-tab-icon")).toBeTruthy();
    const group = alpha.closest<HTMLElement>('[data-workspace-group="left"]');
    const controls = group?.querySelector<HTMLElement>(".pf-tab-controls");
    expect(group?.dataset.tabContent).toBe("icon-only");
    expect(group?.dataset.tabOrientation).toBe("vertical");
    expect(controls?.querySelectorAll(".pf-tab-more")).toHaveLength(1);
    expect(group?.querySelectorAll(".pf-tab .pf-tab-close")).toHaveLength(2);

    alpha.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("resolves tab presentation independently for each group", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const view = renderWorkspace(runtime, {
      tabPresentation: (group) =>
        group.id === "left"
          ? { placement: "inline-end", content: "label-only" }
          : { placement: "block-end", content: "icon-and-label" },
    });
    await screen.findByRole("tab", { name: "Alpha" });
    const left = requiredElement(view.container.querySelector('[data-workspace-group="left"]'));
    const right = requiredElement(view.container.querySelector('[data-workspace-group="right"]'));
    expect(left.dataset.tabPlacement).toBe("inline-end");
    expect(left.dataset.tabOrientation).toBe("vertical");
    expect(left.dataset.tabContent).toBe("label-only");
    expect(right.dataset.tabPlacement).toBe("block-end");
    expect(right.dataset.tabOrientation).toBe("horizontal");
  });

  it("offers all four split edges and new-window actions to menu and keyboard users", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    const externalOrigins: string[] = [];
    renderWorkspace(runtime, {
      commands: directManipulationCommands,
      onExternalPanelRequest: (request) => {
        externalOrigins.push(request.origin);
        return { status: "committed" };
      },
    });
    const user = userEvent.setup();
    let trigger = await screen.findByRole("button", { name: "Actions for Alpha" });
    await user.click(trigger);
    for (const label of ["Split left", "Split right", "Split above", "Split below"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    await user.click(screen.getByRole("menuitem", { name: "Split left" }));
    expect(runtime.lastCommand?.type).toBe("drop");
    if (runtime.lastCommand?.type === "drop") {
      expect(runtime.lastCommand.request.target).toMatchObject({
        kind: "edge",
        edge: "inline-start",
      });
    }
    expect(runtime.transactions.at(-1)?.origin).toBe("menu");

    trigger = screen.getByRole("button", { name: "Actions for Alpha" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /choose destination/i }));
    await user.keyboard("{End}{Enter}");
    expect(externalOrigins).toEqual(["keyboard"]);

    trigger = screen.getByRole("button", { name: "Actions for Alpha" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /choose destination/i }));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(runtime.lastCommand?.type).toBe("drop");
    if (runtime.lastCommand?.type === "drop") {
      expect(runtime.lastCommand.request.target).toMatchObject({
        kind: "edge",
        edge: "inline-start",
      });
    }
    expect(runtime.transactions.at(-1)?.origin).toBe("keyboard");
  });
});

class FixtureRuntime implements WorkspaceRuntimeLike<
  FixtureSnapshot,
  FixtureCommand,
  FixtureReceipt
> {
  readonly #listeners = new Set<() => void>();
  readonly #transactionListeners = new Set<() => void>();
  #snapshot: FixtureSnapshot;
  public readonly transactions: FixtureReceipt[] = [];
  public lastCommand: FixtureCommand | undefined;
  readonly #rejectedCommandType: FixtureCommand["type"] | undefined;
  readonly #recreatePanelViews: boolean;

  public constructor(
    projection: WorkspaceProjection,
    rejectedCommandType?: FixtureCommand["type"],
    options: { readonly recreatePanelViews?: boolean } = {},
  ) {
    this.#snapshot = { projection: cloneProjection(projection) };
    this.#rejectedCommandType = rejectedCommandType;
    this.#recreatePanelViews = options.recreatePanelViews ?? false;
  }

  public getSnapshot = () => this.#snapshot;

  public subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  public subscribeTransactions = (listener: () => void) => {
    this.#transactionListeners.add(listener);
    return () => this.#transactionListeners.delete(listener);
  };

  public getTransactions = () => this.transactions;

  public publishProjection(projection: WorkspaceProjection): void {
    const cloned = cloneProjection(projection);
    this.#snapshot = {
      projection: this.#recreatePanelViews ? recreatePanelViews(cloned) : cloned,
    };
    for (const listener of this.#listeners) listener();
  }

  public dispatch = (
    command: FixtureCommand,
    options: {
      readonly origin?: WorkspaceCommandOrigin;
      readonly label?: string;
    } = {},
  ) => {
    const origin = options.origin ?? "application";
    this.lastCommand = command;
    if (command.type === this.#rejectedCommandType) {
      return {
        status: "rejected",
        origin,
        type: command.type,
        result: { error: { message: "Denied by fixture policy" } },
      } as const;
    }
    const projection = reduceProjection(this.#snapshot.projection, command);
    this.#snapshot = {
      projection: this.#recreatePanelViews ? recreatePanelViews(projection) : projection,
    };
    const receipt = { status: "committed", origin, type: command.type } as const;
    this.transactions.push(receipt);
    for (const listener of this.#listeners) listener();
    for (const listener of this.#transactionListeners) listener();
    return receipt;
  };

  public undo = () => ({ status: "committed", origin: "history", type: "select" }) as const;
  public redo = () => ({ status: "committed", origin: "history", type: "select" }) as const;
  public canUndo = () => false;
  public canRedo = () => false;
}

function reduceProjection(
  projection: WorkspaceProjection,
  command: FixtureCommand,
): WorkspaceProjection {
  const nextRevision = String(Number(projection.revision) + 1);
  if (command.type === "select" || command.type === "activate") {
    const groups = Object.fromEntries(
      Object.entries(projection.groups).map(([id, group]) => [
        id,
        command.type === "select" && group.panelIds.includes(command.panelId)
          ? { ...group, selectedPanelId: command.panelId }
          : group,
      ]),
    );
    return {
      ...projection,
      revision: nextRevision,
      groups,
      activePanelId: command.panelId,
    };
  }
  if (command.type === "resize") {
    const target = projection.nodes[command.splitId];
    return {
      ...projection,
      revision: nextRevision,
      nodes: {
        ...projection.nodes,
        ...(target?.kind === "split"
          ? { [target.id]: { ...target, weights: command.weights } }
          : {}),
      },
    };
  }
  if (command.type === "move") {
    const source = Object.values(projection.groups).find((group) =>
      group.panelIds.includes(command.panelId),
    );
    const target = projection.groups[command.groupId];
    if (source === undefined || target === undefined) return projection;
    const remaining = source.panelIds.filter((id) => id !== command.panelId);
    return {
      ...projection,
      revision: nextRevision,
      activePanelId: command.panelId,
      groups: {
        ...projection.groups,
        [source.id]: {
          ...source,
          panelIds: remaining,
          selectedPanelId:
            source.selectedPanelId === command.panelId
              ? (remaining[0] ?? source.selectedPanelId)
              : source.selectedPanelId,
        },
        [target.id]: {
          ...target,
          panelIds: [...target.panelIds, command.panelId],
          selectedPanelId: command.panelId,
        },
      },
    };
  }
  if (command.type === "reorder") {
    const group = projection.groups[command.groupId];
    if (group === undefined || !group.panelIds.includes(command.panelId)) return projection;
    const remaining = group.panelIds.filter((panelId) => panelId !== command.panelId);
    let insertionIndex = remaining.length;
    if (command.beforePanelId !== undefined) {
      insertionIndex = remaining.indexOf(command.beforePanelId);
    } else if (command.afterPanelId !== undefined) {
      insertionIndex = remaining.indexOf(command.afterPanelId) + 1;
    }
    if (insertionIndex < 0) return projection;
    return {
      ...projection,
      revision: nextRevision,
      groups: {
        ...projection.groups,
        [group.id]: {
          ...group,
          panelIds: [
            ...remaining.slice(0, insertionIndex),
            command.panelId,
            ...remaining.slice(insertionIndex),
          ],
        },
      },
    };
  }
  if (command.type === "group-drop") {
    if (command.request.target.kind !== "swap") {
      return { ...projection, revision: nextRevision };
    }
    const sourceNodeId = command.request.sourceNodeId;
    const targetNodeId = command.request.targetNodeId;
    return {
      ...projection,
      revision: nextRevision,
      nodes: Object.fromEntries(
        Object.entries(projection.nodes).map(([id, node]) => [
          id,
          node.kind !== "split"
            ? node
            : {
                ...node,
                childIds: node.childIds.map((childId) =>
                  childId === sourceNodeId
                    ? targetNodeId
                    : childId === targetNodeId
                      ? sourceNodeId
                      : childId,
                ),
              },
        ]),
      ),
    };
  }
  if (command.type === "drop") {
    if (command.request.target.kind === "center") {
      return reduceProjection(projection, {
        type: "move",
        panelId: command.request.panel.id,
        groupId: command.request.targetGroup.id,
      });
    }
    return {
      ...projection,
      revision: nextRevision,
      activePanelId: command.request.panel.id,
    };
  }
  if (
    command.type === "move-floating" ||
    command.type === "resize-floating" ||
    command.type === "raise-floating" ||
    command.type === "maximize-floating" ||
    command.type === "restore-floating" ||
    command.type === "minimize-floating"
  ) {
    const surfaces = [...(projection.floatingSurfaces ?? [])];
    const index = surfaces.findIndex((surface) => surface.id === command.surfaceId);
    const surface = surfaces[index];
    if (surface === undefined) return projection;
    if (command.type === "raise-floating") {
      surfaces.splice(index, 1);
      surfaces.push(surface);
    } else if (command.type === "move-floating") {
      surfaces[index] = {
        ...surface,
        bounds: { ...surface.bounds, x: command.x, y: command.y },
      };
    } else if (command.type === "resize-floating") {
      surfaces[index] = { ...surface, bounds: command.bounds };
    } else if (command.type === "maximize-floating") {
      surfaces[index] = { ...surface, maximized: true };
    } else if (command.type === "minimize-floating") {
      surfaces[index] = { ...surface, minimized: true };
    } else if (surface.minimized === true) {
      const { minimized: _minimized, ...restored } = surface;
      void _minimized;
      surfaces[index] = restored;
    } else {
      surfaces[index] = { ...surface, maximized: false };
    }
    return {
      ...projection,
      revision: nextRevision,
      floatingSurfaces: surfaces,
      ...(command.type === "minimize-floating"
        ? { activePanelId: "alpha", activeSurfaceId: "main" }
        : {}),
    };
  }
  if (command.type === "redock-floating") {
    const surface = projection.floatingSurfaces?.find((item) => item.id === command.surfaceId);
    if (surface === undefined) return projection;
    const sourceNode = projection.nodes[surface.rootNodeId];
    const sourceGroup =
      sourceNode?.kind === "group" ? projection.groups[sourceNode.groupId] : undefined;
    const nodes = { ...projection.nodes };
    const groups = { ...projection.groups };
    delete nodes[surface.rootNodeId];
    if (sourceGroup !== undefined) delete groups[sourceGroup.id];
    const left = groups.left;
    if (left !== undefined && sourceGroup !== undefined) {
      groups.left = {
        ...left,
        panelIds: [...left.panelIds, ...sourceGroup.panelIds],
        selectedPanelId: sourceGroup.selectedPanelId,
      };
    }
    return {
      ...projection,
      revision: nextRevision,
      nodes,
      groups,
      floatingSurfaces: (projection.floatingSurfaces ?? []).filter(
        (item) => item.id !== command.surfaceId,
      ),
      ...(sourceGroup !== undefined
        ? { activePanelId: sourceGroup.selectedPanelId }
        : projection.activePanelId === undefined
          ? {}
          : { activePanelId: projection.activePanelId }),
      activeSurfaceId: "main",
    };
  }
  if (command.type === "close") {
    const panels = { ...projection.panels };
    delete panels[command.panelId];
    let activePanelId = projection.activePanelId;
    const groups = Object.fromEntries(
      Object.entries(projection.groups).map(([id, group]) => {
        if (!group.panelIds.includes(command.panelId)) return [id, group];
        const index = group.panelIds.indexOf(command.panelId);
        const panelIds = group.panelIds.filter((panelId) => panelId !== command.panelId);
        const selectedPanelId =
          group.selectedPanelId === command.panelId
            ? (group.panelIds[index + 1] ?? group.panelIds[index - 1] ?? "")
            : group.selectedPanelId;
        if (activePanelId === command.panelId) activePanelId = selectedPanelId;
        return [id, { ...group, panelIds, selectedPanelId }];
      }),
    );
    return {
      ...projection,
      revision: nextRevision,
      panels,
      groups,
      ...(activePanelId === undefined ? {} : { activePanelId }),
    };
  }
  return projection;
}

function renderWorkspace(
  runtime: FixtureRuntime,
  options: {
    readonly motion?: "off" | "reduced" | "productive";
    readonly registry?: WorkspacePanelRegistry;
    readonly direction?: "ltr" | "rtl";
    readonly frameScheduler?: SurfaceFrameScheduler;
    readonly layoutSolver?: WorkspaceLayoutSolver<FixtureSnapshot>;
    readonly motionDriver?: MotionDriver;
    readonly commands?: WorkspaceCommandAdapter<FixtureCommand>;
    readonly tabPresentation?:
      | {
          readonly placement: "block-start" | "block-end" | "inline-start" | "inline-end";
          readonly content: "icon-and-label" | "icon-only" | "label-only";
        }
      | WorkspaceTabPresentationResolver;
    readonly onExternalPanelRequest?: WorkspaceExternalPanelHandler;
    readonly externalPanelRequestTimeoutMs?: number;
    readonly onAnnouncement?: (message: string) => void;
    readonly messageCatalog?: WorkspaceMessageCatalog;
    readonly interpretResult?: WorkspaceResultInterpreter<FixtureCommand, FixtureReceipt>;
  } = {},
) {
  return render(
    <WorkspaceRuntimeProvider runtime={runtime}>
      <div style={{ width: 1000, height: 700 }}>
        <WorkspaceSurface
          projector={(snapshot: FixtureSnapshot) => snapshot.projection}
          commands={options.commands ?? commands}
          panels={options.registry ?? panels}
          layoutBounds={{ inlineStart: 0, blockStart: 0, inlineSize: 1000, blockSize: 700 }}
          workspaceLabel="Fixture workspace"
          {...(options.messageCatalog === undefined
            ? {}
            : { messageCatalog: options.messageCatalog })}
          {...(options.tabPresentation === undefined
            ? {}
            : { tabPresentation: options.tabPresentation })}
          {...(options.onExternalPanelRequest === undefined
            ? {}
            : { onExternalPanelRequest: options.onExternalPanelRequest })}
          {...(options.externalPanelRequestTimeoutMs === undefined
            ? {}
            : { externalPanelRequestTimeoutMs: options.externalPanelRequestTimeoutMs })}
          {...(options.onAnnouncement === undefined
            ? {}
            : { onAnnouncement: options.onAnnouncement })}
          {...(options.interpretResult === undefined
            ? {}
            : { interpretResult: options.interpretResult })}
          {...(options.direction === undefined ? {} : { direction: options.direction })}
          {...(options.frameScheduler === undefined
            ? {}
            : { frameScheduler: options.frameScheduler })}
          {...(options.layoutSolver === undefined ? {} : { layoutSolver: options.layoutSolver })}
          {...(options.motionDriver === undefined ? {} : { motionDriver: options.motionDriver })}
          {...(options.motion === undefined ? {} : { motion: options.motion })}
        />
      </div>
    </WorkspaceRuntimeProvider>,
  );
}

function panel(id: string, title: string) {
  return {
    id,
    type: "fixture",
    title,
    closable: true,
    floatable: true,
  };
}

function fixtureDropPreview(
  request: WorkspacePanelDropRequest,
  context: WorkspacePanelDropPlanContext,
) {
  if (request.target.kind === "center") return context.targetRect;
  const rect = context.targetRect;
  const inlineSize = Math.round((rect.inlineSize - context.splitterSize) * request.target.ratio);
  const blockSize = Math.round((rect.blockSize - context.splitterSize) * request.target.ratio);
  if (request.target.edge === "inline-start") return { ...rect, inlineSize };
  if (request.target.edge === "inline-end") {
    return { ...rect, inlineStart: rect.inlineStart + rect.inlineSize - inlineSize, inlineSize };
  }
  if (request.target.edge === "block-start") return { ...rect, blockSize };
  return { ...rect, blockStart: rect.blockStart + rect.blockSize - blockSize, blockSize };
}

function fixtureGroupDropPreview(
  request: WorkspaceGroupDropRequest,
  context: WorkspaceGroupDropPlanContext,
) {
  if (request.target.kind === "swap") return context.targetRect;
  const rect = context.targetRect;
  const inlineSize = Math.round((rect.inlineSize - context.splitterSize) * request.target.ratio);
  const blockSize = Math.round((rect.blockSize - context.splitterSize) * request.target.ratio);
  if (request.target.edge === "inline-start") return { ...rect, inlineSize };
  if (request.target.edge === "inline-end") {
    return { ...rect, inlineStart: rect.inlineStart + rect.inlineSize - inlineSize, inlineSize };
  }
  if (request.target.edge === "block-start") return { ...rect, blockSize };
  return { ...rect, blockStart: rect.blockStart + rect.blockSize - blockSize, blockSize };
}

function cloneProjection(projection: WorkspaceProjection): WorkspaceProjection {
  return {
    ...projection,
    nodes: { ...projection.nodes },
    groups: { ...projection.groups },
    panels: { ...projection.panels },
    ...(projection.floatingSurfaces === undefined
      ? {}
      : {
          floatingSurfaces: projection.floatingSurfaces.map((surface) => ({
            ...surface,
            bounds: { ...surface.bounds },
          })),
        }),
  };
}

function recreatePanelViews(projection: WorkspaceProjection): WorkspaceProjection {
  return {
    ...projection,
    panels: Object.fromEntries(
      Object.entries(projection.panels).map(([panelId, panelView]) => [
        panelId,
        {
          ...panelView,
          ...(panelView.lifecyclePolicy === undefined
            ? {}
            : { lifecyclePolicy: { ...panelView.lifecyclePolicy } }),
        },
      ]),
    ),
  };
}

function createManualFrameScheduler() {
  let pending: FrameRequestCallback | undefined;
  let nextHandle = 0;
  const scheduler = new SurfaceFrameScheduler({
    requestFrame: (callback) => {
      pending = callback;
      nextHandle += 1;
      return nextHandle;
    },
    cancelFrame: () => {
      pending = undefined;
    },
  });
  return {
    scheduler,
    flush() {
      const callback = pending;
      pending = undefined;
      callback?.(16);
    },
    hasPending() {
      return pending !== undefined;
    },
  };
}

class ControllableResizeObserver implements ResizeObserver {
  private readonly observed = new Set<Element>();
  private disconnected = false;

  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    this.disconnected = false;
    this.observed.add(target);
  }

  public unobserve(target: Element) {
    this.observed.delete(target);
  }

  public disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  public takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  public hasObserved(target: Element) {
    return this.observed.has(target);
  }

  public notify() {
    if (!this.disconnected) this.callback([], this);
  }
}

function installControllableResizeObserver() {
  const instances: ControllableResizeObserver[] = [];
  const original = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  class InstalledResizeObserver extends ControllableResizeObserver {
    public constructor(callback: ResizeObserverCallback) {
      super(callback);
      instances.push(this);
    }
  }
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: InstalledResizeObserver,
  });
  return {
    instances,
    restore() {
      if (original === undefined) Reflect.deleteProperty(window, "ResizeObserver");
      else Object.defineProperty(window, "ResizeObserver", original);
    },
  };
}

const hardMinimumLayoutSolver: WorkspaceLayoutSolver<FixtureSnapshot> = (snapshot, request) => {
  const root = snapshot.projection.nodes.root;
  if (root?.kind !== "split") {
    return solveWorkspaceProjectionLayout(snapshot.projection, request.bounds, {
      splitterSize: request.splitterSize,
      splitOverrides: request.splitOverrides,
    });
  }
  const requested = request.splitOverrides.root?.weights ?? root.weights;
  const before = requested[0] ?? 1;
  const after = requested[1] ?? 1;
  const contentSize = Math.max(0, request.bounds.inlineSize - request.splitterSize);
  const requestedBefore = Math.round(contentSize * (before / (before + after)));
  const constrainedBefore = Math.min(contentSize - 450, Math.max(1, requestedBefore));

  return solveWorkspaceProjectionLayout(snapshot.projection, request.bounds, {
    splitterSize: request.splitterSize,
    splitOverrides: {
      ...request.splitOverrides,
      root: {
        ...request.splitOverrides.root,
        weights: [constrainedBefore, contentSize - constrainedBefore],
      },
    },
  });
};

function installPointerCapture(element: HTMLElement) {
  let capturedPointer: number | undefined;
  element.setPointerCapture = (pointerId) => {
    capturedPointer = pointerId;
  };
  element.hasPointerCapture = (pointerId) => capturedPointer === pointerId;
  element.releasePointerCapture = (pointerId) => {
    if (capturedPointer === pointerId) capturedPointer = undefined;
  };
}

function trackStableHostWrites(element: HTMLElement) {
  const setAttribute = vi.spyOn(element, "setAttribute");
  const removeAttribute = vi.spyOn(element, "removeAttribute");
  const hidden = trackBooleanPropertyWrites(element, "hidden");
  const inert = trackBooleanPropertyWrites(element, "inert");
  return {
    count: () =>
      setAttribute.mock.calls.length +
      removeAttribute.mock.calls.length +
      hidden.count() +
      inert.count(),
    reset: () => {
      setAttribute.mockClear();
      removeAttribute.mockClear();
      hidden.reset();
      inert.reset();
    },
  };
}

function trackBooleanPropertyWrites(element: HTMLElement, property: "hidden" | "inert") {
  const descriptor = findPropertyDescriptor(element, property);
  let fallbackValue = element[property];
  let writes = 0;
  Object.defineProperty(element, property, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => descriptor?.get?.call(element) ?? fallbackValue,
    set: (value: boolean) => {
      writes += 1;
      if (descriptor?.set === undefined) fallbackValue = value;
      else descriptor.set.call(element, value);
    },
  });
  return {
    count: () => writes,
    reset: () => {
      writes = 0;
    },
  };
}

function findPropertyDescriptor(target: object, property: PropertyKey) {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) return descriptor;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function setElementRect(
  element: Element,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
) {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }) as DOMRect;
}

function requiredElement(element: Element | null): HTMLElement {
  if (!(element instanceof HTMLElement)) throw new Error("Expected fixture element");
  return element;
}

async function waitForElement(container: HTMLElement, selector: string): Promise<HTMLElement> {
  let element: Element | null = null;
  await waitFor(() => {
    element = container.querySelector(selector);
    expect(element).toBeTruthy();
  });
  return requiredElement(element);
}

class RecordingMotionDriver implements MotionDriver {
  public readonly plans: MotionPlan[] = [];

  public animate(_element: Element, plan: MotionPlan): MotionHandle {
    this.plans.push(plan);
    return {
      finished: Promise.resolve(),
      cancel() {},
      finish() {},
    };
  }
}
