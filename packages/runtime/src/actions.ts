import { reduceWorkspace } from "@panefold/kernel";
import {
  cloneAndFreeze,
  closedPanelId,
  createPanel,
  groupId,
  nodeId,
  panelId,
  surfaceId,
  type BatchableWorkspaceCommand,
  type FocusPolicy,
  type GroupRecord,
  type LogicalEdge,
  type PanelInput,
  type Rect,
  type TabPlacement,
  type WorkspaceCommand,
  type WorkspaceSnapshot,
} from "@panefold/model";

import type { DispatchOptions, RuntimeDispatchReceipt, WorkspaceRuntime } from "./runtime";

/** A group ID appends a tab; relational anchors place it before or after a live tab. */
export type PanelPlacement =
  | string
  | {
      readonly groupId: string;
      readonly beforePanelId?: string;
      readonly afterPanelId?: string;
    };

export interface PanelActionOptions extends DispatchOptions {
  readonly select?: boolean;
  readonly activate?: boolean;
}

export interface ActivatePanelOptions extends DispatchOptions {
  readonly focus?: FocusPolicy;
}

export interface ReopenPanelOptions extends PanelActionOptions {
  readonly placement?: PanelPlacement;
}

export interface SplitPanelOptions extends DispatchOptions {
  /** Fraction of the original group assigned to the new group. Defaults to 0.5. */
  readonly ratio?: number;
  /** Omit to allocate an identity; supply a name when the app needs to address this group. */
  readonly newGroupId?: string;
  readonly region?: string;
}

/**
 * An immutable operation prepared against one workspace revision; no dispatch has occurred.
 * command is its standalone preview. A batch derives the command again after preceding operations.
 */
export interface WorkspaceActionPlan {
  readonly command: WorkspaceCommand;
  readonly baseRevision: WorkspaceSnapshot["revision"];
}

type SemanticOptions<Options> = Omit<Options, keyof DispatchOptions> & {
  readonly [Key in keyof DispatchOptions]?: never;
};

/**
 * Compose operations before committing them. Batch preparation resolves each intent against the
 * staged results of preceding operations. Put transaction metadata on actions.batch(), not plans.
 */
export interface WorkspacePlans {
  openPanel(
    panel: PanelInput,
    placement: PanelPlacement,
    options?: SemanticOptions<PanelActionOptions>,
  ): WorkspaceActionPlan;
  selectPanel(
    id: string,
    options?: SemanticOptions<Omit<PanelActionOptions, "select">>,
  ): WorkspaceActionPlan;
  activatePanel(id: string, options?: SemanticOptions<ActivatePanelOptions>): WorkspaceActionPlan;
  closePanel(id: string): WorkspaceActionPlan;
  closePanels(ids: readonly string[]): WorkspaceActionPlan;
  closeOtherPanels(id: string): WorkspaceActionPlan;
  closePanelsToRight(id: string): WorkspaceActionPlan;
  reopenPanel(id: string, options?: SemanticOptions<ReopenPanelOptions>): WorkspaceActionPlan;
  reopenLastPanel(options?: SemanticOptions<ReopenPanelOptions>): WorkspaceActionPlan;
  movePanel(
    id: string,
    placement: PanelPlacement,
    options?: SemanticOptions<PanelActionOptions>,
  ): WorkspaceActionPlan;
  splitPanel(
    id: string,
    edge: LogicalEdge,
    options?: SemanticOptions<SplitPanelOptions>,
  ): WorkspaceActionPlan;
  floatPanel(id: string, bounds: Rect): WorkspaceActionPlan;
  redockSurface(id: string, placement: PanelPlacement): WorkspaceActionPlan;
  resizeSplit(id: string, weights: readonly number[]): WorkspaceActionPlan;
  equalizeSplit(id: string): WorkspaceActionPlan;
}

/**
 * Application actions use ordinary IDs and preserve the runtime's exact receipts.
 * A queued receipt is not a completed commit. Use runtime.dispatch for the full command catalog.
 */
export interface WorkspaceActions {
  openPanel(
    panel: PanelInput,
    placement: PanelPlacement,
    options?: PanelActionOptions,
  ): RuntimeDispatchReceipt;
  selectPanel(id: string, options?: Omit<PanelActionOptions, "select">): RuntimeDispatchReceipt;
  activatePanel(id: string, options?: ActivatePanelOptions): RuntimeDispatchReceipt;
  closePanel(id: string, options?: DispatchOptions): RuntimeDispatchReceipt;
  closePanels(ids: readonly string[], options?: DispatchOptions): RuntimeDispatchReceipt;
  closeOtherPanels(id: string, options?: DispatchOptions): RuntimeDispatchReceipt;
  closePanelsToRight(id: string, options?: DispatchOptions): RuntimeDispatchReceipt;
  reopenPanel(id: string, options?: ReopenPanelOptions): RuntimeDispatchReceipt;
  /** Selects the newest closed revision, breaking ties by canonical closed-record ID order. */
  reopenLastPanel(options?: ReopenPanelOptions): RuntimeDispatchReceipt;
  movePanel(
    id: string,
    placement: PanelPlacement,
    options?: PanelActionOptions,
  ): RuntimeDispatchReceipt;
  /** Move one tab out of its current group, leaving at least one tab in the original group. */
  splitPanel(id: string, edge: LogicalEdge, options?: SplitPanelOptions): RuntimeDispatchReceipt;
  /** Float a single tab in one undoable transaction, even when its group contains other tabs. */
  floatPanel(id: string, bounds: Rect, options?: DispatchOptions): RuntimeDispatchReceipt;
  /** Same-document redocking. External-window ownership still requires the prepared protocol. */
  redockSurface(
    id: string,
    placement: PanelPlacement,
    options?: DispatchOptions,
  ): RuntimeDispatchReceipt;
  resizeSplit(
    id: string,
    weights: readonly number[],
    options?: DispatchOptions,
  ): RuntimeDispatchReceipt;
  equalizeSplit(id: string, options?: DispatchOptions): RuntimeDispatchReceipt;
  /** Commit prepared operations together as one atomic, undoable transaction. */
  batch(plans: readonly WorkspaceActionPlan[], options?: DispatchOptions): RuntimeDispatchReceipt;
  undo(): RuntimeDispatchReceipt;
  redo(): RuntimeDispatchReceipt;
}

type ActionRuntime = Pick<WorkspaceRuntime, "getSnapshot" | "dispatch" | "undo" | "redo">;
type IdentityKind = "group" | "node" | "surface" | "closed";

// One scalar per runtime, shared even when an app creates multiple bindings/facades.
// No subscriptions, reservation ledger, global sequence, or explicit cleanup are needed.
const identitySequences = new WeakMap<ActionRuntime, { next: number }>();
const actionFacades = new WeakMap<ActionRuntime, WorkspaceActions>();
const planFacades = new WeakMap<ActionRuntime, WorkspacePlans>();
interface PreparedOperation {
  readonly runtime: ActionRuntime;
  readonly prepare: (snapshot: WorkspaceSnapshot) => WorkspaceCommand;
}
const preparedOperations = new WeakMap<WorkspaceActionPlan, PreparedOperation>();

function allocateIdentity(
  runtime: ActionRuntime,
  kind: IdentityKind,
  snapshot = runtime.getSnapshot(),
): string {
  let sequence = identitySequences.get(runtime);
  if (sequence === undefined) {
    sequence = { next: 0 };
    identitySequences.set(runtime, sequence);
  }
  const occupied = (id: string): boolean => {
    switch (kind) {
      case "group":
        return Object.hasOwn(snapshot.groups.byId, id);
      case "node":
        return Object.hasOwn(snapshot.nodes.byId, id);
      case "surface":
        return Object.hasOwn(snapshot.surfaces.byId, id);
      case "closed":
        return snapshot.recoverableClosedPanels.some((item) => String(item.id) === id);
    }
  };
  // Each collision advances the sequence. At most the live occupied identities can collide.
  while (sequence.next < Number.MAX_SAFE_INTEGER) {
    const id = `panefold:action:${kind}:${String(++sequence.next)}`;
    if (!occupied(id)) return id;
  }
  throw new RangeError(
    "Workspace action identities are exhausted; recreate the workspace runtime.",
  );
}

function placement(input: PanelPlacement): TabPlacement {
  if (typeof input === "string") return { groupId: groupId(input) };
  return {
    groupId: groupId(input.groupId),
    ...(input.beforePanelId === undefined ? {} : { beforePanelId: panelId(input.beforePanelId) }),
    ...(input.afterPanelId === undefined ? {} : { afterPanelId: panelId(input.afterPanelId) }),
  };
}

function containingGroup(snapshot: WorkspaceSnapshot, id: string): GroupRecord | undefined {
  const panel = panelId(id);
  for (const group of snapshot.groups.ids) {
    const record = snapshot.groups.byId[String(group)];
    if (record?.panelIds.includes(panel)) return record;
  }
  return undefined;
}

/** State-derived intent must reject when queued behind a different revision. */
function atRevision(snapshot: WorkspaceSnapshot, options: DispatchOptions = {}): DispatchOptions {
  if (options.baseRevision !== undefined && options.baseRevision > snapshot.revision) {
    throw new RangeError(
      "State-derived actions cannot target a future revision; read the current snapshot before planning.",
    );
  }
  return { ...options, baseRevision: options.baseRevision ?? snapshot.revision };
}

type OperationFactories<Result> = {
  readonly [Key in Exclude<keyof WorkspaceActions, "undo" | "redo" | "batch">]: (
    ...args: Parameters<WorkspaceActions[Key]>
  ) => Result;
};

function createOperations<Result>(
  getSnapshot: () => WorkspaceSnapshot,
  allocate: (kind: IdentityKind) => string,
  dispatch: (command: WorkspaceCommand, options?: DispatchOptions) => Result,
): OperationFactories<Result> {
  const closeTargets = (ids: readonly string[]) =>
    ids.map((id) => ({
      panelId: panelId(id),
      closedPanelId: closedPanelId(allocate("closed")),
    }));
  const closePanels = (ids: readonly string[], options?: DispatchOptions) =>
    dispatch({ type: "close-panels", targets: closeTargets(ids) }, options);
  const reopenPanel = (id: string, options: ReopenPanelOptions = {}) =>
    dispatch(
      {
        type: "reopen-panel",
        closedPanelId: closedPanelId(id),
        ...(options.placement === undefined ? {} : { placement: placement(options.placement) }),
        select: options.select ?? true,
        activate: options.activate ?? true,
      },
      options,
    );

  return Object.freeze({
    openPanel: (input: PanelInput, target: PanelPlacement, options: PanelActionOptions = {}) =>
      dispatch(
        {
          type: "open-panel",
          panel: createPanel(input),
          placement: placement(target),
          select: options.select ?? true,
          activate: options.activate ?? true,
        },
        options,
      ),
    selectPanel: (id: string, options: Omit<PanelActionOptions, "select"> = {}) =>
      dispatch(
        { type: "select-panel", panelId: panelId(id), activate: options.activate ?? true },
        options,
      ),
    activatePanel: (id: string, options: ActivatePanelOptions = {}) =>
      dispatch(
        { type: "activate-panel", panelId: panelId(id), focus: options.focus ?? "keep-focus" },
        options,
      ),
    closePanel: (id: string, options?: DispatchOptions) => closePanels([id], options),
    closePanels,
    closeOtherPanels: (id: string, options?: DispatchOptions) => {
      const snapshot = getSnapshot();
      const group = containingGroup(snapshot, id);
      const targets = (group?.panelIds ?? []).filter(
        (candidate) =>
          String(candidate) !== id &&
          snapshot.panels.byId[String(candidate)]?.capabilities.closable,
      );
      return dispatch(
        {
          type: "close-other-panels",
          groupId: group?.id ?? groupId(allocate("group")),
          exceptPanelId: panelId(id),
          targets: closeTargets(targets),
        },
        atRevision(snapshot, options),
      );
    },
    closePanelsToRight: (id: string, options?: DispatchOptions) => {
      const snapshot = getSnapshot();
      const group = containingGroup(snapshot, id);
      const targets = (group?.panelIds.slice(group.panelIds.indexOf(panelId(id)) + 1) ?? []).filter(
        (candidate) => snapshot.panels.byId[String(candidate)]?.capabilities.closable,
      );
      return dispatch(
        {
          type: "close-panels-to-right",
          groupId: group?.id ?? groupId(allocate("group")),
          panelId: panelId(id),
          targets: closeTargets(targets),
        },
        atRevision(snapshot, options),
      );
    },
    reopenPanel,
    reopenLastPanel: (options: ReopenPanelOptions = {}) => {
      const snapshot = getSnapshot();
      let newest: WorkspaceSnapshot["recoverableClosedPanels"][number] | undefined;
      for (const record of snapshot.recoverableClosedPanels) {
        if (
          newest === undefined ||
          record.closedAtRevision > newest.closedAtRevision ||
          (record.closedAtRevision === newest.closedAtRevision && record.id > newest.id)
        )
          newest = record;
      }
      return reopenPanel(String(newest?.id ?? allocate("closed")), {
        ...options,
        ...atRevision(snapshot, options),
      });
    },
    movePanel: (id: string, target: PanelPlacement, options: PanelActionOptions = {}) =>
      dispatch(
        {
          type: "move-panel",
          panelId: panelId(id),
          target: placement(target),
          select: options.select ?? true,
          activate: options.activate ?? true,
        },
        options,
      ),
    splitPanel: (id: string, edge: LogicalEdge, options: SplitPanelOptions = {}) => {
      const snapshot = getSnapshot();
      const source = containingGroup(snapshot, id);
      return dispatch(
        {
          type: "split-group",
          targetGroupId: source?.id ?? groupId(allocate("group")),
          panelIds: [panelId(id)],
          newGroupId: groupId(options.newGroupId ?? allocate("group")),
          newGroupNodeId: nodeId(allocate("node")),
          splitNodeId: nodeId(allocate("node")),
          edge,
          ratio: options.ratio ?? 0.5,
          ...(options.region === undefined ? {} : { region: options.region }),
        },
        atRevision(snapshot, options),
      );
    },
    floatPanel: (id: string, bounds: Rect, options?: DispatchOptions) => {
      const snapshot = getSnapshot();
      const source = containingGroup(snapshot, id);
      const floatingId = surfaceId(allocate("surface"));
      if (source === undefined || source.panelIds.length <= 1) {
        return dispatch(
          {
            type: "create-floating-surface",
            groupId: source?.id ?? groupId(allocate("group")),
            surfaceId: floatingId,
            bounds,
          },
          atRevision(snapshot, options),
        );
      }
      const floatingGroupId = groupId(allocate("group"));
      const commands: readonly BatchableWorkspaceCommand[] = [
        {
          type: "split-group",
          targetGroupId: source.id,
          panelIds: [panelId(id)],
          newGroupId: floatingGroupId,
          newGroupNodeId: nodeId(allocate("node")),
          splitNodeId: nodeId(allocate("node")),
          edge: "inline-end",
          ratio: 0.5,
          ...(source.region === undefined ? {} : { region: source.region }),
        },
        {
          type: "create-floating-surface",
          groupId: floatingGroupId,
          surfaceId: floatingId,
          bounds,
        },
      ];
      return dispatch({ type: "batch", commands }, atRevision(snapshot, options));
    },
    redockSurface: (id: string, target: PanelPlacement, options?: DispatchOptions) =>
      dispatch(
        { type: "redock-surface", surfaceId: surfaceId(id), target: placement(target) },
        options,
      ),
    resizeSplit: (id: string, weights: readonly number[], options?: DispatchOptions) =>
      dispatch({ type: "resize-split", splitNodeId: nodeId(id), weights }, options),
    equalizeSplit: (id: string, options?: DispatchOptions) =>
      dispatch({ type: "equalize-split", splitNodeId: nodeId(id) }, options),
  });
}

/** Bind stable plan builders to an existing runtime without subscribing or owning its lifetime. */
export function createWorkspacePlans(runtime: ActionRuntime): WorkspacePlans {
  const existing = planFacades.get(runtime);
  if (existing !== undefined) return existing;
  const factories = createOperations(
    () => runtime.getSnapshot(),
    (kind) => allocateIdentity(runtime, kind),
    (command) => command,
  );
  // Derive the builder names from the implementation rather than maintaining another inventory.
  const entries = Object.keys(factories).map((name) => [
    name,
    (...args: unknown[]) => {
      const ownedArgs = cloneAndFreeze(args);
      const identities: Record<IdentityKind, string[]> = {
        group: [],
        node: [],
        surface: [],
        closed: [],
      };
      const prepare = (snapshot: WorkspaceSnapshot): WorkspaceCommand => {
        const cursors: Record<IdentityKind, number> = { group: 0, node: 0, surface: 0, closed: 0 };
        const builders = createOperations(
          () => snapshot,
          (kind) => {
            const index = cursors[kind]++;
            const existingId = identities[kind][index];
            if (existingId !== undefined) return existingId;
            const id = allocateIdentity(runtime, kind, snapshot);
            identities[kind].push(id);
            return id;
          },
          (command) => cloneAndFreeze(command),
        );
        // Every key and argument tuple comes from one of the typed operation factories above.
        const builder = builders[name as keyof typeof builders] as (
          ...input: unknown[]
        ) => WorkspaceCommand;
        return builder(...ownedArgs);
      };
      const snapshot = runtime.getSnapshot();
      const plan: WorkspaceActionPlan = Object.freeze({
        command: prepare(snapshot),
        baseRevision: snapshot.revision,
      });
      preparedOperations.set(plan, { runtime, prepare });
      return plan;
    },
  ]);
  const plans = Object.freeze(Object.fromEntries(entries)) as unknown as WorkspacePlans;
  planFacades.set(runtime, plans);
  return plans;
}

/**
 * Bind conveniences to an existing runtime without owning or disposing it.
 * Policies, capabilities, revisions, atomicity and history remain runtime/kernel decisions.
 */
export function createWorkspaceActions(runtime: ActionRuntime): WorkspaceActions {
  const existing = actionFacades.get(runtime);
  if (existing !== undefined) return existing;
  const dispatch = (command: WorkspaceCommand, options?: DispatchOptions) =>
    runtime.dispatch(cloneAndFreeze(command), options);
  const actions: WorkspaceActions = Object.freeze({
    ...createOperations(
      () => runtime.getSnapshot(),
      (kind) => allocateIdentity(runtime, kind),
      dispatch,
    ),
    batch: (plans: readonly WorkspaceActionPlan[], options?: DispatchOptions) => {
      if (plans.length > 1_000) {
        throw new RangeError("A plan batch supports at most 1,000 operations.");
      }
      const snapshot = runtime.getSnapshot();
      const guarded = atRevision(snapshot, options);
      let baseRevision = guarded.baseRevision ?? snapshot.revision;
      const operations = plans.map((plan) => {
        const operation = preparedOperations.get(plan);
        if (operation?.runtime !== runtime) {
          throw new TypeError("Batch plans must be created by this workspace's plan helpers.");
        }
        if (plan.baseRevision < baseRevision) baseRevision = plan.baseRevision;
        return { plan, operation };
      });
      const commands: BatchableWorkspaceCommand[] = [];
      let staged = snapshot;
      let canStage = baseRevision === snapshot.revision;
      for (const { plan, operation } of operations) {
        const command = canStage ? operation.prepare(staged) : plan.command;
        if (command.type === "batch") commands.push(...command.commands);
        else if (
          command.type === "undo-workspace-operation" ||
          command.type === "redo-workspace-operation" ||
          command.type === "apply-remote-transaction"
        ) {
          throw new TypeError("History and remote transactions cannot be composed into a batch.");
        } else commands.push(command);
        // The actual reducer owns intermediate semantics. Do not canonicalize or advance revisions
        // between operations: the real batch also canonicalizes only once, after all its commands.
        // Staging never invokes policies, consumes command IDs, publishes, or delivers effects.
        if (canStage) {
          try {
            const reduced = reduceWorkspace(staged, command);
            if (reduced.ok) staged = reduced.snapshot;
            else canStage = false;
          } catch {
            // Preserve the full command list; the live runtime owns structural failure handling.
            canStage = false;
          }
        }
      }
      return dispatch({ type: "batch", commands }, { ...guarded, baseRevision });
    },
    undo: () => runtime.undo(),
    redo: () => runtime.redo(),
  });
  actionFacades.set(runtime, actions);
  return actions;
}
