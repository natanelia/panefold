import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  LogicalRect,
  ResolvedLayout,
  ResolvedSplitter,
  SplitLayoutOverride,
} from "@panefold/geometry";
import { revision } from "@panefold/model";
import {
  createFlipPlan,
  createMotionDomDriver,
  MotionCoordinator,
  SurfaceFrameScheduler,
  type MotionDriver,
} from "@panefold/motion";
import { createResizeActor, type ResizeEvent } from "@panefold/protocol-xstate";

import { solveWorkspaceProjectionLayout, type WorkspaceLayoutSolver } from "./geometry";
import { useWorkspaceRuntime, useWorkspaceSnapshot } from "./runtime-context";
import type {
  WorkspaceAnnouncement,
  WorkspaceCommandAdapter,
  WorkspaceCommandOrigin,
  WorkspaceDirection,
  WorkspaceDispatchContext,
  WorkspaceDispatchOutcome,
  WorkspaceGroupView,
  WorkspaceNodeView,
  WorkspacePanelRegistry,
  WorkspacePanelLifecycle,
  WorkspacePanelLifecyclePolicy,
  WorkspacePanelLifecycleReason,
  WorkspacePanelView,
  WorkspaceProjection,
  WorkspaceProjector,
  WorkspaceRuntimeLike,
  WorkspaceResultInterpreter,
  WorkspaceSplitView,
} from "./types";

type MotionProfile = "off" | "reduced" | "productive";

export interface WorkspaceSurfaceProps<TSnapshot, TCommand, TResult> {
  readonly projector: WorkspaceProjector<TSnapshot>;
  readonly commands: WorkspaceCommandAdapter<TCommand>;
  readonly panels: WorkspacePanelRegistry;
  readonly direction?: WorkspaceDirection;
  readonly motion?: MotionProfile;
  readonly className?: string;
  readonly workspaceLabel?: string;
  /** Experimental model-aware geometry bridge. */
  readonly layoutSolver?: WorkspaceLayoutSolver<TSnapshot>;
  /** Deterministic logical bounds, primarily for embedded and test surfaces. */
  readonly layoutBounds?: LogicalRect;
  readonly splitterSize?: number;
  /** Experimental injection points used by adapter certification fixtures. */
  readonly motionDriver?: MotionDriver;
  readonly frameScheduler?: SurfaceFrameScheduler;
  readonly onAnnouncement?: (message: string) => void;
  readonly onCommandResult?: (result: TResult) => void;
  readonly interpretResult?: WorkspaceResultInterpreter<TCommand, TResult>;
}

interface PanelBoundaryProps {
  readonly panel: WorkspacePanelView;
  readonly children: ReactNode;
}

interface PanelBoundaryState {
  readonly error: Error | undefined;
}

class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  public override state: PanelBoundaryState = { error: undefined };

  public static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error };
  }

  public override render() {
    if (this.state.error !== undefined) {
      return (
        <section className="pf-panel-error" role="alert">
          <strong>{this.props.panel.title} could not be rendered</strong>
          <p>The workspace is still safe. Retry or close this panel.</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: undefined });
            }}
          >
            Retry
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

interface HostRecord {
  readonly element: HTMLDivElement;
  readonly panelId: string;
}

interface DispatchExecution<TResult> {
  readonly result: TResult;
  readonly outcome: WorkspaceDispatchOutcome;
}

interface SurfaceRendererProps<TSnapshot, TCommand, TResult> extends WorkspaceSurfaceProps<
  TSnapshot,
  TCommand,
  TResult
> {
  readonly runtime: WorkspaceRuntimeLike<TSnapshot, TCommand, TResult>;
}

export function WorkspaceSurface<TSnapshot, TCommand, TResult>(
  props: WorkspaceSurfaceProps<TSnapshot, TCommand, TResult>,
) {
  const runtime = useWorkspaceRuntime<TSnapshot, TCommand, TResult>();
  return <SurfaceRenderer {...props} runtime={runtime} />;
}

function SurfaceRenderer<TSnapshot, TCommand, TResult>({
  runtime,
  projector,
  commands,
  panels,
  direction = "ltr",
  motion = "productive",
  className,
  workspaceLabel = "Workspace",
  layoutSolver,
  layoutBounds,
  splitterSize = 6,
  motionDriver,
  frameScheduler,
  onAnnouncement,
  onCommandResult,
  interpretResult,
}: SurfaceRendererProps<TSnapshot, TCommand, TResult>) {
  const snapshot = useWorkspaceSnapshot<TSnapshot, TCommand, TResult>();
  const projection = useMemo(() => projector(snapshot), [projector, snapshot]);
  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceInstanceId = useId();
  const domIdPrefix = `pf-${encodeDomId(workspaceInstanceId)}`;
  const parkingRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef(new Map<string, HTMLDivElement>());
  const hostsRef = useRef(new Map<string, HostRecord>());
  const [portalHosts, setPortalHosts] = useState<ReadonlyMap<string, HostRecord>>(() => new Map());
  const [announcement, setAnnouncement] = useState<WorkspaceAnnouncement>({
    id: 0,
    message: "",
  });
  const [movePanelId, setMovePanelId] = useState<string>();
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [measuredBounds, setMeasuredBounds] = useState<LogicalRect>(ZERO_LOGICAL_RECT);
  const [splitOverrides, setSplitOverrides] = useState<
    Readonly<Record<string, SplitLayoutOverride>>
  >({});
  const splitOverridesRef = useRef(splitOverrides);
  const effectiveMotion = motion === "productive" && systemReducedMotion ? "reduced" : motion;
  const logicalBounds = layoutBounds ?? measuredBounds;
  const surfaceScheduleKey = `${domIdPrefix}:geometry`;
  const scheduler = useMemo(
    () => frameScheduler ?? createBrowserFrameScheduler(),
    [frameScheduler],
  );
  const motionCoordinator = useMemo(
    () => new MotionCoordinator(motionDriver ?? createMotionDomDriver(), "productive"),
    [motionDriver],
  );

  const solveResolvedLayout = useCallback(
    (overrides: Readonly<Record<string, SplitLayoutOverride>>) => {
      const request = {
        projection,
        rootNodeId: projection.rootNodeId,
        bounds: logicalBounds,
        splitterSize,
        splitOverrides: overrides,
      };
      return (
        layoutSolver?.(snapshot, request) ??
        solveWorkspaceProjectionLayout(projection, logicalBounds, {
          splitterSize,
          splitOverrides: overrides,
        })
      );
    },
    [layoutSolver, logicalBounds, projection, snapshot, splitterSize],
  );
  const resolvedLayout = useMemo(
    () => solveResolvedLayout(splitOverrides),
    [solveResolvedLayout, splitOverrides],
  );

  const previewSplit = useCallback(
    (splitId: string, weights: readonly number[]) => {
      const nextOverrides = {
        ...splitOverridesRef.current,
        [splitId]: { weights },
      };
      splitOverridesRef.current = nextOverrides;
      setSplitOverrides(nextOverrides);
      return solveResolvedLayout(nextOverrides);
    },
    [solveResolvedLayout],
  );

  const clearSplitPreview = useCallback((splitId: string) => {
    if (splitOverridesRef.current[splitId] === undefined) return;
    const nextOverrides = { ...splitOverridesRef.current };
    delete nextOverrides[splitId];
    splitOverridesRef.current = nextOverrides;
    setSplitOverrides(nextOverrides);
  }, []);

  const announce = useCallback(
    (message: string) => {
      setAnnouncement((current) => ({ id: current.id + 1, message }));
      onAnnouncement?.(message);
    },
    [onAnnouncement],
  );

  useEffect(() => {
    const ownerWindow = rootRef.current?.ownerDocument.defaultView;
    if (ownerWindow === undefined || ownerWindow === null) return;
    const media = ownerWindow.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media === undefined) return;
    const update = () => {
      setSystemReducedMotion(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  useLayoutEffect(() => {
    if (layoutBounds !== undefined) return;
    const element = rootRef.current;
    const ownerWindow = element?.ownerDocument.defaultView;
    if (element === null || ownerWindow === undefined || ownerWindow === null) return;

    const updateBounds = (inlineSize: number, blockSize: number) => {
      const next = {
        inlineStart: 0,
        blockStart: 0,
        inlineSize: Math.max(0, Math.round(inlineSize)),
        blockSize: Math.max(0, Math.round(blockSize)),
      };
      setMeasuredBounds((current) => (sameLogicalRect(current, next) ? current : next));
    };
    const measured = element.getBoundingClientRect();
    updateBounds(measured.width, measured.height);

    const Observer = ownerWindow.ResizeObserver;
    if (Observer === undefined) return;
    const observer = new Observer(([entry]) => {
      if (entry !== undefined) updateBounds(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [layoutBounds]);

  useEffect(
    () => () => {
      scheduler.cancel(surfaceScheduleKey);
    },
    [scheduler, surfaceScheduleKey],
  );

  useEffect(() => {
    motionCoordinator.setProfile(effectiveMotion);
  }, [effectiveMotion, motionCoordinator]);

  useEffect(
    () => () => {
      motionCoordinator.cancelAll();
    },
    [motionCoordinator],
  );

  const previousLayoutRef = useRef<ResolvedLayout | undefined>(undefined);
  const previousRevisionRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const previousLayout = previousLayoutRef.current;
    const previousRevision = previousRevisionRef.current;
    previousLayoutRef.current = resolvedLayout;
    previousRevisionRef.current = projection.revision;
    if (previousLayout === undefined || previousRevision === projection.revision) return;

    const workspace = rootRef.current;
    if (workspace === null) return;
    motionCoordinator.cancelScope(domIdPrefix);
    const elements = workspace.querySelectorAll<HTMLElement>("[data-workspace-node]");
    for (const element of elements) {
      const nodeId = element.dataset.workspaceNode;
      if (nodeId === undefined) continue;
      const before = previousLayout.nodeRects[nodeId];
      const after = resolvedLayout.nodeRects[nodeId];
      if (before === undefined || after === undefined || sameLogicalRect(before, after)) continue;
      motionCoordinator.play(
        element,
        createFlipPlan({
          targetId: nodeId,
          scopeId: domIdPrefix,
          before: logicalRectToPhysical(before, logicalBounds, direction),
          after: logicalRectToPhysical(after, logicalBounds, direction),
          strategy: "translate-and-clip",
        }),
      );
    }
  }, [
    direction,
    domIdPrefix,
    logicalBounds,
    motionCoordinator,
    projection.revision,
    resolvedLayout,
  ]);

  useEffect(() => {
    if (Object.keys(splitOverridesRef.current).length === 0) return;
    splitOverridesRef.current = {};
    setSplitOverrides({});
    scheduler.cancel(surfaceScheduleKey);
  }, [projection.revision, scheduler, surfaceScheduleKey]);

  useLayoutEffect(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;

    let changed = false;
    const livePanelIds = new Set(Object.keys(projection.panels));

    for (const panelId of livePanelIds) {
      if (hostsRef.current.has(panelId)) continue;
      const element = ownerDocument.createElement("div");
      element.className = "pf-panel-host";
      element.dataset.workspacePanelHost = panelId;
      element.id = panelContentId(domIdPrefix, panelId);
      element.setAttribute("role", "tabpanel");
      hostsRef.current.set(panelId, { element, panelId });
      parkingRef.current?.append(element);
      changed = true;
    }

    for (const [panelId, host] of hostsRef.current) {
      if (livePanelIds.has(panelId)) continue;
      host.element.remove();
      hostsRef.current.delete(panelId);
      changed = true;
    }

    if (changed) setPortalHosts(new Map(hostsRef.current));
  }, [domIdPrefix, projection.panels]);

  useLayoutEffect(() => {
    const selectedPanelIds = new Set(
      Object.values(projection.groups).map((group) => group.selectedPanelId),
    );

    for (const [panelId, host] of portalHosts) {
      const panel = projection.panels[panelId];
      const selectedGroup = Object.values(projection.groups).find(
        (group) => group.selectedPanelId === panelId,
      );
      const destination =
        selectedGroup === undefined ? parkingRef.current : slotsRef.current.get(selectedGroup.id);

      if (destination !== undefined && destination !== null) {
        destination.append(host.element);
      }

      const selected = selectedPanelIds.has(panelId);
      const policy = panelLifecyclePolicy(panel);
      updateStableHost(host.element, {
        active: projection.activePanelId === panelId,
        lifecycle: panelLifecycle(selected, projection.activePanelId === panelId, policy),
        labelledBy: panelTabId(domIdPrefix, panelId),
        panelType: panel?.type,
        selected,
      });
    }
  }, [domIdPrefix, portalHosts, projection]);

  const resolveOutcome = useCallback(
    (result: TResult, context: WorkspaceDispatchContext<TCommand>) =>
      interpretResult?.(result, context) ?? defaultResultInterpreter(result, context),
    [interpretResult],
  );

  const dispatch = useCallback(
    (command: TCommand, label: string, origin: WorkspaceCommandOrigin) => {
      const context = { command, label, origin } satisfies WorkspaceDispatchContext<TCommand>;
      const result = runtime.dispatch(command, { label, origin });
      const outcome = resolveOutcome(result, context);
      onCommandResult?.(result);
      if (outcome.message !== undefined) announce(outcome.message);
      return { result, outcome } satisfies DispatchExecution<TResult>;
    },
    [announce, onCommandResult, resolveOutcome, runtime],
  );

  const commitSplit = useCallback(
    (splitId: string, weights: readonly number[], origin: "keyboard" | "pointer") => {
      const execution = dispatch(
        commands.resizeSplit(splitId, weights),
        "Resized workspace panes",
        origin,
      );
      clearSplitPreview(splitId);
      return execution;
    },
    [clearSplitPreview, commands, dispatch],
  );

  const selectPanel = useCallback(
    (panel: WorkspacePanelView, focusTab = false, origin: WorkspaceCommandOrigin = "keyboard") => {
      dispatch(commands.selectPanel(panel.id), `Selected ${panel.title}`, origin);
      if (focusTab) {
        queueMicrotask(() => {
          rootRef.current?.ownerDocument.getElementById(panelTabId(domIdPrefix, panel.id))?.focus();
        });
      }
    },
    [commands, dispatch, domIdPrefix],
  );

  const closePanel = useCallback(
    (panel: WorkspacePanelView, origin: WorkspaceCommandOrigin) => {
      const ownerDocument = rootRef.current?.ownerDocument;
      const activeElement = ownerDocument?.activeElement;
      const tab = ownerDocument?.getElementById(panelTabId(domIdPrefix, panel.id));
      const controls = ownerDocument?.getElementById(panelControlsId(domIdPrefix, panel.id));
      const host = ownerDocument?.getElementById(panelContentId(domIdPrefix, panel.id));
      const hadFocus =
        activeElement !== null &&
        activeElement !== undefined &&
        (tab?.contains(activeElement) === true ||
          controls?.contains(activeElement) === true ||
          host?.contains(activeElement) === true);
      const successorPanelId = findFocusSuccessor(projection, panel.id);
      const execution = dispatch(commands.closePanel(panel.id), `Closed ${panel.title}`, origin);

      if (hadFocus && execution.outcome.status === "committed") {
        queueMicrotask(() => {
          const workspace = rootRef.current;
          if (workspace === null) return;
          const successor =
            successorPanelId === undefined
              ? undefined
              : workspace.ownerDocument.getElementById(panelTabId(domIdPrefix, successorPanelId));
          (successor ?? workspace).focus();
        });
      }
    },
    [commands, dispatch, domIdPrefix, projection],
  );

  const restoreMoveTrigger = useCallback(
    (panelId: string) => {
      queueMicrotask(() => {
        const workspace = rootRef.current;
        if (workspace === null) return;
        const trigger = workspace.ownerDocument.getElementById(
          panelActionsId(domIdPrefix, panelId),
        );
        (trigger ?? workspace).focus();
      });
    },
    [domIdPrefix],
  );

  const node = projection.nodes[projection.rootNodeId];

  return (
    <div
      ref={rootRef}
      className={["pf-workspace", className].filter(Boolean).join(" ")}
      data-direction={direction}
      data-motion={motion}
      data-effective-motion={effectiveMotion}
      data-geometry-diagnostics={resolvedLayout.diagnostics.length}
      data-geometry-mode={layoutSolver === undefined ? "projection" : "model"}
      dir={direction}
      aria-label={workspaceLabel}
      tabIndex={-1}
    >
      <div className="pf-semantic-layer" data-workspace-layer="chrome">
        {node === undefined ? (
          <WorkspaceEmptyState />
        ) : (
          <LayoutNode
            node={node}
            projection={projection}
            panels={panels}
            commands={commands}
            direction={direction}
            domIdPrefix={domIdPrefix}
            resolvedLayout={resolvedLayout}
            splitOverrides={splitOverrides}
            projectionRevision={projection.revision}
            scheduler={scheduler}
            scheduleKey={surfaceScheduleKey}
            previewSplit={previewSplit}
            commitSplit={commitSplit}
            clearSplitPreview={clearSplitPreview}
            dispatch={dispatch}
            selectPanel={selectPanel}
            closePanel={closePanel}
            registerSlot={(groupId, element) => {
              if (element === null) slotsRef.current.delete(groupId);
              else slotsRef.current.set(groupId, element);
            }}
            movePanelId={movePanelId}
            setMovePanelId={setMovePanelId}
          />
        )}
      </div>

      <div
        ref={parkingRef}
        className="pf-content-parking"
        data-workspace-layer="stable-content"
        aria-hidden="true"
      />

      <div className="pf-overlay-layer" data-workspace-layer="overlay">
        {movePanelId !== undefined ? (
          <KeyboardMoveOverlay
            panel={projection.panels[movePanelId]}
            groups={Object.values(projection.groups)}
            onMove={(groupId) => {
              const panelId = movePanelId;
              const panel = projection.panels[movePanelId];
              if (commands.movePanel !== undefined && panel !== undefined) {
                dispatch(
                  commands.movePanel(movePanelId, groupId),
                  `Moved ${panel.title} to ${projection.groups[groupId]?.label ?? "group"}`,
                  "keyboard",
                );
              }
              setMovePanelId(undefined);
              restoreMoveTrigger(panelId);
            }}
            onCancel={() => {
              const panelId = movePanelId;
              setMovePanelId(undefined);
              announce("Move cancelled");
              restoreMoveTrigger(panelId);
            }}
          />
        ) : null}
      </div>

      <PanelPortals projection={projection} registry={panels} hosts={portalHosts} />

      <div
        key={announcement.id}
        className="pf-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement.message}
      </div>
    </div>
  );
}

interface LayoutNodeProps<TCommand, TResult> {
  readonly node: WorkspaceNodeView;
  readonly projection: WorkspaceProjection;
  readonly panels: WorkspacePanelRegistry;
  readonly commands: WorkspaceCommandAdapter<TCommand>;
  readonly direction: WorkspaceDirection;
  readonly domIdPrefix: string;
  readonly resolvedLayout: ResolvedLayout;
  readonly splitOverrides: Readonly<Record<string, SplitLayoutOverride>>;
  readonly projectionRevision: string;
  readonly scheduler: SurfaceFrameScheduler;
  readonly scheduleKey: string;
  readonly previewSplit: (splitId: string, weights: readonly number[]) => ResolvedLayout;
  readonly commitSplit: (
    splitId: string,
    weights: readonly number[],
    origin: "keyboard" | "pointer",
  ) => DispatchExecution<TResult>;
  readonly clearSplitPreview: (splitId: string) => void;
  readonly dispatch: (
    command: TCommand,
    label: string,
    origin: WorkspaceCommandOrigin,
  ) => DispatchExecution<TResult>;
  readonly selectPanel: (
    panel: WorkspacePanelView,
    focusTab?: boolean,
    origin?: WorkspaceCommandOrigin,
  ) => void;
  readonly closePanel: (panel: WorkspacePanelView, origin: WorkspaceCommandOrigin) => void;
  readonly registerSlot: (groupId: string, element: HTMLDivElement | null) => void;
  readonly movePanelId: string | undefined;
  readonly setMovePanelId: (panelId: string | undefined) => void;
}

function LayoutNode<TCommand, TResult>(props: LayoutNodeProps<TCommand, TResult>) {
  if (props.node.kind === "group") {
    const group = props.projection.groups[props.node.groupId];
    return group === undefined ? null : (
      <PanelGroup {...props} group={group} nodeId={props.node.id} />
    );
  }

  return <SplitNode {...props} split={props.node} />;
}

function SplitNode<TCommand, TResult>({
  split,
  ...props
}: Omit<LayoutNodeProps<TCommand, TResult>, "node"> & {
  readonly split: WorkspaceSplitView;
}) {
  const weights = props.splitOverrides[split.id]?.weights ?? split.weights;
  const splitters = props.resolvedLayout.splitters.filter(
    (splitter) => splitter.splitNodeId === split.id,
  );

  return (
    <div
      className="pf-split"
      data-axis={split.axis}
      data-workspace-split={split.id}
      data-workspace-node={split.id}
    >
      {split.childIds.map((childId) => {
        const child = props.projection.nodes[childId];
        if (child === undefined) return null;
        const childRect = props.resolvedLayout.nodeRects[childId] ?? ZERO_LOGICAL_RECT;
        const precedingSplitter = splitters.find((item) => item.afterNodeId === childId);
        const beforeIndex =
          precedingSplitter === undefined
            ? -1
            : split.childIds.indexOf(precedingSplitter.beforeNodeId);
        const afterIndex = split.childIds.indexOf(childId);

        return (
          <Fragment key={childId}>
            {precedingSplitter !== undefined && beforeIndex >= 0 && afterIndex >= 0 ? (
              <Splitter
                split={split}
                splitter={precedingSplitter}
                beforeIndex={beforeIndex}
                afterIndex={afterIndex}
                weights={weights}
                direction={props.direction}
                resolvedLayout={props.resolvedLayout}
                projectionRevision={props.projectionRevision}
                scheduler={props.scheduler}
                scheduleKey={props.scheduleKey}
                onPreview={(nextWeights) => props.previewSplit(split.id, nextWeights)}
                onCommit={(nextWeights, origin) => props.commitSplit(split.id, nextWeights, origin)}
                onCancel={() => props.clearSplitPreview(split.id)}
              />
            ) : null}
            <div
              className="pf-split-child"
              data-inline-size={childRect.inlineSize}
              data-block-size={childRect.blockSize}
              style={
                {
                  "--pf-split-size": `${
                    split.axis === "inline" ? childRect.inlineSize : childRect.blockSize
                  }px`,
                } as CSSProperties
              }
            >
              <LayoutNode {...props} node={child} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

interface SplitterProps {
  readonly split: WorkspaceSplitView;
  readonly splitter: ResolvedSplitter;
  readonly beforeIndex: number;
  readonly afterIndex: number;
  readonly weights: readonly number[];
  readonly direction: WorkspaceDirection;
  readonly resolvedLayout: ResolvedLayout;
  readonly projectionRevision: string;
  readonly scheduler: SurfaceFrameScheduler;
  readonly scheduleKey: string;
  readonly onPreview: (weights: readonly number[]) => ResolvedLayout;
  readonly onCommit: (
    weights: readonly number[],
    origin: "keyboard" | "pointer",
  ) => DispatchExecution<unknown>;
  readonly onCancel: () => void;
}

function Splitter({
  split,
  splitter,
  beforeIndex,
  afterIndex,
  weights,
  direction,
  resolvedLayout,
  projectionRevision,
  scheduler,
  scheduleKey,
  onPreview,
  onCommit,
  onCancel,
}: SplitterProps) {
  const splitterRef = useRef<HTMLDivElement>(null);
  const [actor] = useState(createResizeActor);
  const [resizeState, setResizeState] = useState("idle");
  const sessionRef = useRef<PointerResizeSession | null>(null);
  const handledRevisionRef = useRef(projectionRevision);
  const beforeSize = axisSize(resolvedLayout.nodeRects[splitter.beforeNodeId], split.axis);
  const afterSize = axisSize(resolvedLayout.nodeRects[splitter.afterNodeId], split.axis);
  const pairSize = beforeSize + afterSize;
  const value = pairSize === 0 ? 50 : (beforeSize / pairSize) * 100;

  useEffect(() => {
    const subscription = actor.subscribe((state) => {
      setResizeState(String(state.value));
    });
    actor.start();
    return () => {
      subscription.unsubscribe();
      actor.stop();
    };
  }, [actor]);

  const send = useCallback(
    (event: ResizeEvent) => {
      actor.send(event);
      const state = String(actor.getSnapshot().value);
      setResizeState(state);
      return state;
    },
    [actor],
  );

  useEffect(() => {
    if (handledRevisionRef.current === projectionRevision) return;
    handledRevisionRef.current = projectionRevision;
    if (String(actor.getSnapshot().value) === "idle") return;
    scheduler.cancel(scheduleKey);
    sessionRef.current = null;
    actor.send({ type: "CANCEL" });
    const state = String(actor.getSnapshot().value);
    onCancel();
    if (state === "cancelling") actor.send({ type: "RETURNED" });
  }, [actor, onCancel, projectionRevision, scheduleKey, scheduler]);

  const updatePair = useCallback(
    (
      logicalDelta: number,
      baseWeights: readonly number[],
      baseBeforeSize: number,
      baseAfterSize: number,
    ) => {
      const before = positiveNumber(baseWeights[beforeIndex]);
      const after = positiveNumber(baseWeights[afterIndex]);
      const total = before + after;
      const available = Math.max(1, baseBeforeSize + baseAfterSize);
      const minimum = Math.min(total / 2, Math.max(total * 0.000001, 0.000001));
      const nextBefore = clamp(
        before + (logicalDelta / available) * total,
        minimum,
        total - minimum,
      );
      const next = [...baseWeights];
      next[beforeIndex] = nextBefore;
      next[afterIndex] = total - nextBefore;
      return next;
    },
    [afterIndex, beforeIndex],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || sessionRef.current !== null) return;
    const coordinate = split.axis === "inline" ? event.clientX : event.clientY;
    sessionRef.current = {
      pointerId: event.pointerId,
      startCoordinate: coordinate,
      beforeSize,
      afterSize,
      weights: [...weights],
      latest: [...weights],
      captureElement: event.currentTarget,
    };
    send({
      type: "POINTER_START",
      pointerId: event.pointerId,
      position: pointerSample(event),
      baseRevision: safeRevision(projectionRevision),
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    send({
      type: "POINTER_MOVE",
      pointerId: event.pointerId,
      position: pointerSample(event),
    });
    const coordinate = split.axis === "inline" ? event.clientX : event.clientY;
    const physicalDelta = coordinate - session.startCoordinate;
    const logicalDelta =
      split.axis === "inline" && direction === "rtl" ? -physicalDelta : physicalDelta;
    const next = updatePair(logicalDelta, session.weights, session.beforeSize, session.afterSize);
    session.latest = next;
    const applyPreview = () => {
      const preview = onPreview(next);
      const position = splitterPosition(preview, splitter.id);
      if (position !== undefined && String(actor.getSnapshot().value) === "resizing") {
        send({ type: "CONSTRAINT_RESULT", position });
      }
    };
    if (!scheduler.schedule(scheduleKey, applyPreview)) applyPreview();
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    const state = send({ type: "POINTER_END", pointerId: event.pointerId });
    scheduler.cancel(scheduleKey);
    sessionRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (state !== "committing") {
      onCancel();
      return;
    }
    settleCommit(onCommit(session.latest, "pointer").outcome, send);
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    scheduler.cancel(scheduleKey);
    sessionRef.current = null;
    const state = send({
      type: event.type === "lostpointercapture" ? "CAPTURE_LOST" : "POINTER_CANCEL",
      pointerId: event.pointerId,
    });
    onCancel();
    if (state === "cancelling") send({ type: "RETURNED" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && sessionRef.current !== null) {
      event.preventDefault();
      const session = sessionRef.current;
      scheduler.cancel(scheduleKey);
      sessionRef.current = null;
      const state = send({ type: "CANCEL" });
      onCancel();
      if (session.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      if (state === "cancelling") send({ type: "RETURNED" });
      return;
    }
    if (String(actor.getSnapshot().value) !== "idle") return;
    const negativeKeys = split.axis === "inline" ? ["ArrowLeft"] : ["ArrowUp"];
    const positiveKeys = split.axis === "inline" ? ["ArrowRight"] : ["ArrowDown"];
    let delta = 0;
    if (negativeKeys.includes(event.key)) delta = -1;
    if (positiveKeys.includes(event.key)) delta = 1;
    if (delta === 0) return;
    if (split.axis === "inline" && direction === "rtl") delta *= -1;
    event.preventDefault();
    const step = Math.max(1, pairSize) * (event.shiftKey ? 0.1 : 0.02) * delta;
    const currentPosition = splitterPosition(resolvedLayout, splitter.id) ?? {
      inline: splitter.rect.inlineStart,
      block: splitter.rect.blockStart,
    };
    send({
      type: "KEYBOARD_START",
      position: currentPosition,
      baseRevision: safeRevision(projectionRevision),
    });
    const nextPosition =
      split.axis === "inline"
        ? { ...currentPosition, inline: currentPosition.inline + step }
        : { ...currentPosition, block: currentPosition.block + step };
    send({ type: "KEYBOARD_STEP", position: nextPosition });
    const next = updatePair(step, weights, beforeSize, afterSize);
    const preview = onPreview(next);
    const constrained = splitterPosition(preview, splitter.id);
    if (constrained !== undefined) send({ type: "CONSTRAINT_RESULT", position: constrained });
    send({ type: "COMMIT" });
    settleCommit(onCommit(next, "keyboard").outcome, send);
  };

  return (
    <div
      ref={splitterRef}
      className="pf-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize adjacent workspace panes"
      aria-orientation={split.axis === "inline" ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`Primary pane ${Math.round(value)} percent`}
      data-resize-state={resizeState}
      data-workspace-splitter={splitter.id}
      data-inline-start={splitter.rect.inlineStart}
      data-block-start={splitter.rect.blockStart}
      style={
        {
          "--pf-splitter-size": `${axisSize(splitter.rect, split.axis)}px`,
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      onKeyDown={onKeyDown}
    >
      <span className="pf-splitter-line" aria-hidden="true" />
    </div>
  );
}

interface PanelGroupProps<TCommand, TResult> extends Omit<
  LayoutNodeProps<TCommand, TResult>,
  "node"
> {
  readonly group: WorkspaceGroupView;
  readonly nodeId: string;
}

function PanelGroup<TCommand, TResult>({
  group,
  nodeId,
  projection,
  panels,
  commands,
  direction,
  domIdPrefix,
  dispatch,
  selectPanel,
  closePanel,
  registerSlot,
  setMovePanelId,
}: PanelGroupProps<TCommand, TResult>) {
  const pointerFocusPanelRef = useRef<string | undefined>(undefined);
  const groupLabelId = useId();
  const groupPanels = group.panelIds
    .map((id) => projection.panels[id])
    .filter((panel): panel is WorkspacePanelView => panel !== undefined);
  const selectedPanel = groupPanels.find((panel) => panel.id === group.selectedPanelId);
  const createMovePanelCommand = commands.movePanel;
  const createFloatPanelCommand = commands.floatPanel;

  const navigateTabs = (event: KeyboardEvent, currentIndex: number) => {
    const visualPrevious = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
    const visualNext = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    let nextIndex: number | undefined;
    if (event.key === visualPrevious) nextIndex = currentIndex - 1;
    if (event.key === visualNext) nextIndex = currentIndex + 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = groupPanels.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const wrapped = (nextIndex + groupPanels.length) % groupPanels.length;
    const panel = groupPanels[wrapped];
    if (panel !== undefined) selectPanel(panel, true, "keyboard");
  };

  return (
    <section
      className="pf-group"
      data-workspace-node={nodeId}
      data-workspace-group={group.id}
      data-active={String(group.panelIds.includes(projection.activePanelId ?? ""))}
      aria-labelledby={groupLabelId}
    >
      <h2 id={groupLabelId} className="pf-visually-hidden">
        {group.label ?? "Panel group"}
      </h2>
      <div className="pf-tab-strip">
        <div className="pf-tab-list" role="tablist" aria-label={group.label}>
          {groupPanels.map((panel, index) => {
            const selected = group.selectedPanelId === panel.id;
            const definition = panels[panel.type];
            return (
              <button
                key={panel.id}
                id={panelTabId(domIdPrefix, panel.id)}
                className="pf-tab"
                type="button"
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls={panelContentId(domIdPrefix, panel.id)}
                title={panel.title}
                data-workspace-panel-tab={panel.id}
                onClick={(event) => {
                  selectPanel(panel, false, clickOrigin(event));
                }}
                onPointerDown={() => {
                  pointerFocusPanelRef.current = panel.id;
                }}
                onFocus={() => {
                  const origin = pointerFocusPanelRef.current === panel.id ? "pointer" : "keyboard";
                  pointerFocusPanelRef.current = undefined;
                  if (selected && projection.activePanelId !== panel.id) {
                    dispatch(commands.activatePanel(panel.id), `Activated ${panel.title}`, origin);
                  }
                }}
                onKeyDown={(event) => {
                  navigateTabs(event, index);
                  if (event.key === "Delete" && panel.closable !== false) {
                    event.preventDefault();
                    closePanel(panel, "keyboard");
                  }
                }}
              >
                {definition?.icon === undefined ? null : (
                  <span className="pf-tab-icon" aria-hidden="true">
                    {definition.icon}
                  </span>
                )}
                <span className="pf-tab-title" dir="auto">
                  {panel.title}
                </span>
              </button>
            );
          })}
        </div>
        {selectedPanel === undefined ||
        (selectedPanel.closable === false &&
          createMovePanelCommand === undefined &&
          createFloatPanelCommand === undefined) ? null : (
          <div
            id={panelControlsId(domIdPrefix, selectedPanel.id)}
            className="pf-tab-controls"
            data-workspace-panel-controls={selectedPanel.id}
          >
            {selectedPanel.closable === false ? null : (
              <button
                className="pf-tab-close"
                type="button"
                aria-label={`Close ${selectedPanel.title}`}
                title={`Close ${selectedPanel.title}`}
                onClick={(event) => {
                  closePanel(selectedPanel, clickOrigin(event));
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
            {createMovePanelCommand === undefined &&
            createFloatPanelCommand === undefined ? null : (
              <TabActions
                panel={selectedPanel}
                groups={Object.values(projection.groups)}
                triggerId={panelActionsId(domIdPrefix, selectedPanel.id)}
                onStartKeyboardMove={
                  createMovePanelCommand === undefined
                    ? undefined
                    : () => {
                        setMovePanelId(selectedPanel.id);
                      }
                }
                onMove={
                  createMovePanelCommand === undefined
                    ? undefined
                    : (targetGroupId) => {
                        dispatch(
                          createMovePanelCommand(selectedPanel.id, targetGroupId),
                          `Moved ${selectedPanel.title}`,
                          "menu",
                        );
                      }
                }
                onFloat={
                  createFloatPanelCommand === undefined
                    ? undefined
                    : () => {
                        dispatch(
                          createFloatPanelCommand(selectedPanel.id),
                          `Floated ${selectedPanel.title}`,
                          "menu",
                        );
                      }
                }
              />
            )}
          </div>
        )}
      </div>
      <div
        ref={(element) => {
          registerSlot(group.id, element);
        }}
        className="pf-panel-slot"
        data-workspace-panel-slot={group.id}
      />
    </section>
  );
}

interface TabActionsProps {
  readonly panel: WorkspacePanelView;
  readonly groups: readonly WorkspaceGroupView[];
  readonly triggerId: string;
  readonly onStartKeyboardMove: (() => void) | undefined;
  readonly onMove: ((groupId: string) => void) | undefined;
  readonly onFloat: (() => void) | undefined;
}

function TabActions({
  panel,
  groups,
  triggerId,
  onStartKeyboardMove,
  onMove,
  onFloat,
}: TabActionsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [open]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    queueMicrotask(() => {
      triggerRef.current?.focus();
    });
  };

  return (
    <div className="pf-tab-actions">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="pf-tab-more"
        aria-label={`Actions for ${panel.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            closeAndRestoreFocus();
          }
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="pf-menu"
          role="menu"
          aria-label={`${panel.title} actions`}
          onKeyDown={(event) => {
            const items = menuItems(menuRef.current);
            const activeElement = menuRef.current?.ownerDocument.activeElement;
            const currentIndex = items.findIndex((item) => item === activeElement);
            let nextIndex: number | undefined;
            if (event.key === "ArrowDown") {
              nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
            }
            if (event.key === "ArrowUp") {
              nextIndex = currentIndex < 0 ? items.length - 1 : currentIndex - 1;
            }
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = items.length - 1;
            if (event.key === "Escape") {
              event.preventDefault();
              closeAndRestoreFocus();
              return;
            }
            if (nextIndex === undefined || items.length === 0) return;
            event.preventDefault();
            items[(nextIndex + items.length) % items.length]?.focus();
          }}
        >
          {onStartKeyboardMove === undefined || onMove === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onStartKeyboardMove();
              }}
            >
              Choose destination…
            </button>
          )}
          {onMove === undefined
            ? null
            : groups.map((group) => (
                <button
                  key={group.id}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onMove(group.id);
                  }}
                >
                  Move to {group.label ?? "group"}
                </button>
              ))}
          {panel.floatable === false || onFloat === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onFloat();
              }}
            >
              Float panel
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface KeyboardMoveOverlayProps {
  readonly panel: WorkspacePanelView | undefined;
  readonly groups: readonly WorkspaceGroupView[];
  readonly onMove: (groupId: string) => void;
  readonly onCancel: () => void;
}

function KeyboardMoveOverlay({ panel, groups, onMove, onCancel }: KeyboardMoveOverlayProps) {
  const [index, setIndex] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const selectedGroup = groups[index];
  return (
    <div
      ref={overlayRef}
      className="pf-keyboard-move"
      role="dialog"
      aria-label={`Move ${panel?.title ?? "panel"}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          setIndex((value) => (value + 1) % groups.length);
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          setIndex((value) => (value - 1 + groups.length) % groups.length);
        }
        if (event.key === "Enter" && selectedGroup !== undefined) {
          event.preventDefault();
          onMove(selectedGroup.id);
        }
      }}
    >
      <p className="pf-keyboard-move-eyebrow">Choose destination</p>
      <strong>{selectedGroup?.label ?? "No available group"}</strong>
      <p>Use arrow keys to preview, Enter to move, or Escape to cancel.</p>
      <div className="pf-keyboard-move-dots" aria-hidden="true">
        {groups.map((group, groupIndex) => (
          <span key={group.id} data-current={String(groupIndex === index)} />
        ))}
      </div>
    </div>
  );
}

interface PanelPortalsProps {
  readonly projection: WorkspaceProjection;
  readonly registry: WorkspacePanelRegistry;
  readonly hosts: ReadonlyMap<string, HostRecord>;
}

function PanelPortals({ projection, registry, hosts }: PanelPortalsProps) {
  return (
    <>
      {Object.values(projection.panels).map((panel) => {
        const host = hosts.get(panel.id)?.element;
        const definition = registry[panel.type];
        if (host === undefined) return null;
        const group = Object.values(projection.groups).find((candidate) =>
          candidate.panelIds.includes(panel.id),
        );
        const selected = group?.selectedPanelId === panel.id;
        const active = projection.activePanelId === panel.id;
        const policy = panelLifecyclePolicy(panel);
        const lifecycle = panelLifecycle(selected, active, policy);
        if (!selected && policy.hidden === "detach") return null;
        const content =
          definition === undefined ? (
            <MissingPanel panel={panel} />
          ) : (
            <PanelContent
              definition={definition}
              panel={panel}
              revision={projection.revision}
              groupId={group?.id}
              selected={selected}
              active={active}
              lifecycle={lifecycle}
              policy={policy}
            />
          );

        return createPortal(
          <PanelBoundary key={panel.id} panel={panel}>
            {content}
          </PanelBoundary>,
          host,
          panel.id,
        );
      })}
    </>
  );
}

interface PanelContentProps {
  readonly active: boolean;
  readonly definition: WorkspacePanelRegistry[string];
  readonly lifecycle: WorkspacePanelLifecycle;
  readonly groupId: string | undefined;
  readonly panel: WorkspacePanelView;
  readonly policy: WorkspacePanelLifecyclePolicy;
  readonly revision: string;
  readonly selected: boolean;
}

function PanelContent({
  active,
  definition,
  groupId,
  lifecycle,
  panel,
  policy,
  revision,
  selected,
}: PanelContentProps) {
  const previousLease = useRef<PanelLifecycleLeaseState | undefined>(undefined);
  const leaseIdentity = [
    active,
    groupId ?? "",
    lifecycle,
    policy.crossDocumentMove,
    policy.hidden,
    policy.sameDocumentMove,
    selected,
  ].join(":");
  const controller = useMemo(() => {
    void leaseIdentity;
    return new AbortController();
  }, [leaseIdentity]);
  const notifyLifecycle = useEffectEvent(
    (
      previous: WorkspacePanelLifecycle | undefined,
      reason: WorkspacePanelLifecycleReason,
      signal: AbortSignal,
    ) => {
      definition.onLifecycleChange?.({
        panelId: panel.id,
        revision,
        current: lifecycle,
        ...(previous === undefined ? {} : { previous }),
        reason,
        signal,
        policy,
      });
    },
  );

  useLayoutEffect(() => {
    const currentLease = { active, groupId, lifecycle, policy, selected };
    const reason = lifecycleTransitionReason(previousLease.current, currentLease);
    notifyLifecycle(previousLease.current?.lifecycle, reason, controller.signal);
    previousLease.current = currentLease;
    return () => {
      controller.abort({
        kind: "panefold-panel-lifecycle-ended",
        panelId: panel.id,
        lifecycle,
      });
    };
  }, [
    active,
    controller,
    groupId,
    lifecycle,
    panel.id,
    policy,
    policy.crossDocumentMove,
    policy.hidden,
    policy.sameDocumentMove,
    selected,
  ]);

  return (
    <Fragment key={policy.sameDocumentMove === "remount" ? groupId : "stable-host-content"}>
      <definition.render
        panel={panel}
        selected={selected}
        active={active}
        lifecycle={lifecycle}
        lifecycleSignal={controller.signal}
        lifecyclePolicy={policy}
      />
    </Fragment>
  );
}

function MissingPanel({ panel }: { readonly panel: WorkspacePanelView }) {
  return (
    <section className="pf-panel-placeholder">
      <strong>{panel.title}</strong>
      <p>
        Renderer <code>{panel.type}</code> is unavailable. The panel descriptor and placement remain
        recoverable.
      </p>
    </section>
  );
}

function WorkspaceEmptyState() {
  return (
    <section className="pf-empty-state">
      <strong>No workspace layout</strong>
      <p>Open a panel or restore a workspace preset to begin.</p>
    </section>
  );
}

function panelTabId(prefix: string, panelId: string) {
  return `${prefix}-tab-${encodeDomId(panelId)}`;
}

function panelContentId(prefix: string, panelId: string) {
  return `${prefix}-panel-${encodeDomId(panelId)}`;
}

function panelControlsId(prefix: string, panelId: string) {
  return `${prefix}-controls-${encodeDomId(panelId)}`;
}

function panelActionsId(prefix: string, panelId: string) {
  return `${prefix}-actions-${encodeDomId(panelId)}`;
}

function menuItems(menu: HTMLDivElement | null) {
  if (menu === null) return [];
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
}

function encodeDomId(value: string) {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded || "empty";
}

interface PointerResizeSession {
  readonly pointerId: number;
  readonly startCoordinate: number;
  readonly beforeSize: number;
  readonly afterSize: number;
  readonly weights: readonly number[];
  readonly captureElement: HTMLDivElement;
  latest: readonly number[];
}

const ZERO_LOGICAL_RECT: LogicalRect = Object.freeze({
  inlineStart: 0,
  blockStart: 0,
  inlineSize: 0,
  blockSize: 0,
});

function createBrowserFrameScheduler(): SurfaceFrameScheduler {
  return new SurfaceFrameScheduler({
    requestFrame: (callback) => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        return globalThis.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(
        () => callback(globalThis.performance?.now() ?? Date.now()),
        16,
      ) as unknown as number;
    },
    cancelFrame: (handle) => {
      globalThis.cancelAnimationFrame?.(handle);
      globalThis.clearTimeout(handle);
    },
  });
}

function sameLogicalRect(left: LogicalRect, right: LogicalRect): boolean {
  return (
    left.inlineStart === right.inlineStart &&
    left.blockStart === right.blockStart &&
    left.inlineSize === right.inlineSize &&
    left.blockSize === right.blockSize
  );
}

function logicalRectToPhysical(
  rect: LogicalRect,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
) {
  return {
    x:
      direction === "rtl"
        ? bounds.inlineStart +
          bounds.inlineSize -
          (rect.inlineStart - bounds.inlineStart) -
          rect.inlineSize
        : rect.inlineStart,
    y: rect.blockStart,
    width: rect.inlineSize,
    height: rect.blockSize,
  };
}

function safeRevision(value: string) {
  try {
    return revision(value);
  } catch {
    return revision(0);
  }
}

function pointerSample(event: ReactPointerEvent<HTMLDivElement>) {
  return { inline: event.clientX, block: event.clientY };
}

function splitterPosition(layout: ResolvedLayout, splitterId: string) {
  const resolved = layout.splitters.find((item) => item.id === splitterId);
  return resolved === undefined
    ? undefined
    : { inline: resolved.rect.inlineStart, block: resolved.rect.blockStart };
}

function axisSize(rect: LogicalRect | undefined, axis: WorkspaceSplitView["axis"]): number {
  if (rect === undefined) return 0;
  return axis === "inline" ? rect.inlineSize : rect.blockSize;
}

function positiveNumber(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 1;
}

function settleCommit(
  outcome: WorkspaceDispatchOutcome,
  send: (event: ResizeEvent) => string,
): void {
  if (outcome.status === "committed") {
    send({ type: "COMMIT_OK" });
    send({ type: "SETTLED" });
    return;
  }
  send({
    type: "COMMIT_ERROR",
    message: outcome.message ?? `Resize did not commit (${outcome.status}).`,
  });
  send({ type: "RETURNED" });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function updateStableHost(
  element: HTMLDivElement,
  options: {
    readonly active: boolean;
    readonly lifecycle: WorkspacePanelLifecycle;
    readonly labelledBy: string;
    readonly panelType: string | undefined;
    readonly selected: boolean;
  },
) {
  element.hidden = !options.selected;
  element.inert = !options.selected;
  element.setAttribute("aria-hidden", options.selected ? "false" : "true");
  element.setAttribute("aria-labelledby", options.labelledBy);
  element.dataset.active = String(options.active);
  element.dataset.lifecycle = options.lifecycle;
  if (options.panelType === undefined) delete element.dataset.panelType;
  else element.dataset.panelType = options.panelType;
}

interface PanelLifecycleLeaseState {
  readonly active: boolean;
  readonly groupId: string | undefined;
  readonly lifecycle: WorkspacePanelLifecycle;
  readonly policy: WorkspacePanelLifecyclePolicy;
  readonly selected: boolean;
}

const DEFAULT_PANEL_LIFECYCLE_POLICY: WorkspacePanelLifecyclePolicy = Object.freeze({
  hidden: "suspend",
  sameDocumentMove: "preserve-host",
  crossDocumentMove: "unsupported",
});

function panelLifecyclePolicy(
  panel: WorkspacePanelView | undefined,
): WorkspacePanelLifecyclePolicy {
  return panel?.lifecyclePolicy ?? DEFAULT_PANEL_LIFECYCLE_POLICY;
}

function panelLifecycle(
  selected: boolean,
  active: boolean,
  policy: WorkspacePanelLifecyclePolicy,
): WorkspacePanelLifecycle {
  if (active) return "active";
  if (selected) return "visible";
  return policy.hidden === "keep-alive" || policy.hidden === "application-managed"
    ? "visible"
    : "suspended";
}

function lifecycleTransitionReason(
  previous: PanelLifecycleLeaseState | undefined,
  current: PanelLifecycleLeaseState,
): WorkspacePanelLifecycleReason {
  if (previous === undefined) return "mount";
  if (previous.groupId !== current.groupId) return "same-document-move";
  if (
    previous.policy.hidden !== current.policy.hidden ||
    previous.policy.sameDocumentMove !== current.policy.sameDocumentMove ||
    previous.policy.crossDocumentMove !== current.policy.crossDocumentMove
  ) {
    return "policy-change";
  }
  if (previous.selected !== current.selected) return "selection";
  return "activation";
}

function clickOrigin(event: ReactMouseEvent<HTMLElement>): "keyboard" | "pointer" {
  return event.detail === 0 ? "keyboard" : "pointer";
}

function findFocusSuccessor(
  projection: WorkspaceProjection,
  closingPanelId: string,
): string | undefined {
  const groups = Object.values(projection.groups);
  const groupIndex = groups.findIndex((group) => group.panelIds.includes(closingPanelId));
  const group = groups[groupIndex];
  if (group !== undefined) {
    const panelIndex = group.panelIds.indexOf(closingPanelId);
    const adjacent = group.panelIds[panelIndex + 1] ?? group.panelIds[panelIndex - 1];
    if (adjacent !== undefined && projection.panels[adjacent] !== undefined) {
      return adjacent;
    }
  }

  for (let distance = 1; distance < groups.length; distance += 1) {
    const nextGroup = groups[groupIndex + distance];
    if (nextGroup !== undefined && projection.panels[nextGroup.selectedPanelId] !== undefined) {
      return nextGroup.selectedPanelId;
    }
    const previousGroup = groups[groupIndex - distance];
    if (
      previousGroup !== undefined &&
      projection.panels[previousGroup.selectedPanelId] !== undefined
    ) {
      return previousGroup.selectedPanelId;
    }
  }
  return undefined;
}

function defaultResultInterpreter<TCommand, TResult>(
  result: TResult,
  context: WorkspaceDispatchContext<TCommand>,
): WorkspaceDispatchOutcome {
  if (!isRecord(result)) return { status: "unknown" };
  const status = result.status;
  if (status === "committed") {
    return { status, message: context.label };
  }
  if (status === "queued") {
    return { status, message: `${context.label} queued` };
  }
  if (status === "rejected") {
    const reason = extractErrorMessage(result);
    return {
      status,
      message:
        reason === undefined
          ? `${context.label} was rejected`
          : `${context.label} was rejected. ${reason}`,
    };
  }
  return { status: "unknown" };
}

function extractErrorMessage(receipt: Readonly<Record<string, unknown>>) {
  const directError = receipt.error;
  if (isRecord(directError) && typeof directError.message === "string") {
    return directError.message;
  }
  const nestedResult = receipt.result;
  if (!isRecord(nestedResult)) return undefined;
  const nestedError = nestedResult.error;
  return isRecord(nestedError) && typeof nestedError.message === "string"
    ? nestedError.message
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
