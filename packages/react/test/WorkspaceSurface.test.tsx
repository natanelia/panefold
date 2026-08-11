// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceRuntimeProvider,
  WorkspaceSurface,
  type WorkspaceCommandAdapter,
  type WorkspaceCommandOrigin,
  type WorkspacePanelRegistry,
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

describe("WorkspaceSurface", () => {
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
  options: { readonly motion?: "off" | "reduced" | "productive" } = {},
) {
  return render(
    <WorkspaceRuntimeProvider runtime={runtime}>
      <div style={{ width: 1000, height: 700 }}>
        <WorkspaceSurface
          projector={(snapshot: FixtureSnapshot) => snapshot.projection}
          commands={commands}
          panels={panels}
          workspaceLabel="Fixture workspace"
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
