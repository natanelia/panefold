// @vitest-environment jsdom

import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SurfaceFrameScheduler,
  type MotionDriver,
  type MotionHandle,
  type MotionPlan,
} from "@panefold/motion";

import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  type WorkspaceMessageCatalog,
  type WorkspaceCommandAdapter,
  type WorkspaceCommandOrigin,
  type WorkspacePanelRegistry,
  type WorkspacePanelRenderProps,
  type WorkspaceProjection,
  type WorkspaceRuntimeLike,
} from "../src";

afterEach(cleanup);

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
    };

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

const commands: WorkspaceCommandAdapter<FixtureCommand> = {
  selectPanel: (panelId) => ({ type: "select", panelId }),
  activatePanel: (panelId) => ({ type: "activate", panelId }),
  closePanel: (panelId) => ({ type: "close", panelId }),
  resizeSplit: (splitId, weights) => ({ type: "resize", splitId, weights }),
  movePanel: (panelId, groupId) => ({ type: "move", panelId, groupId }),
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
    await user.click(screen.getByRole("button", { name: "Tutup Beta" }));
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

  it("keeps panel controls outside the tablist accessibility structure", async () => {
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);

    const tablist = await screen.findByRole("tablist", { name: "Left" });
    expect(Array.from(tablist.children).map((child) => child.getAttribute("role"))).toEqual([
      "tab",
      "tab",
    ]);
    expect(tablist.querySelector('button:not([role="tab"])')).toBeNull();
    expect(screen.getByRole("button", { name: "Close Alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for Alpha" })).toBeTruthy();
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
    const view = renderWorkspace(runtime, { frameScheduler: frames.scheduler });
    const splitter = await screen.findByRole("separator", { name: /resize adjacent/i });
    installPointerCapture(splitter);
    const firstChild = requiredElement(
      view.container.querySelector('[data-workspace-split="root"] > .pf-split-child'),
    );
    expect(firstChild.dataset.inlineSize).toBe("497");

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 7, clientX: 497, clientY: 0 });
    fireEvent.pointerMove(splitter, { pointerId: 7, clientX: 550, clientY: 0 });
    fireEvent.pointerMove(splitter, { pointerId: 7, clientX: 597, clientY: 0 });
    expect(firstChild.dataset.inlineSize).toBe("497");
    act(() => {
      frames.flush();
    });

    const previewSize = firstChild.dataset.inlineSize;
    expect(previewSize).toBe("597");
    expect(runtime.getSnapshot().projection.revision).toBe("0");

    fireEvent.pointerUp(splitter, { pointerId: 7, clientX: 597, clientY: 0 });
    await waitFor(() => {
      expect(runtime.getSnapshot().projection.revision).toBe("1");
    });
    expect(firstChild.dataset.inlineSize).toBe(previewSize);
    expect(runtime.transactions.at(-1)?.origin).toBe("pointer");
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

  it("uses a non-modal move dialog and restores its invoking trigger", async () => {
    const user = userEvent.setup();
    const runtime = new FixtureRuntime(initialProjection);
    renderWorkspace(runtime);
    let trigger = await screen.findByRole("button", { name: "Actions for Alpha" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /choose destination/i }));

    let dialog = screen.getByRole("dialog", { name: "Move Alpha" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    await waitFor(() => {
      expect(dialog).toBe(document.activeElement);
    });

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
  readonly #rejectedCommandType: FixtureCommand["type"] | undefined;

  public constructor(
    projection: WorkspaceProjection,
    rejectedCommandType?: FixtureCommand["type"],
  ) {
    this.#snapshot = { projection: cloneProjection(projection) };
    this.#rejectedCommandType = rejectedCommandType;
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

  public dispatch = (
    command: FixtureCommand,
    options: {
      readonly origin?: WorkspaceCommandOrigin;
      readonly label?: string;
    } = {},
  ) => {
    const origin = options.origin ?? "application";
    if (command.type === this.#rejectedCommandType) {
      return {
        status: "rejected",
        origin,
        type: command.type,
        result: { error: { message: "Denied by fixture policy" } },
      } as const;
    }
    this.#snapshot = {
      projection: reduceProjection(this.#snapshot.projection, command),
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
    readonly motionDriver?: MotionDriver;
  } = {},
) {
  return render(
    <WorkspaceRuntimeProvider runtime={runtime}>
      <div style={{ width: 1000, height: 700 }}>
        <WorkspaceSurface
          projector={(snapshot: FixtureSnapshot) => snapshot.projection}
          commands={commands}
          panels={options.registry ?? panels}
          layoutBounds={{ inlineStart: 0, blockStart: 0, inlineSize: 1000, blockSize: 700 }}
          workspaceLabel="Fixture workspace"
          {...(options.direction === undefined ? {} : { direction: options.direction })}
          {...(options.frameScheduler === undefined
            ? {}
            : { frameScheduler: options.frameScheduler })}
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

function cloneProjection(projection: WorkspaceProjection): WorkspaceProjection {
  return {
    ...projection,
    nodes: { ...projection.nodes },
    groups: { ...projection.groups },
    panels: { ...projection.panels },
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

function requiredElement(element: Element | null): HTMLElement {
  if (!(element instanceof HTMLElement)) throw new Error("Expected fixture element");
  return element;
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
