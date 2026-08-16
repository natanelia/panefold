import {
  Component,
  Fragment,
  memo,
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

import {
  FloatingSurfaceFrame,
  floatingSurfaceContentBounds,
  resolveFloatingSurfaceBounds,
  useFloatingSurfaceHeaderSlot,
} from "./floating-surface";
import { solveWorkspaceProjectionLayout, type WorkspaceLayoutSolver } from "./geometry";
import { GroupDragOverlay, useGroupDrag, type GroupDragController } from "./group-drag";
import {
  createGroupDropCandidates,
  planGroupDrop as resolveGroupDropPlan,
  type GroupDropCandidate,
} from "./group-drop";
import {
  ENGLISH_WORKSPACE_MESSAGES,
  resolveWorkspaceInteractionMessages,
  type ResolvedWorkspaceInteractionMessages,
  type WorkspaceMessageCatalog,
} from "./messages";
import {
  createWorkspaceNodeMotionSnapshot,
  resolveWorkspaceNodeMotionTransition,
  type WorkspaceNodeMotionSnapshot,
} from "./node-motion";
import {
  PanelDragOverlay,
  usePanelDrag,
  type ExternalPanelInvocation,
  type PanelDragController,
} from "./panel-drag";
import {
  createPanelDropRequest,
  emptyGroupAcquisitionRect,
  groupForPanel,
  logicalEdgeLabel,
  nodeForGroup,
  panelsForGroup,
  planPanelDrop as resolvePanelDropPlan,
  splitLabel,
  subtreeContainsNode,
  surfaceLayoutBoundsForNode,
} from "./panel-drop";
import { useWorkspaceRuntime, useWorkspaceSnapshot } from "./runtime-context";
import { resolveTabPresentation, tabOrientation } from "./tab-presentation";
import type {
  WorkspaceCommandAdapter,
  WorkspaceCommandOrigin,
  WorkspaceDirection,
  WorkspaceDispatchContext,
  WorkspaceDispatchOutcome,
  WorkspaceExternalPanelHandler,
  WorkspaceExternalPanelOutcome,
  WorkspaceExternalPanelPosition,
  WorkspaceFloatingBounds,
  WorkspaceFloatingSurfaceView,
  WorkspaceGroupDropRequest,
  WorkspaceGroupView,
  WorkspaceNodeView,
  WorkspacePanelRegistry,
  WorkspacePanelDropRequest,
  WorkspacePanelLifecycle,
  WorkspacePanelLifecyclePolicy,
  WorkspacePanelLifecycleReason,
  WorkspacePanelView,
  WorkspaceProjection,
  WorkspaceProjector,
  WorkspaceRuntimeLike,
  WorkspaceResultInterpreter,
  WorkspaceSplitView,
  WorkspaceTabPresentation,
  WorkspaceTabPresentationResolver,
  WorkspaceLogicalEdge,
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
  readonly messageCatalog?: WorkspaceMessageCatalog;
  /** Experimental model-aware geometry bridge. */
  readonly layoutSolver?: WorkspaceLayoutSolver<TSnapshot>;
  /** Deterministic logical bounds, primarily for embedded and test surfaces. */
  readonly layoutBounds?: LogicalRect;
  readonly splitterSize?: number;
  /**
   * Reversible single-region projection for narrow/coarse-pointer surfaces.
   * It changes only the rendered root; canonical desktop topology is untouched.
   */
  readonly responsive?: false | "auto";
  readonly compactBreakpoint?: number;
  readonly compactGroupId?: string;
  readonly onCompactGroupChange?: (groupId: string) => void;
  /** Experimental injection points used by adapter certification fixtures. */
  readonly motionDriver?: MotionDriver;
  readonly frameScheduler?: SurfaceFrameScheduler;
  readonly onAnnouncement?: (message: string) => void;
  /** Coalesces rapid semantic outcomes; zero keeps immediate delivery. */
  readonly announcementDebounceMs?: number;
  readonly onCommandResult?: (result: TResult) => void;
  readonly interpretResult?: WorkspaceResultInterpreter<TCommand, TResult>;
  /** Static or per-group logical placement and tab content treatment. */
  readonly tabPresentation?: WorkspaceTabPresentation | WorkspaceTabPresentationResolver;
  /**
   * Handles a panel released outside this surface. It is called synchronously
   * from pointerup so popup creation can use browser transient activation.
   */
  readonly onExternalPanelRequest?: WorkspaceExternalPanelHandler;
  /** Deadline for promise-returning external handoffs. Defaults to 15 seconds. */
  readonly externalPanelRequestTimeoutMs?: number;
}

interface PanelBoundaryProps {
  readonly panel: WorkspacePanelView;
  readonly messages: WorkspaceMessageCatalog;
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
          <strong>
            {this.props.messages.panelRenderFailed({ title: this.props.panel.title })}
          </strong>
          <p>{this.props.messages.panelRenderRecovery()}</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: undefined });
            }}
          >
            {this.props.messages.retry()}
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
  readonly cache: {
    destination: Element | null;
    state: StableHostState | undefined;
  };
}

interface StableHostState {
  readonly active: boolean;
  readonly lifecycle: WorkspacePanelLifecycle;
  readonly labelledBy: string | undefined;
  readonly label: string | undefined;
  readonly panelType: string | undefined;
  readonly selected: boolean;
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
  workspaceLabel,
  messageCatalog = ENGLISH_WORKSPACE_MESSAGES,
  layoutSolver,
  layoutBounds,
  splitterSize = 6,
  responsive = false,
  compactBreakpoint = 720,
  compactGroupId,
  onCompactGroupChange,
  motionDriver,
  frameScheduler,
  onAnnouncement,
  announcementDebounceMs = 0,
  onCommandResult,
  interpretResult,
  tabPresentation,
  onExternalPanelRequest,
  externalPanelRequestTimeoutMs = 15_000,
}: SurfaceRendererProps<TSnapshot, TCommand, TResult>) {
  assertNonNegativeSafeInteger(externalPanelRequestTimeoutMs, "externalPanelRequestTimeoutMs");
  const messages = messageCatalog;
  const interactionMessages = useMemo(
    () => resolveWorkspaceInteractionMessages(messages),
    [messages],
  );
  const snapshot = useWorkspaceSnapshot<TSnapshot, TCommand, TResult>();
  const projection = useMemo(() => projector(snapshot), [projector, snapshot]);
  const projectionRef = useRef(projection);
  useLayoutEffect(() => {
    projectionRef.current = projection;
  }, [projection]);
  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceInstanceId = useId();
  const domIdPrefix = `pf-${encodeDomId(workspaceInstanceId)}`;
  const parkingRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef(new Map<string, HTMLDivElement>());
  const hostsRef = useRef(new Map<string, HostRecord>());
  const [portalHosts, setPortalHosts] = useState<ReadonlyMap<string, HostRecord>>(() => new Map());
  const [portalOwnershipRevision, setPortalOwnershipRevision] = useState(0);
  const [surfaceDocument, setSurfaceDocument] = useState<Document>();
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const announcementIdRef = useRef(0);
  const announcementTimerRef = useRef<
    { readonly handle: number; readonly ownerWindow: Window } | undefined
  >(undefined);
  const pendingExternalControllersRef = useRef(new Set<AbortController>());
  const surfaceMountedRef = useRef(true);
  const [movePanelId, setMovePanelId] = useState<string>();
  const [moveGroupId, setMoveGroupId] = useState<string>();
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [internalCompactGroupId, setInternalCompactGroupId] = useState<string>();
  const [measuredBounds, setMeasuredBounds] = useState<LogicalRect>(ZERO_LOGICAL_RECT);
  const splitOverridesRef = useRef<Readonly<Record<string, SplitLayoutOverride>>>({});
  const splitPreviewRevisionRef = useRef(projection.revision);
  const effectiveMotion = motion === "productive" && systemReducedMotion ? "reduced" : motion;
  const logicalBounds = layoutBounds ?? measuredBounds;
  const compact =
    responsive === "auto" &&
    (coarsePointer ||
      (logicalBounds.inlineSize > 0 && logicalBounds.inlineSize < compactBreakpoint));
  const compactGroups = useMemo(
    () => orderedGroups(projection, projection.rootNodeId, false),
    [projection],
  );
  const effectiveCompactGroupId = compactGroupId ?? internalCompactGroupId;
  const requestedCompactGroup =
    effectiveCompactGroupId === undefined ? undefined : projection.groups[effectiveCompactGroupId];
  const activeCompactGroup = compactGroups.find((group) =>
    group.panelIds.includes(projection.activePanelId ?? ""),
  );
  const selectedCompactGroup = requestedCompactGroup ?? activeCompactGroup ?? compactGroups[0];
  const compactRootNode =
    compact && selectedCompactGroup !== undefined
      ? Object.values(projection.nodes).find(
          (candidate) =>
            candidate.kind === "group" && candidate.groupId === selectedCompactGroup.id,
        )
      : undefined;
  const renderedRootNodeId = compactRootNode?.id ?? projection.rootNodeId;
  const renderedProjection = useMemo(
    () =>
      renderedRootNodeId === projection.rootNodeId
        ? projection
        : { ...projection, rootNodeId: renderedRootNodeId },
    [projection, renderedRootNodeId],
  );
  const floatingSurfaces = projection.floatingSurfaces ?? EMPTY_FLOATING_SURFACES;
  const floatingFrameBounds = useMemo(
    () =>
      Object.fromEntries(
        floatingSurfaces.map((surface) => [
          surface.id,
          resolveFloatingSurfaceBounds(surface, logicalBounds.inlineSize, logicalBounds.blockSize),
        ]),
      ) as Readonly<Record<string, WorkspaceFloatingBounds>>,
    [floatingSurfaces, logicalBounds.blockSize, logicalBounds.inlineSize],
  );
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
      const solveRoot = (rootNodeId: string, bounds: LogicalRect) => {
        const request = {
          projection: renderedProjection,
          rootNodeId,
          bounds,
          splitterSize,
          splitOverrides: overrides,
        };
        if (layoutSolver !== undefined) return layoutSolver(snapshot, request);
        const rootProjection =
          rootNodeId === renderedProjection.rootNodeId
            ? renderedProjection
            : { ...renderedProjection, rootNodeId };
        return solveWorkspaceProjectionLayout(rootProjection, bounds, {
          splitterSize,
          splitOverrides: overrides,
        });
      };

      const mainLayout = solveRoot(renderedProjection.rootNodeId, logicalBounds);
      const floatingLayouts = floatingSurfaces.flatMap((surface) => {
        if (surface.minimized === true) return [];
        const frameBounds = floatingFrameBounds[surface.id];
        if (frameBounds === undefined) return [];
        return [
          solveRoot(
            surface.rootNodeId,
            floatingSurfaceContentBounds(frameBounds, logicalBounds, direction),
          ),
        ];
      });
      return mergeResolvedLayouts(mainLayout, floatingLayouts);
    },
    [
      direction,
      floatingFrameBounds,
      floatingSurfaces,
      layoutSolver,
      logicalBounds,
      renderedProjection,
      snapshot,
      splitterSize,
    ],
  );
  const resolvedLayout = useMemo(
    () => solveResolvedLayout(EMPTY_SPLIT_OVERRIDES),
    [solveResolvedLayout],
  );
  const nodeMotionSnapshot = useMemo(
    () => createWorkspaceNodeMotionSnapshot(renderedProjection, resolvedLayout),
    [renderedProjection, resolvedLayout],
  );
  const visibleGroupIds = useMemo(
    () => new Set(Object.keys(resolvedLayout.groupRects)),
    [resolvedLayout.groupRects],
  );

  const previewSplit = useCallback(
    (splitId: string, weights: readonly number[]) => {
      const nextOverrides = {
        ...splitOverridesRef.current,
        [splitId]: { weights },
      };
      splitOverridesRef.current = nextOverrides;
      splitPreviewRevisionRef.current = projectionRef.current.revision;
      const preview = solveResolvedLayout(nextOverrides);
      applyResolvedLayoutPreview(rootRef.current, preview);
      return preview;
    },
    [solveResolvedLayout],
  );

  const clearSplitPreview = useCallback(
    (splitId: string, restore = true) => {
      if (splitOverridesRef.current[splitId] === undefined) return;
      const nextOverrides = { ...splitOverridesRef.current };
      delete nextOverrides[splitId];
      splitOverridesRef.current = nextOverrides;
      if (restore) {
        applyResolvedLayoutPreview(rootRef.current, solveResolvedLayout(nextOverrides));
      }
    },
    [solveResolvedLayout],
  );

  useLayoutEffect(() => {
    if (
      splitPreviewRevisionRef.current !== projection.revision ||
      Object.keys(splitOverridesRef.current).length === 0
    ) {
      return;
    }
    applyResolvedLayoutPreview(rootRef.current, solveResolvedLayout(splitOverridesRef.current));
  });

  const publishAnnouncement = useCallback(
    (message: string) => {
      announcementIdRef.current += 1;
      const liveRegion = liveRegionRef.current;
      if (liveRegion !== null) {
        liveRegion.dataset.announcementId = String(announcementIdRef.current);
        liveRegion.textContent = message;
      }
      onAnnouncement?.(message);
    },
    [onAnnouncement],
  );

  const announce = useCallback(
    (message: string) => {
      const delay =
        Number.isFinite(announcementDebounceMs) && announcementDebounceMs > 0
          ? announcementDebounceMs
          : 0;
      const ownerWindow = rootRef.current?.ownerDocument.defaultView;
      if (delay === 0 || ownerWindow === undefined || ownerWindow === null) {
        publishAnnouncement(message);
        return;
      }
      if (announcementTimerRef.current !== undefined) {
        announcementTimerRef.current.ownerWindow.clearTimeout(announcementTimerRef.current.handle);
      }
      const handle = ownerWindow.setTimeout(() => {
        announcementTimerRef.current = undefined;
        publishAnnouncement(message);
      }, delay);
      announcementTimerRef.current = { handle, ownerWindow };
    },
    [announcementDebounceMs, publishAnnouncement],
  );

  useEffect(
    () => () => {
      const timer = announcementTimerRef.current;
      if (timer !== undefined) timer.ownerWindow.clearTimeout(timer.handle);
    },
    [],
  );

  useEffect(() => {
    surfaceMountedRef.current = true;
    const pendingExternalControllers = pendingExternalControllersRef.current;
    return () => {
      surfaceMountedRef.current = false;
      for (const controller of pendingExternalControllers) {
        controller.abort("surface-unmounted");
      }
      pendingExternalControllers.clear();
    };
  }, []);

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

  useEffect(() => {
    const ownerWindow = rootRef.current?.ownerDocument.defaultView;
    if (ownerWindow === undefined || ownerWindow === null || responsive !== "auto") return;
    const media = ownerWindow.matchMedia?.("(pointer: coarse)");
    if (media === undefined) return;
    const update = () => {
      setCoarsePointer(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, [responsive]);

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

  useLayoutEffect(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    if (ownerDocument !== undefined) setSurfaceDocument(ownerDocument);
  }, []);

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

  const previousNodeMotionSnapshotRef = useRef<WorkspaceNodeMotionSnapshot | undefined>(undefined);
  const previousRevisionRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const previousNodeMotionSnapshot = previousNodeMotionSnapshotRef.current;
    const previousRevision = previousRevisionRef.current;
    previousNodeMotionSnapshotRef.current = nodeMotionSnapshot;
    previousRevisionRef.current = projection.revision;
    if (previousNodeMotionSnapshot === undefined || previousRevision === projection.revision) {
      return;
    }

    const workspace = rootRef.current;
    if (workspace === null) return;
    motionCoordinator.cancelScope(domIdPrefix);
    const elements = workspace.querySelectorAll<HTMLElement>("[data-workspace-node]");
    for (const element of elements) {
      const nodeId = element.dataset.workspaceNode;
      if (nodeId === undefined) continue;
      const transition = resolveWorkspaceNodeMotionTransition(
        nodeId,
        previousNodeMotionSnapshot,
        nodeMotionSnapshot,
        logicalBounds,
        direction,
      );
      if (transition === undefined) continue;
      motionCoordinator.play(
        element,
        createFlipPlan({
          targetId: nodeId,
          scopeId: domIdPrefix,
          before: transition.before,
          after: transition.after,
          strategy: "translate-and-clip",
        }),
      );
    }
  }, [
    direction,
    domIdPrefix,
    logicalBounds,
    motionCoordinator,
    nodeMotionSnapshot,
    projection.revision,
  ]);

  useEffect(() => {
    if (Object.keys(splitOverridesRef.current).length === 0) return;
    splitOverridesRef.current = {};
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
      parkingRef.current?.append(element);
      hostsRef.current.set(panelId, {
        element,
        panelId,
        cache: {
          destination: element.parentElement,
          state: undefined,
        },
      });
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
    void portalHosts;
    void portalOwnershipRevision;
    const selectedGroupByPanelId = new Map<string, WorkspaceGroupView>();
    for (const group of Object.values(projection.groups)) {
      if (group.selectedPanelId !== "" && resolvedLayout.groupRects[group.id] !== undefined) {
        selectedGroupByPanelId.set(group.selectedPanelId, group);
      }
    }
    const surfaceDocument = rootRef.current?.ownerDocument;

    for (const [panelId, host] of hostsRef.current) {
      const panel = projection.panels[panelId];
      const selectedGroup = selectedGroupByPanelId.get(panelId);
      const localSlot =
        selectedGroup === undefined ? undefined : slotsRef.current.get(selectedGroup.id);
      const wasInExternalDocument =
        surfaceDocument !== undefined && host.element.ownerDocument !== surfaceDocument;
      const destination = wasInExternalDocument
        ? host.element.parentElement
        : (localSlot ?? parkingRef.current);
      if (host.cache.destination !== destination || host.element.parentElement !== destination) {
        if (destination !== null && host.element.parentElement !== destination) {
          destination.append(host.element);
        }
        updateHostDestinationCache(host, destination);
      }

      const inExternalDocument =
        surfaceDocument !== undefined && host.element.ownerDocument !== surfaceDocument;

      const selected = selectedGroup !== undefined;
      const policy = panelLifecyclePolicy(panel);
      updateStableHost(host, {
        active: projection.activePanelId === panelId,
        lifecycle: panelLifecycle(
          inExternalDocument ? true : selected,
          projection.activePanelId === panelId,
          policy,
        ),
        ...(inExternalDocument
          ? { label: panel?.title ?? messages.panelFallback() }
          : { labelledBy: panelTabId(domIdPrefix, panelId) }),
        panelType: panel?.type,
        selected: inExternalDocument ? true : selected,
      });
    }
  }, [
    domIdPrefix,
    messages,
    portalHosts,
    portalOwnershipRevision,
    projection,
    renderedRootNodeId,
    resolvedLayout.groupRects,
  ]);

  const resolveOutcome = useCallback(
    (result: TResult, context: WorkspaceDispatchContext<TCommand>) =>
      interpretResult?.(result, context) ?? defaultResultInterpreter(result, context, messages),
    [interpretResult, messages],
  );

  const dispatch = useCallback(
    (command: TCommand, label: string, origin: WorkspaceCommandOrigin, announceOutcome = true) => {
      const context = { command, label, origin } satisfies WorkspaceDispatchContext<TCommand>;
      const result = runtime.dispatch(command, { label, origin });
      const outcome = resolveOutcome(result, context);
      onCommandResult?.(result);
      if (announceOutcome && outcome.message !== undefined) announce(outcome.message);
      return { result, outcome } satisfies DispatchExecution<TResult>;
    },
    [announce, onCommandResult, resolveOutcome, runtime],
  );

  const commitSplit = useCallback(
    (splitId: string, weights: readonly number[], origin: "keyboard" | "pointer") => {
      const execution = dispatch(
        commands.resizeSplit(splitId, weights),
        messages.resizedWorkspacePanes(),
        origin,
      );
      clearSplitPreview(
        splitId,
        execution.outcome.status !== "committed" && execution.outcome.status !== "queued",
      );
      return execution;
    },
    [clearSplitPreview, commands, dispatch, messages],
  );

  const selectPanel = useCallback(
    (panel: WorkspacePanelView, focusTab = false, origin: WorkspaceCommandOrigin = "keyboard") => {
      dispatch(
        commands.selectPanel(panel.id),
        messages.selectedPanel({ title: panel.title }),
        origin,
      );
      if (focusTab) {
        queueMicrotask(() => {
          rootRef.current?.ownerDocument.getElementById(panelTabId(domIdPrefix, panel.id))?.focus();
        });
      }
    },
    [commands, dispatch, domIdPrefix, messages],
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
      const execution = dispatch(
        commands.closePanel(panel.id),
        messages.closedPanel({ title: panel.title }),
        origin,
      );

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
    [commands, dispatch, domIdPrefix, messages, projection],
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

  const restorePanelTab = useCallback(
    (panelId: string) => {
      queueMicrotask(() => {
        const workspace = rootRef.current;
        if (workspace === null) return;
        const tab = workspace.ownerDocument.getElementById(panelTabId(domIdPrefix, panelId));
        (tab ?? workspace).focus();
      });
    },
    [domIdPrefix],
  );

  const restoreGroupMoveHandle = useCallback(
    (groupId: string) => {
      queueMicrotask(() => {
        const workspace = rootRef.current;
        if (workspace === null) return;
        const handle = workspace.ownerDocument.getElementById(
          groupMoveHandleId(domIdPrefix, groupId),
        );
        (handle ?? workspace).focus();
      });
    },
    [domIdPrefix],
  );

  const commitPanelDrop = useCallback(
    (
      request: WorkspacePanelDropRequest,
      label: string,
      origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard" | "menu">,
      plannedCommand?: TCommand,
    ): WorkspaceDispatchOutcome => {
      if (projectionRef.current.revision !== request.revision) {
        const message = interactionMessages.workspaceChangedBeforePanelMove();
        announce(message);
        return { status: "rejected", message };
      }
      const planner = commands.planPanelDrop;
      if (planner === undefined) {
        const message = interactionMessages.directPanelPlacementUnsupported();
        announce(message);
        return { status: "rejected", message };
      }
      const targetRect = resolvedLayout.groupRects[request.targetGroup.id];
      const plan =
        plannedCommand === undefined && targetRect !== undefined
          ? resolvePanelDropPlan(
              planner,
              request,
              targetRect,
              resolvedLayout,
              splitterSize,
              surfaceLayoutBoundsForNode(
                projectionRef.current,
                resolvedLayout,
                request.targetNodeId,
              ),
            )
          : undefined;
      const command = plannedCommand ?? plan?.command;
      if (command === undefined) {
        const message = interactionMessages.panelPlacementUnavailable();
        announce(message);
        return { status: "rejected", message };
      }
      return dispatch(command, label, origin).outcome;
    },
    [announce, commands, dispatch, interactionMessages, resolvedLayout, splitterSize],
  );

  const commitGroupDrop = useCallback(
    (
      request: WorkspaceGroupDropRequest,
      label: string,
      origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard" | "menu">,
      plannedCommand?: TCommand,
    ): WorkspaceDispatchOutcome => {
      if (projectionRef.current.revision !== request.revision) {
        const message = interactionMessages.workspaceChangedBeforeGroupMove();
        announce(message);
        return { status: "rejected", message };
      }
      const planner = commands.planGroupDrop;
      if (planner === undefined) {
        const message = interactionMessages.directGroupPlacementUnsupported();
        announce(message);
        return { status: "rejected", message };
      }
      const targetRect = resolvedLayout.groupRects[request.targetGroup.id];
      const bounds = surfaceLayoutBoundsForNode(
        projectionRef.current,
        resolvedLayout,
        request.targetNodeId,
      );
      const plan =
        plannedCommand === undefined && targetRect !== undefined && bounds !== undefined
          ? resolveGroupDropPlan(planner, request, targetRect, bounds, splitterSize)
          : undefined;
      const command = plannedCommand ?? plan?.command;
      if (command === undefined) {
        const message = interactionMessages.groupPlacementUnavailable();
        announce(message);
        return { status: "rejected", message };
      }
      return dispatch(command, label, origin).outcome;
    },
    [announce, commands, dispatch, interactionMessages, resolvedLayout, splitterSize],
  );

  const requestExternalPanel = useCallback(
    (
      invocation: ExternalPanelInvocation,
    ): WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome> => {
      const handler = onExternalPanelRequest;
      if (handler === undefined) {
        return { status: "rejected", message: interactionMessages.newWindowUnavailable() };
      }
      const host = hostsRef.current.get(invocation.panel.id);
      const parkingElement = parkingRef.current;
      if (host === undefined || parkingElement === null) {
        return {
          status: "rejected",
          message: interactionMessages.panelNotReadyForNewWindow(),
        };
      }
      const controller = invocation.controller;
      const signal = controller.signal;
      pendingExternalControllersRef.current.add(controller);
      const surfaceDocument = rootRef.current?.ownerDocument;
      const labelledBy = panelTabId(domIdPrefix, invocation.panel.id);
      prepareHostForExternalAccessibility(host, invocation.panel.title);
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        signal.removeEventListener("abort", finalize);
        pendingExternalControllersRef.current.delete(controller);
        finalizeExternalHostAccessibility(
          host,
          invocation.panel.title,
          labelledBy,
          surfaceDocument,
        );
        if (signal.reason !== "surface-unmounted") {
          setPortalOwnershipRevision((current) => current + 1);
        }
      };
      signal.addEventListener("abort", finalize, { once: true });
      let outcome: WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
      try {
        outcome = handler({
          panel: invocation.panel,
          sourceGroup: invocation.sourceGroup,
          sourcePanels: invocation.sourcePanels,
          host: host.element,
          parkingElement,
          signal,
          notifyReturnedToOwner: (message) => {
            if (!surfaceMountedRef.current) return;
            finalizeExternalHostAccessibility(
              host,
              invocation.panel.title,
              labelledBy,
              surfaceDocument,
            );
            setPortalOwnershipRevision((current) => current + 1);
            announce(message);
            restorePanelTab(invocation.panel.id);
          },
          origin: invocation.origin,
          position: invocation.position,
          ...(invocation.pointer === undefined ? {} : { pointer: invocation.pointer }),
        });
        // Host adoption is an imperative DOM operation. Make that ownership
        // change observable to the declarative portal/lifecycle projection even
        // when the application has not published its semantic transfer yet.
        setPortalOwnershipRevision((current) => current + 1);
      } catch (error) {
        finalize();
        throw error;
      }
      try {
        if (!isPromiseLike(outcome)) {
          finalize();
          return outcome;
        }
        return boundedExternalOutcome(
          Promise.resolve(outcome),
          controller,
          externalPanelRequestTimeoutMs,
          finalize,
        );
      } catch (error) {
        finalize();
        throw error;
      }
    },
    [
      announce,
      domIdPrefix,
      externalPanelRequestTimeoutMs,
      interactionMessages,
      onExternalPanelRequest,
      restorePanelTab,
    ],
  );

  const panelDrag = usePanelDrag({
    projection,
    resolvedLayout,
    logicalBounds,
    direction,
    messages: interactionMessages,
    enabled:
      commands.planPanelDrop !== undefined ||
      commands.reorderPanel !== undefined ||
      onExternalPanelRequest !== undefined,
    internalEnabled: commands.planPanelDrop !== undefined,
    externalAvailable: onExternalPanelRequest !== undefined,
    splitterSize,
    planDrop: commands.planPanelDrop,
    createReorderCommand: commands.reorderPanel,
    frameScheduler: scheduler,
    scheduleKey: `${domIdPrefix}:panel-drag`,
    getRoot: () => rootRef.current,
    announce,
    commitDrop: commitPanelDrop,
    commitReorder: (command, label, origin) => dispatch(command, label, origin).outcome,
    requestExternal: requestExternalPanel,
    restoreFocus: restorePanelTab,
  });

  const groupDrag = useGroupDrag({
    projection,
    resolvedLayout,
    logicalBounds,
    direction,
    messages: interactionMessages,
    enabled: commands.planGroupDrop !== undefined,
    splitterSize,
    frameScheduler: scheduler,
    scheduleKey: `${domIdPrefix}:group-drag`,
    planDrop: commands.planGroupDrop,
    getRoot: () => rootRef.current,
    announce,
    commitDrop: commitGroupDrop,
    restoreFocus: restoreGroupMoveHandle,
  });

  const keyboardGroupDropCandidates = useMemo(
    () =>
      moveGroupId === undefined
        ? []
        : createGroupDropCandidates(
            projection,
            resolvedLayout,
            moveGroupId,
            direction,
            0.25,
            0.5,
            splitterSize,
            {
              swapPanelContainers: interactionMessages.swapPanelContainers,
              movePanelContainerBeside: interactionMessages.movePanelContainerBeside,
            },
            commands.planGroupDrop,
          ),
    [
      commands.planGroupDrop,
      direction,
      interactionMessages,
      moveGroupId,
      projection,
      resolvedLayout,
      splitterSize,
    ],
  );

  const node = renderedProjection.nodes[renderedProjection.rootNodeId];

  return (
    <div
      ref={rootRef}
      className={["pf-workspace", className].filter(Boolean).join(" ")}
      data-direction={direction}
      data-motion={motion}
      data-effective-motion={effectiveMotion}
      data-geometry-diagnostics={resolvedLayout.diagnostics.length}
      data-geometry-mode={layoutSolver === undefined ? "projection" : "model"}
      data-responsive-projection={compact ? "single-region" : "full-layout"}
      data-panel-drag-state="idle"
      data-group-drag-state="idle"
      data-group-drop-enabled={String(commands.planGroupDrop !== undefined)}
      data-panel-drop-enabled={String(
        commands.planPanelDrop !== undefined ||
          commands.reorderPanel !== undefined ||
          onExternalPanelRequest !== undefined,
      )}
      dir={direction}
      aria-label={workspaceLabel ?? messages.workspaceLabel()}
      tabIndex={-1}
    >
      {compact && selectedCompactGroup !== undefined ? (
        <nav className="pf-region-switcher" aria-label={messages.workspaceRegions()}>
          <label>
            <span className="pf-visually-hidden">{messages.currentWorkspaceRegion()}</span>
            <select
              aria-label={messages.currentWorkspaceRegion()}
              value={selectedCompactGroup.id}
              onChange={(event) => {
                setInternalCompactGroupId(event.target.value);
                onCompactGroupChange?.(event.target.value);
              }}
            >
              {compactGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {messages.regionOption({
                    label: group.label ?? messages.panelGroupFallback(),
                    panelCount: group.panelIds.length,
                  })}
                </option>
              ))}
            </select>
          </label>
        </nav>
      ) : null}

      <div className="pf-semantic-layer" data-workspace-layer="chrome">
        {node === undefined ? (
          <WorkspaceEmptyState messages={messages} />
        ) : (
          <LayoutNode
            node={node}
            projection={renderedProjection}
            panels={panels}
            messages={messages}
            commands={commands}
            direction={direction}
            domIdPrefix={domIdPrefix}
            resolvedLayout={resolvedLayout}
            splitOverrides={EMPTY_SPLIT_OVERRIDES}
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
            setMoveGroupId={setMoveGroupId}
            tabPresentation={tabPresentation}
            panelDrag={panelDrag}
            groupDrag={groupDrag}
            commitPanelDrop={commitPanelDrop}
            requestExternalPanel={requestExternalPanel}
            externalPanelAvailable={onExternalPanelRequest !== undefined}
            announce={announce}
            interactionMessages={interactionMessages}
          />
        )}
      </div>

      {floatingSurfaces.length === 0 ? null : (
        <div className="pf-floating-layer" data-workspace-layer="floating-surfaces">
          {floatingSurfaces.map((surface, surfaceIndex) => {
            const floatingNode = renderedProjection.nodes[surface.rootNodeId];
            const frameBounds = floatingFrameBounds[surface.id];
            const moveSurface = commands.moveFloatingSurface;
            const resizeSurface = commands.resizeFloatingSurface;
            const raiseSurface = commands.raiseFloatingSurface;
            const minimizeSurface = commands.minimizeFloatingSurface;
            const maximizeSurface = commands.maximizeFloatingSurface;
            const restoreSurface = commands.restoreFloatingSurface;
            const redockSurface = commands.redockFloatingSurface;
            if (frameBounds === undefined) return null;
            const title = floatingSurfaceTitle(surface, projection, messages.panelGroupFallback());
            const compactGroupId = singlePanelFloatingGroupId(surface, projection);
            const redockPanelId = floatingSurfaceSelectedPanelId(surface, projection);
            return (
              <FloatingSurfaceFrame
                key={surface.id}
                surface={surface}
                {...(compactGroupId === undefined ? {} : { compactGroupId })}
                bounds={frameBounds}
                projectionRevision={projection.revision}
                title={title}
                active={projection.activeSurfaceId === surface.id}
                frontmost={surfaceIndex === floatingSurfaces.length - 1}
                zIndex={surfaceIndex + 1}
                viewportWidth={logicalBounds.inlineSize}
                viewportHeight={logicalBounds.blockSize}
                scheduler={scheduler}
                scheduleKey={`${domIdPrefix}:floating:${surface.id}`}
                messages={interactionMessages}
                {...(moveSurface === undefined
                  ? {}
                  : {
                      onMove: (
                        nextBounds: WorkspaceFloatingBounds,
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) =>
                        dispatch(
                          moveSurface(surface.id, {
                            x: nextBounds.x,
                            y: nextBounds.y,
                          }),
                          interactionMessages.movedFloatingSurface({ title }),
                          origin,
                        ).outcome,
                    })}
                {...(resizeSurface === undefined
                  ? {}
                  : {
                      onResize: (
                        nextBounds: WorkspaceFloatingBounds,
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) =>
                        dispatch(
                          resizeSurface(surface.id, nextBounds),
                          interactionMessages.resizedFloatingSurface({ title }),
                          origin,
                        ).outcome,
                    })}
                {...(raiseSurface === undefined
                  ? {}
                  : {
                      onRaise: (
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) => {
                        dispatch(
                          raiseSurface(surface.id),
                          interactionMessages.raisedFloatingSurface({ title }),
                          origin,
                          false,
                        );
                      },
                    })}
                {...(minimizeSurface === undefined
                  ? {}
                  : {
                      onMinimize: (
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) =>
                        dispatch(
                          minimizeSurface(surface.id),
                          interactionMessages.minimizedFloatingSurface({ title }),
                          origin,
                        ).outcome,
                    })}
                {...(maximizeSurface === undefined
                  ? {}
                  : {
                      onMaximize: (
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) =>
                        dispatch(
                          maximizeSurface(surface.id),
                          interactionMessages.maximizedFloatingSurface({ title }),
                          origin,
                        ).outcome,
                    })}
                {...(restoreSurface === undefined
                  ? {}
                  : {
                      onRestore: (
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) =>
                        dispatch(
                          restoreSurface(surface.id),
                          interactionMessages.restoredFloatingSurface({ title }),
                          origin,
                        ).outcome,
                    })}
                {...(redockSurface === undefined
                  ? {}
                  : {
                      onRedock: (
                        origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
                      ) => {
                        const outcome = dispatch(
                          redockSurface(surface.id),
                          interactionMessages.redockedFloatingSurface({ title }),
                          origin,
                        ).outcome;
                        if (
                          redockPanelId !== undefined &&
                          (outcome.status === "committed" || outcome.status === "queued")
                        ) {
                          restorePanelTab(redockPanelId);
                        }
                        return outcome;
                      },
                    })}
              >
                {surface.minimized === true || floatingNode === undefined ? null : (
                  <LayoutNode
                    node={floatingNode}
                    projection={renderedProjection}
                    panels={panels}
                    messages={messages}
                    commands={commands}
                    direction={direction}
                    domIdPrefix={domIdPrefix}
                    resolvedLayout={resolvedLayout}
                    splitOverrides={EMPTY_SPLIT_OVERRIDES}
                    projectionRevision={projection.revision}
                    scheduler={scheduler}
                    scheduleKey={`${surfaceScheduleKey}:${surface.id}`}
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
                    setMoveGroupId={setMoveGroupId}
                    tabPresentation={tabPresentation}
                    panelDrag={panelDrag}
                    groupDrag={groupDrag}
                    commitPanelDrop={commitPanelDrop}
                    requestExternalPanel={requestExternalPanel}
                    externalPanelAvailable={onExternalPanelRequest !== undefined}
                    announce={announce}
                    interactionMessages={interactionMessages}
                  />
                )}
              </FloatingSurfaceFrame>
            );
          })}
        </div>
      )}

      <div
        ref={parkingRef}
        className="pf-content-parking"
        data-workspace-layer="stable-content"
        aria-hidden="true"
      />

      <div className="pf-overlay-layer" data-workspace-layer="overlay">
        <PanelDragOverlay overlayRef={panelDrag.overlayRef} />
        <GroupDragOverlay overlayRef={groupDrag.overlayRef} />
        {movePanelId !== undefined ? (
          <KeyboardMoveOverlay
            panel={projection.panels[movePanelId]}
            groups={Object.values(projection.groups)}
            messages={messages}
            direction={direction}
            announce={announce}
            onMove={(groupId) => {
              const panelId = movePanelId;
              const panel = projection.panels[movePanelId];
              const targetGroup = projection.groups[groupId];
              const targetNodeId = nodeForGroup(projection, groupId);
              if (
                commands.planPanelDrop !== undefined &&
                panel !== undefined &&
                targetGroup !== undefined &&
                targetNodeId !== undefined
              ) {
                const request = createPanelDropRequest(
                  projection,
                  panel.id,
                  targetGroup.id,
                  targetNodeId,
                  { kind: "center", ratio: 1 },
                );
                if (request !== undefined) {
                  commitPanelDrop(
                    request,
                    interactionMessages.movedPanelTo({
                      title: panel.title,
                      group: targetGroup.label ?? messages.groupFallback(),
                    }),
                    "keyboard",
                  );
                }
              } else if (commands.movePanel !== undefined && panel !== undefined) {
                dispatch(
                  commands.movePanel(movePanelId, groupId),
                  messages.movedPanelTo({
                    title: panel.title,
                    group: projection.groups[groupId]?.label ?? messages.groupFallback(),
                  }),
                  "keyboard",
                );
              }
              setMovePanelId(undefined);
              restoreMoveTrigger(panelId);
            }}
            onSplit={
              commands.planPanelDrop === undefined
                ? undefined
                : (edge) => {
                    const panelId = movePanelId;
                    const panel = projection.panels[panelId];
                    const sourceGroup = groupForPanel(projection, panelId);
                    const sourceNodeId =
                      sourceGroup === undefined
                        ? undefined
                        : nodeForGroup(projection, sourceGroup.id);
                    if (
                      panel !== undefined &&
                      sourceGroup !== undefined &&
                      sourceNodeId !== undefined
                    ) {
                      const request = createPanelDropRequest(
                        projection,
                        panel.id,
                        sourceGroup.id,
                        sourceNodeId,
                        { kind: "edge", edge, ratio: 0.5 },
                      );
                      if (request !== undefined) {
                        commitPanelDrop(
                          request,
                          splitLabel(
                            panel,
                            sourceGroup,
                            edge,
                            direction,
                            interactionMessages.splitPanel,
                          ),
                          "keyboard",
                        );
                      }
                    }
                    setMovePanelId(undefined);
                    restoreMoveTrigger(panelId);
                  }
            }
            onExternal={
              onExternalPanelRequest === undefined
                ? undefined
                : () => {
                    const panelId = movePanelId;
                    const panel = projection.panels[panelId];
                    const sourceGroup = groupForPanel(projection, panelId);
                    const rootRect = rootRef.current?.getBoundingClientRect();
                    if (panel !== undefined && sourceGroup !== undefined) {
                      const clientX = (rootRect?.left ?? 0) + (rootRect?.width ?? 0) / 2;
                      const clientY = (rootRect?.top ?? 0) + (rootRect?.height ?? 0) / 2;
                      const ownerWindow = rootRef.current?.ownerDocument.defaultView;
                      let outcome:
                        | WorkspaceExternalPanelOutcome
                        | Promise<WorkspaceExternalPanelOutcome>;
                      const controller = new AbortController();
                      try {
                        outcome = requestExternalPanel({
                          panel,
                          sourceGroup,
                          sourcePanels: panelsForGroup(projection, sourceGroup),
                          origin: "keyboard",
                          controller,
                          position: {
                            clientX,
                            clientY,
                            screenX: (ownerWindow?.screenX ?? 0) + clientX,
                            screenY: (ownerWindow?.screenY ?? 0) + clientY,
                          },
                        });
                        const handle = (result: WorkspaceExternalPanelOutcome) => {
                          if (controller.signal.reason === "surface-unmounted") return;
                          announce(
                            result.message ??
                              (result.status === "committed"
                                ? interactionMessages.openedPanelInNewWindow({
                                    title: panel.title,
                                  })
                                : interactionMessages.couldNotOpenPanelInNewWindow({
                                    title: panel.title,
                                  })),
                          );
                        };
                        if (isPromiseLike(outcome)) {
                          void outcome.then(handle, () => handle({ status: "rejected" }));
                        } else handle(outcome);
                      } catch (error) {
                        announce(
                          error instanceof Error
                            ? error.message
                            : interactionMessages.couldNotOpenPanelInNewWindow({
                                title: panel.title,
                              }),
                        );
                      }
                    }
                    setMovePanelId(undefined);
                    restoreMoveTrigger(panelId);
                  }
            }
            onCancel={() => {
              const panelId = movePanelId;
              setMovePanelId(undefined);
              announce(messages.moveCancelled());
              restoreMoveTrigger(panelId);
            }}
          />
        ) : null}
        {moveGroupId !== undefined ? (
          <KeyboardGroupMoveOverlay
            group={projection.groups[moveGroupId]}
            candidates={keyboardGroupDropCandidates}
            messages={messages}
            announce={announce}
            onMove={(candidate) => {
              const groupId = moveGroupId;
              commitGroupDrop(
                candidate.request,
                candidate.label,
                "keyboard",
                candidate.plan.command,
              );
              setMoveGroupId(undefined);
              restoreGroupMoveHandle(groupId);
            }}
            onCancel={() => {
              const groupId = moveGroupId;
              setMoveGroupId(undefined);
              announce(messages.moveCancelled());
              restoreGroupMoveHandle(groupId);
            }}
          />
        ) : null}
      </div>

      <PanelPortals
        projection={projection}
        registry={panels}
        hosts={portalHosts}
        messages={messages}
        ownershipRevision={portalOwnershipRevision}
        surfaceDocument={surfaceDocument}
        visibleGroupIds={visibleGroupIds}
      />

      <div
        ref={liveRegionRef}
        className="pf-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    </div>
  );
}

interface LayoutNodeProps<TCommand, TResult> {
  readonly node: WorkspaceNodeView;
  readonly projection: WorkspaceProjection;
  readonly panels: WorkspacePanelRegistry;
  readonly messages: WorkspaceMessageCatalog;
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
  readonly setMoveGroupId: (groupId: string | undefined) => void;
  readonly tabPresentation: WorkspaceTabPresentation | WorkspaceTabPresentationResolver | undefined;
  readonly panelDrag: PanelDragController;
  readonly groupDrag: GroupDragController;
  readonly commitPanelDrop: (
    request: WorkspacePanelDropRequest,
    label: string,
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard" | "menu">,
  ) => WorkspaceDispatchOutcome;
  readonly requestExternalPanel: (
    invocation: ExternalPanelInvocation,
  ) => WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
  readonly externalPanelAvailable: boolean;
  readonly announce: (message: string) => void;
  readonly interactionMessages: ResolvedWorkspaceInteractionMessages;
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
                messages={props.messages}
              />
            ) : null}
            <div
              className="pf-split-child"
              data-workspace-split-child={childId}
              data-empty-group-descendant={String(subtreeHasEmptyGroup(props.projection, child.id))}
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
  readonly messages: WorkspaceMessageCatalog;
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
  messages,
}: SplitterProps) {
  const splitterRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef("idle");
  const actorRef = useRef<ResizeActor | null>(null);
  const sessionRef = useRef<PointerResizeSession | null>(null);
  const handledRevisionRef = useRef(projectionRevision);
  const beforeSize = axisSize(resolvedLayout.nodeRects[splitter.beforeNodeId], split.axis);
  const afterSize = axisSize(resolvedLayout.nodeRects[splitter.afterNodeId], split.axis);
  const pairSize = beforeSize + afterSize;
  const value = pairSize === 0 ? 50 : (beforeSize / pairSize) * 100;

  const publishResizeState = useCallback((next: string) => {
    if (resizeStateRef.current === next) return;
    resizeStateRef.current = next;
    const element = splitterRef.current;
    if (element !== null) element.dataset.resizeState = next;
  }, []);

  useLayoutEffect(() => {
    const element = splitterRef.current;
    if (element !== null) element.dataset.resizeState = resizeStateRef.current;
  });

  const send = useCallback(
    (actor: ResizeActor, event: ResizeEvent) => {
      actor.send(event);
      const state = String(actor.getSnapshot().value);
      publishResizeState(state);
      return state;
    },
    [publishResizeState],
  );

  const disposeActor = useCallback(
    (actor: ResizeActor) => {
      if (actorRef.current !== actor) return;
      actorRef.current = null;
      actor.stop();
      publishResizeState("idle");
    },
    [publishResizeState],
  );

  useEffect(
    () => () => {
      scheduler.cancel(scheduleKey);
      const session = sessionRef.current;
      if (session?.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      sessionRef.current = null;
      const actor = actorRef.current;
      actorRef.current = null;
      actor?.stop();
    },
    [scheduleKey, scheduler],
  );

  useEffect(() => {
    if (handledRevisionRef.current === projectionRevision) return;
    handledRevisionRef.current = projectionRevision;
    const actor = actorRef.current;
    if (actor === null) return;
    scheduler.cancel(scheduleKey);
    const session = sessionRef.current;
    if (session !== null) session.pending = undefined;
    sessionRef.current = null;
    const state = send(actor, { type: "CANCEL" });
    onCancel();
    if (session?.captureElement.hasPointerCapture?.(session.pointerId)) {
      session.captureElement.releasePointerCapture?.(session.pointerId);
    }
    if (state === "cancelling") send(actor, { type: "RETURNED" });
    disposeActor(actor);
  }, [disposeActor, onCancel, projectionRevision, scheduleKey, scheduler, send]);

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
    if (event.button !== 0 || sessionRef.current !== null || actorRef.current !== null) return;
    const coordinate = split.axis === "inline" ? event.clientX : event.clientY;
    const actor = createResizeActor();
    actor.start();
    actorRef.current = actor;
    const session: PointerResizeSession = {
      actor,
      pointerId: event.pointerId,
      startCoordinate: coordinate,
      beforeSize,
      afterSize,
      weights: [...weights],
      latest: [...weights],
      pending: undefined,
      captureElement: event.currentTarget,
    };
    sessionRef.current = session;
    send(actor, {
      type: "POINTER_START",
      pointerId: event.pointerId,
      position: pointerSample(event),
      baseRevision: safeRevision(projectionRevision),
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const requestedPointerWeights = (session: PointerResizeSession, coordinate: number) => {
    const physicalDelta = coordinate - session.startCoordinate;
    const logicalDelta =
      split.axis === "inline" && direction === "rtl" ? -physicalDelta : physicalDelta;
    return updatePair(logicalDelta, session.weights, session.beforeSize, session.afterSize);
  };

  const applyPointerPreview = (
    session: PointerResizeSession,
    requestedWeights: readonly number[],
  ) => {
    const preview = onPreview(requestedWeights);
    const position = splitterPosition(preview, splitter.id);
    if (position !== undefined && String(session.actor.getSnapshot().value) === "resizing") {
      session.latest = solvedPairWeights(split, requestedWeights, preview, beforeIndex, afterIndex);
      send(session.actor, { type: "CONSTRAINT_RESULT", position });
    }
  };

  const consumeLatestPointer = (session: PointerResizeSession) => {
    const sample = session.pending;
    if (
      sample === undefined ||
      sessionRef.current !== session ||
      actorRef.current !== session.actor
    ) {
      return;
    }
    session.pending = undefined;
    const state = send(session.actor, {
      type: "POINTER_MOVE",
      pointerId: session.pointerId,
      position: sample.position,
    });
    if (state !== "resizing") return;
    applyPointerPreview(session, requestedPointerWeights(session, sample.coordinate));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    session.pending = {
      coordinate: split.axis === "inline" ? event.clientX : event.clientY,
      position: pointerSample(event),
    };
    scheduler.schedule(scheduleKey, () => consumeLatestPointer(session));
    event.preventDefault();
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    scheduler.cancel(scheduleKey);
    // A coalesced move may still be waiting for its frame when pointerup
    // arrives. Resolve the release sample synchronously through the same
    // constraint solver so the visible final preview and committed weights
    // describe one exact geometry result.
    session.pending = {
      coordinate: split.axis === "inline" ? event.clientX : event.clientY,
      position: pointerSample(event),
    };
    consumeLatestPointer(session);
    const state = send(session.actor, { type: "POINTER_END", pointerId: event.pointerId });
    sessionRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (state !== "committing") {
      onCancel();
      disposeActor(session.actor);
      return;
    }
    try {
      settleCommit(
        onCommit(session.latest, "pointer").outcome,
        (event) => send(session.actor, event),
        messages,
      );
    } finally {
      disposeActor(session.actor);
    }
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session === null || session.pointerId !== event.pointerId) return;
    scheduler.cancel(scheduleKey);
    session.pending = undefined;
    sessionRef.current = null;
    const state = send(session.actor, {
      type: event.type === "lostpointercapture" ? "CAPTURE_LOST" : "POINTER_CANCEL",
      pointerId: event.pointerId,
    });
    onCancel();
    if (state === "cancelling") send(session.actor, { type: "RETURNED" });
    disposeActor(session.actor);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && sessionRef.current !== null) {
      event.preventDefault();
      const session = sessionRef.current;
      scheduler.cancel(scheduleKey);
      session.pending = undefined;
      sessionRef.current = null;
      const state = send(session.actor, { type: "CANCEL" });
      onCancel();
      if (session.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      if (state === "cancelling") send(session.actor, { type: "RETURNED" });
      disposeActor(session.actor);
      return;
    }
    if (actorRef.current !== null) return;
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
    const actor = createResizeActor();
    actor.start();
    actorRef.current = actor;
    try {
      send(actor, {
        type: "KEYBOARD_START",
        position: currentPosition,
        baseRevision: safeRevision(projectionRevision),
      });
      const nextPosition =
        split.axis === "inline"
          ? { ...currentPosition, inline: currentPosition.inline + step }
          : { ...currentPosition, block: currentPosition.block + step };
      send(actor, { type: "KEYBOARD_STEP", position: nextPosition });
      const next = updatePair(step, weights, beforeSize, afterSize);
      const preview = onPreview(next);
      const constrained = splitterPosition(preview, splitter.id);
      if (constrained !== undefined)
        send(actor, { type: "CONSTRAINT_RESULT", position: constrained });
      const committedWeights = solvedPairWeights(split, next, preview, beforeIndex, afterIndex);
      send(actor, { type: "COMMIT" });
      settleCommit(
        onCommit(committedWeights, "keyboard").outcome,
        (event) => send(actor, event),
        messages,
      );
    } finally {
      disposeActor(actor);
    }
  };

  return (
    <div
      ref={splitterRef}
      className="pf-splitter"
      role="separator"
      tabIndex={0}
      aria-label={messages.resizeAdjacentPanes()}
      aria-orientation={split.axis === "inline" ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={messages.primaryPanePercent({ percent: Math.round(value) })}
      data-resize-state="idle"
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
  setMoveGroupId,
  tabPresentation,
  panelDrag,
  groupDrag,
  commitPanelDrop,
  requestExternalPanel,
  externalPanelAvailable,
  announce,
  interactionMessages,
  messages,
  resolvedLayout,
}: PanelGroupProps<TCommand, TResult>) {
  const pointerFocusPanelRef = useRef<string | undefined>(undefined);
  const reorderFocusPanelRef = useRef<string | undefined>(undefined);
  const groupRef = useRef<HTMLElement>(null);
  const groupLabelId = useId();
  const floatingHeaderTarget = useFloatingSurfaceHeaderSlot(group.id);
  const groupPanels = group.panelIds
    .map((id) => projection.panels[id])
    .filter((panel): panel is WorkspacePanelView => panel !== undefined);
  const selectedPanel = groupPanels.find((panel) => panel.id === group.selectedPanelId);
  const createMovePanelCommand = commands.movePanel;
  const createReorderPanelCommand = commands.reorderPanel;
  const createFloatPanelCommand = groupBelongsToFloatingSurface(projection, group.id)
    ? undefined
    : commands.floatPanel;
  const createDropPanelCommand = commands.planPanelDrop;
  const createDropGroupCommand = commands.planGroupDrop;
  const createMergeGroupCommand = commands.mergeGroup;
  const presentation = resolveTabPresentation(tabPresentation, group, projection);
  const orientation =
    floatingHeaderTarget === undefined ? tabOrientation(presentation) : "horizontal";
  const empty = groupPanels.length === 0;
  const groupRect = resolvedLayout.groupRects[group.id] ?? ZERO_LOGICAL_RECT;
  const rootRect = resolvedLayout.nodeRects[resolvedLayout.rootNodeId] ?? groupRect;
  const acquisitionRect = emptyGroupAcquisitionRect(group, groupRect, rootRect);
  const emptyGroupLabel = group.label ?? messages.panelGroupFallback();
  const hasVisibleGroupDropTarget = Object.keys(resolvedLayout.groupRects).some(
    (groupId) => groupId !== group.id,
  );
  const moveContainerLabel =
    createDropGroupCommand === undefined || empty || !hasVisibleGroupDropTarget
      ? undefined
      : interactionMessages.movePanelContainer({ group: emptyGroupLabel });
  const mergeTarget =
    createMergeGroupCommand === undefined ? undefined : adjacentGroupForNode(projection, nodeId);
  const mergeTargetLabel = mergeTarget?.label ?? messages.groupFallback();
  const removeContainerLabel =
    mergeTarget === undefined
      ? undefined
      : (messages.removePanelContainer?.({ target: mergeTargetLabel }) ??
        `Remove panel container (merge into ${mergeTargetLabel})`);
  const emptyGroupDescriptionId = `${groupLabelId}-empty`;
  const emptyGroupStyle = empty
    ? ({
        "--pf-empty-group-inline-offset": `${acquisitionRect.inlineStart - groupRect.inlineStart}px`,
        "--pf-empty-group-block-offset": `${acquisitionRect.blockStart - groupRect.blockStart}px`,
        "--pf-empty-group-inline-size": `${acquisitionRect.inlineSize}px`,
        "--pf-empty-group-block-size": `${acquisitionRect.blockSize}px`,
      } as CSSProperties)
    : undefined;

  const removePanelContainer = (
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard" | "menu">,
  ) => {
    if (createMergeGroupCommand === undefined || mergeTarget === undefined) return;
    const ownerDocument = groupRef.current?.ownerDocument;
    const selectedSourcePanelId = selectedPanel?.id;
    const targetFocusPanelId = mergeTarget.panelIds.includes(mergeTarget.selectedPanelId)
      ? mergeTarget.selectedPanelId
      : mergeTarget.panelIds[0];
    const outcome = dispatch(
      createMergeGroupCommand(group.id, mergeTarget.id, selectedSourcePanelId),
      messages.removedPanelContainer?.({
        group: emptyGroupLabel,
        target: mergeTargetLabel,
      }) ?? `Removed ${emptyGroupLabel} panel container and moved its tabs to ${mergeTargetLabel}`,
      origin,
    ).outcome;
    const focusPanelId = selectedSourcePanelId ?? projection.activePanelId ?? targetFocusPanelId;
    if (
      focusPanelId !== undefined &&
      (outcome.status === "committed" || outcome.status === "queued")
    ) {
      queueMicrotask(() => {
        ownerDocument?.getElementById(panelTabId(domIdPrefix, focusPanelId))?.focus();
      });
    }
  };

  const commitMenuDrop = (
    panel: WorkspacePanelView,
    targetGroup: WorkspaceGroupView,
    target: WorkspacePanelDropRequest["target"],
  ) => {
    const targetNodeId = nodeForGroup(projection, targetGroup.id);
    if (targetNodeId === undefined) return;
    const request = createPanelDropRequest(
      projection,
      panel.id,
      targetGroup.id,
      targetNodeId,
      target,
    );
    if (request === undefined) return;
    const label =
      target.kind === "center"
        ? interactionMessages.movedPanelTo({
            title: panel.title,
            group: targetGroup.label ?? messages.groupFallback(),
          })
        : splitLabel(panel, targetGroup, target.edge, direction, interactionMessages.splitPanel);
    commitPanelDrop(request, label, "menu");
  };

  const externalFromTab = (panel: WorkspacePanelView, origin: "keyboard" | "menu") => {
    const sourceGroup = groupForPanel(projection, panel.id);
    const tab =
      groupRef.current?.ownerDocument.getElementById(panelTabId(domIdPrefix, panel.id)) ?? null;
    if (sourceGroup === undefined || tab === null) return;
    const rect = tab.getBoundingClientRect();
    const ownerWindow = tab.ownerDocument.defaultView;
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const position: WorkspaceExternalPanelPosition = {
      clientX,
      clientY,
      screenX: (ownerWindow?.screenX ?? 0) + clientX,
      screenY: (ownerWindow?.screenY ?? 0) + clientY,
    };
    let outcome: WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
    const controller = new AbortController();
    try {
      outcome = requestExternalPanel({
        panel,
        sourceGroup,
        sourcePanels: panelsForGroup(projection, sourceGroup),
        origin,
        controller,
        position,
      });
    } catch (error) {
      announce(
        error instanceof Error
          ? error.message
          : interactionMessages.couldNotOpenPanelInNewWindow({ title: panel.title }),
      );
      return;
    }
    const handle = (result: WorkspaceExternalPanelOutcome) => {
      if (controller.signal.reason === "surface-unmounted") return;
      announce(
        result.message ??
          (result.status === "committed"
            ? interactionMessages.openedPanelInNewWindow({ title: panel.title })
            : interactionMessages.couldNotOpenPanelInNewWindow({ title: panel.title })),
      );
    };
    if (isPromiseLike(outcome)) void outcome.then(handle, () => handle({ status: "rejected" }));
    else handle(outcome);
  };

  const navigateTabs = (event: KeyboardEvent, currentIndex: number) => {
    const visualPrevious =
      orientation === "vertical" ? "ArrowUp" : direction === "rtl" ? "ArrowRight" : "ArrowLeft";
    const visualNext =
      orientation === "vertical" ? "ArrowDown" : direction === "rtl" ? "ArrowLeft" : "ArrowRight";
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

  const reorderNeighbor = (
    panel: WorkspacePanelView,
    currentIndex: number,
    delta: -1 | 1,
    origin: Extract<WorkspaceCommandOrigin, "keyboard" | "menu">,
  ) => {
    if (createReorderPanelCommand === undefined) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= groupPanels.length) return;
    const anchor = groupPanels[targetIndex];
    if (anchor === undefined) return;
    const placement = delta < 0 ? { beforePanelId: anchor.id } : { afterPanelId: anchor.id };
    const label =
      delta < 0
        ? interactionMessages.movedTabBefore({ title: panel.title, anchor: anchor.title })
        : interactionMessages.movedTabAfter({ title: panel.title, anchor: anchor.title });
    const outcome = dispatch(
      createReorderPanelCommand(panel.id, group.id, placement),
      label,
      origin,
    ).outcome;
    if (outcome.status === "committed" || outcome.status === "queued") {
      queueMicrotask(() => {
        const tab = groupRef.current?.ownerDocument.getElementById(
          panelTabId(domIdPrefix, panel.id),
        );
        if (tab === null || tab === undefined) return;
        reorderFocusPanelRef.current = panel.id;
        tab.focus();
      });
    }
  };

  return (
    <section
      ref={groupRef}
      className="pf-group"
      data-workspace-node={nodeId}
      data-workspace-group={group.id}
      data-active={String(group.panelIds.includes(projection.activePanelId ?? ""))}
      data-tab-placement={presentation.placement}
      data-tab-content={presentation.content}
      data-tab-orientation={orientation}
      data-empty={String(empty)}
      aria-labelledby={groupLabelId}
      aria-describedby={empty ? emptyGroupDescriptionId : undefined}
      style={emptyGroupStyle}
    >
      <h2 id={groupLabelId} className="pf-visually-hidden">
        {emptyGroupLabel}
      </h2>
      {empty ? (
        <div
          id={emptyGroupDescriptionId}
          className="pf-empty-group-placeholder"
          data-workspace-empty-group={group.id}
          role="note"
        >
          <strong>{emptyGroupLabel}</strong>
          <span>{messages.emptyPanelGroupInstructions({ group: emptyGroupLabel })}</span>
          {removeContainerLabel === undefined ? null : (
            <button
              className="pf-empty-group-remove"
              type="button"
              aria-label={removeContainerLabel}
              title={removeContainerLabel}
              onClick={(event) => {
                removePanelContainer(clickOrigin(event));
              }}
            >
              Remove panel container
            </button>
          )}
        </div>
      ) : null}
      {placePanelGroupTabStrip(
        <div className="pf-tab-strip">
          <div
            className="pf-tab-list"
            role="tablist"
            aria-labelledby={groupLabelId}
            aria-orientation={orientation}
          >
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
                  aria-keyshortcuts={panel.closable === false ? undefined : "Delete"}
                  title={panel.title}
                  data-workspace-panel-tab={panel.id}
                  onClick={(event) => {
                    if (isTabCloseAffordance(event.target)) {
                      if (panel.closable !== false) closePanel(panel, clickOrigin(event));
                      return;
                    }
                    if (panelDrag.consumeClick(panel.id)) return;
                    selectPanel(panel, false, clickOrigin(event));
                  }}
                  onPointerDown={(event) => {
                    if (isTabCloseAffordance(event.target)) return;
                    pointerFocusPanelRef.current = panel.id;
                    panelDrag.begin(panel, group, event);
                  }}
                  onPointerMove={panelDrag.move}
                  onPointerUp={panelDrag.finish}
                  onPointerCancel={panelDrag.cancel}
                  onLostPointerCapture={panelDrag.cancel}
                  onFocus={() => {
                    if (reorderFocusPanelRef.current === panel.id) {
                      reorderFocusPanelRef.current = undefined;
                      return;
                    }
                    const origin =
                      pointerFocusPanelRef.current === panel.id ? "pointer" : "keyboard";
                    pointerFocusPanelRef.current = undefined;
                    // Pointer focus belongs to the still revision-bound
                    // drag/click gesture. A normal click selects after
                    // pointerup; activating here would cancel a drag before
                    // its first movement sample by advancing the revision.
                    if (
                      origin === "keyboard" &&
                      selected &&
                      projection.activePanelId !== panel.id
                    ) {
                      dispatch(
                        commands.activatePanel(panel.id),
                        messages.activatedPanel({ title: panel.title }),
                        origin,
                      );
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      !event.nativeEvent.isComposing &&
                      event.altKey &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.shiftKey
                    ) {
                      const visualPrevious =
                        orientation === "vertical"
                          ? "ArrowUp"
                          : direction === "rtl"
                            ? "ArrowRight"
                            : "ArrowLeft";
                      const visualNext =
                        orientation === "vertical"
                          ? "ArrowDown"
                          : direction === "rtl"
                            ? "ArrowLeft"
                            : "ArrowRight";
                      if (event.key === visualPrevious || event.key === visualNext) {
                        event.preventDefault();
                        reorderNeighbor(
                          panel,
                          index,
                          event.key === visualPrevious ? -1 : 1,
                          "keyboard",
                        );
                        return;
                      }
                    }
                    navigateTabs(event, index);
                    panelDrag.keyDown(event);
                    if (event.key === "Delete" && panel.closable !== false) {
                      event.preventDefault();
                      closePanel(panel, "keyboard");
                    }
                  }}
                >
                  {definition?.icon === undefined ||
                  presentation.content === "label-only" ? null : (
                    <span className="pf-tab-icon" aria-hidden="true">
                      {definition.icon}
                    </span>
                  )}
                  <span
                    className={[
                      "pf-tab-title",
                      presentation.content === "icon-only" && definition?.icon !== undefined
                        ? "pf-visually-hidden"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    dir="auto"
                  >
                    {panel.title}
                  </span>
                  {panel.closable === false ? null : (
                    <span
                      className="pf-tab-close"
                      data-workspace-tab-close={panel.id}
                      title={messages.closePanel({ title: panel.title })}
                      aria-hidden="true"
                    >
                      ×
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {moveContainerLabel === undefined ? null : (
            <button
              id={groupMoveHandleId(domIdPrefix, group.id)}
              className="pf-group-drag-region"
              type="button"
              aria-label={moveContainerLabel}
              title={moveContainerLabel}
              data-workspace-group-drag-handle={group.id}
              onClick={() => {
                if (groupDrag.consumeClick(group.id)) return;
                setMoveGroupId(group.id);
              }}
              onPointerDown={(event) => {
                groupDrag.begin(group, event);
              }}
              onPointerMove={groupDrag.move}
              onPointerUp={groupDrag.finish}
              onPointerCancel={groupDrag.cancel}
              onLostPointerCapture={groupDrag.cancel}
              onKeyDown={groupDrag.keyDown}
            />
          )}
          {selectedPanel === undefined ||
          (selectedPanel.closable === false &&
            createMovePanelCommand === undefined &&
            createReorderPanelCommand === undefined &&
            createFloatPanelCommand === undefined &&
            createDropPanelCommand === undefined &&
            moveContainerLabel === undefined &&
            removeContainerLabel === undefined &&
            !externalPanelAvailable) ? null : (
            <div
              id={panelControlsId(domIdPrefix, selectedPanel.id)}
              className="pf-tab-controls"
              data-workspace-panel-controls={selectedPanel.id}
            >
              <TabActions
                panel={selectedPanel}
                groups={Object.values(projection.groups)}
                messages={messages}
                interactionMessages={interactionMessages}
                triggerId={panelActionsId(domIdPrefix, selectedPanel.id)}
                onReorderPrevious={
                  createReorderPanelCommand === undefined ||
                  groupPanels.indexOf(selectedPanel) === 0
                    ? undefined
                    : {
                        label: interactionMessages.moveTabBefore({
                          title: selectedPanel.title,
                          anchor:
                            groupPanels[groupPanels.indexOf(selectedPanel) - 1]?.title ??
                            selectedPanel.title,
                        }),
                        select: () =>
                          reorderNeighbor(
                            selectedPanel,
                            groupPanels.indexOf(selectedPanel),
                            -1,
                            "menu",
                          ),
                      }
                }
                onReorderNext={
                  createReorderPanelCommand === undefined ||
                  groupPanels.indexOf(selectedPanel) === groupPanels.length - 1
                    ? undefined
                    : {
                        label: interactionMessages.moveTabAfter({
                          title: selectedPanel.title,
                          anchor:
                            groupPanels[groupPanels.indexOf(selectedPanel) + 1]?.title ??
                            selectedPanel.title,
                        }),
                        select: () =>
                          reorderNeighbor(
                            selectedPanel,
                            groupPanels.indexOf(selectedPanel),
                            1,
                            "menu",
                          ),
                      }
                }
                onStartKeyboardMove={
                  createMovePanelCommand === undefined && createDropPanelCommand === undefined
                    ? undefined
                    : () => {
                        setMovePanelId(selectedPanel.id);
                      }
                }
                onMove={
                  createMovePanelCommand === undefined && createDropPanelCommand === undefined
                    ? undefined
                    : (targetGroupId) => {
                        const targetGroup = projection.groups[targetGroupId];
                        if (targetGroup === undefined) return;
                        if (createDropPanelCommand !== undefined) {
                          commitMenuDrop(selectedPanel, targetGroup, {
                            kind: "center",
                            ratio: 1,
                          });
                        } else if (createMovePanelCommand !== undefined) {
                          dispatch(
                            createMovePanelCommand(selectedPanel.id, targetGroupId),
                            messages.movedPanel({ title: selectedPanel.title }),
                            "menu",
                          );
                        }
                      }
                }
                onSplit={
                  createDropPanelCommand === undefined || group.panelIds.length <= 1
                    ? undefined
                    : (edge) => {
                        commitMenuDrop(selectedPanel, group, {
                          kind: "edge",
                          edge,
                          ratio: 0.5,
                        });
                      }
                }
                direction={direction}
                onExternal={
                  externalPanelAvailable
                    ? (origin) => externalFromTab(selectedPanel, origin)
                    : undefined
                }
                onFloat={
                  createFloatPanelCommand === undefined
                    ? undefined
                    : () => {
                        dispatch(
                          createFloatPanelCommand(selectedPanel.id),
                          messages.floatedPanel({ title: selectedPanel.title }),
                          "menu",
                        );
                      }
                }
                onClose={
                  selectedPanel.closable === false
                    ? undefined
                    : () => closePanel(selectedPanel, "menu")
                }
                onStartKeyboardGroupMove={
                  moveContainerLabel === undefined ? undefined : () => setMoveGroupId(group.id)
                }
                moveContainerLabel={moveContainerLabel}
                removeContainerAction={
                  removeContainerLabel === undefined
                    ? undefined
                    : {
                        label: removeContainerLabel,
                        select: () => removePanelContainer("menu"),
                      }
                }
              />
            </div>
          )}
        </div>,
        floatingHeaderTarget,
      )}
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

/**
 * Undefined keeps the strip inline, null hides it while the compact-header ref
 * resolves, and an element receives the existing strip through a portal.
 */
function placePanelGroupTabStrip(
  tabStrip: ReactNode,
  target: HTMLDivElement | null | undefined,
): ReactNode {
  if (target === undefined) return tabStrip;
  return target === null ? null : createPortal(tabStrip, target);
}

interface TabActionsProps {
  readonly panel: WorkspacePanelView;
  readonly groups: readonly WorkspaceGroupView[];
  readonly messages: WorkspaceMessageCatalog;
  readonly interactionMessages: ResolvedWorkspaceInteractionMessages;
  readonly triggerId: string;
  readonly onReorderPrevious: TabReorderMenuAction | undefined;
  readonly onReorderNext: TabReorderMenuAction | undefined;
  readonly onStartKeyboardMove: (() => void) | undefined;
  readonly onMove: ((groupId: string) => void) | undefined;
  readonly onFloat: (() => void) | undefined;
  readonly onSplit: ((edge: WorkspaceLogicalEdge) => void) | undefined;
  readonly direction: WorkspaceDirection;
  readonly onExternal: ((origin: "keyboard" | "menu") => void) | undefined;
  readonly onClose: (() => void) | undefined;
  readonly onStartKeyboardGroupMove: (() => void) | undefined;
  readonly moveContainerLabel: string | undefined;
  readonly removeContainerAction: TabReorderMenuAction | undefined;
}

interface TabReorderMenuAction {
  readonly label: string;
  readonly select: () => void;
}

function TabActions({
  panel,
  groups,
  messages,
  interactionMessages,
  triggerId,
  onReorderPrevious,
  onReorderNext,
  onStartKeyboardMove,
  onMove,
  onFloat,
  onSplit,
  direction,
  onExternal,
  onClose,
  onStartKeyboardGroupMove,
  moveContainerLabel,
  removeContainerAction,
}: TabActionsProps) {
  const [open, setOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ownerDocument = actionsRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    const dismissOutside = (event: Event) => {
      const NodeConstructor = ownerDocument.defaultView?.Node;
      if (
        NodeConstructor !== undefined &&
        event.target instanceof NodeConstructor &&
        actionsRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    ownerDocument.addEventListener("focusin", dismissOutside);
    return () => {
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
      ownerDocument.removeEventListener("focusin", dismissOutside);
    };
  }, [open]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    queueMicrotask(() => {
      triggerRef.current?.focus();
    });
  };

  return (
    <div ref={actionsRef} className="pf-tab-actions">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="pf-tab-more"
        aria-label={messages.actionsForPanel({ title: panel.title })}
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
          aria-label={messages.panelActions({ title: panel.title })}
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
          {onReorderPrevious === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onReorderPrevious.select();
              }}
            >
              {onReorderPrevious.label}
            </button>
          )}
          {onReorderNext === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onReorderNext.select();
              }}
            >
              {onReorderNext.label}
            </button>
          )}
          {onStartKeyboardMove === undefined || onMove === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onStartKeyboardMove();
              }}
            >
              {messages.chooseDestination()}
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
                  {messages.moveToGroup({
                    group: group.label ?? messages.groupFallback(),
                  })}
                </button>
              ))}
          {onSplit === undefined
            ? null
            : (["inline-start", "inline-end", "block-start", "block-end"] as const).map((edge) => (
                <button
                  key={edge}
                  role="menuitem"
                  type="button"
                  onClick={(event) => {
                    const ownerDocument = event.currentTarget.ownerDocument;
                    setOpen(false);
                    onSplit(edge);
                    if (event.detail === 0) {
                      queueMicrotask(() => ownerDocument.getElementById(triggerId)?.focus());
                    }
                  }}
                >
                  {interactionMessages.splitEdge({
                    edge: logicalEdgeLabel(edge, direction),
                  })}
                </button>
              ))}
          {onExternal === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={(event) => {
                const ownerDocument = event.currentTarget.ownerDocument;
                setOpen(false);
                onExternal(event.detail === 0 ? "keyboard" : "menu");
                if (event.detail === 0) {
                  queueMicrotask(() => ownerDocument.getElementById(triggerId)?.focus());
                }
              }}
            >
              {interactionMessages.openInNewWindow()}
            </button>
          )}
          {panel.floatable === false || onFloat === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onFloat();
              }}
            >
              {messages.floatPanel({ title: panel.title })}
            </button>
          )}
          {onClose === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onClose();
              }}
            >
              {messages.closePanel({ title: panel.title })}
            </button>
          )}
          {moveContainerLabel === undefined && removeContainerAction === undefined ? null : (
            <div className="pf-menu-separator" role="separator" />
          )}
          {moveContainerLabel === undefined || onStartKeyboardGroupMove === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onStartKeyboardGroupMove();
              }}
            >
              {moveContainerLabel}
            </button>
          )}
          {removeContainerAction === undefined ? null : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                removeContainerAction.select();
              }}
            >
              {removeContainerAction.label}
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
  readonly messages: WorkspaceMessageCatalog;
  readonly direction: WorkspaceDirection;
  readonly announce: (message: string) => void;
  readonly onMove: (groupId: string) => void;
  readonly onSplit: ((edge: WorkspaceLogicalEdge) => void) | undefined;
  readonly onExternal: (() => void) | undefined;
  readonly onCancel: () => void;
}

function KeyboardMoveOverlay({
  panel,
  groups,
  messages,
  direction,
  announce,
  onMove,
  onSplit,
  onExternal,
  onCancel,
}: KeyboardMoveOverlayProps) {
  const [index, setIndex] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const announcedDestinationIdRef = useRef<string | undefined>(undefined);
  const interactionMessages = resolveWorkspaceInteractionMessages(messages);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const sourceGroup = groups.find((group) => group.panelIds.includes(panel?.id ?? ""));
  const destinations: readonly KeyboardPanelDestination[] = [
    ...groups.map((group) => ({
      id: `group:${group.id}`,
      kind: "group" as const,
      label: group.label ?? messages.groupFallback(),
      commit: () => onMove(group.id),
    })),
    ...(onSplit === undefined || sourceGroup === undefined || sourceGroup.panelIds.length <= 1
      ? []
      : (["inline-start", "inline-end", "block-start", "block-end"] as const).map((edge) => ({
          id: `edge:${edge}`,
          kind: "edge" as const,
          label: interactionMessages.splitEdge({ edge: logicalEdgeLabel(edge, direction) }),
          commit: () => onSplit(edge),
        }))),
    ...(onExternal === undefined
      ? []
      : [
          {
            id: "external",
            kind: "external" as const,
            label: interactionMessages.openInNewWindow(),
            commit: onExternal,
          },
        ]),
  ];
  const selectedDestination = destinations[index];
  const selectedDestinationId = selectedDestination?.id;
  const selectedDestinationLabel = selectedDestination?.label;
  useEffect(() => {
    if (
      selectedDestinationId === undefined ||
      selectedDestinationLabel === undefined ||
      announcedDestinationIdRef.current === selectedDestinationId
    ) {
      return;
    }
    announcedDestinationIdRef.current = selectedDestinationId;
    announce(selectedDestinationLabel);
  }, [announce, selectedDestinationId, selectedDestinationLabel]);

  return (
    <div
      ref={overlayRef}
      className="pf-keyboard-move"
      role="dialog"
      aria-label={messages.movePanelDialog({
        title: panel?.title ?? messages.panelFallback(),
      })}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          setIndex((value) => (value + 1) % Math.max(1, destinations.length));
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          setIndex(
            (value) =>
              (value - 1 + Math.max(1, destinations.length)) % Math.max(1, destinations.length),
          );
        }
        if (event.key === "Home" && destinations.length > 0) {
          event.preventDefault();
          setIndex(0);
        }
        if (event.key === "End" && destinations.length > 0) {
          event.preventDefault();
          setIndex(destinations.length - 1);
        }
        if (event.key === "Tab" && destinations.length > 0) {
          event.preventDefault();
          setIndex((value) =>
            nextKeyboardDestinationClassIndex(destinations, value, event.shiftKey ? -1 : 1),
          );
        }
        if (event.key === "Enter" && selectedDestination !== undefined) {
          event.preventDefault();
          selectedDestination.commit();
        }
      }}
    >
      <p className="pf-keyboard-move-eyebrow">{messages.chooseDestination()}</p>
      <strong>{selectedDestination?.label ?? messages.noAvailableGroup()}</strong>
      <p>{messages.moveInstructions()}</p>
      <div className="pf-keyboard-move-dots" aria-hidden="true">
        {destinations.map((destination, destinationIndex) => (
          <span key={destination.id} data-current={String(destinationIndex === index)} />
        ))}
      </div>
    </div>
  );
}

interface KeyboardGroupMoveOverlayProps<TCommand> {
  readonly group: WorkspaceGroupView | undefined;
  readonly candidates: readonly GroupDropCandidate<TCommand>[];
  readonly messages: WorkspaceMessageCatalog;
  readonly announce: (message: string) => void;
  readonly onMove: (candidate: GroupDropCandidate<TCommand>) => void;
  readonly onCancel: () => void;
}

function KeyboardGroupMoveOverlay<TCommand>({
  group,
  candidates,
  messages,
  announce,
  onMove,
  onCancel,
}: KeyboardGroupMoveOverlayProps<TCommand>) {
  const [index, setIndex] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const announcedDestinationIdRef = useRef<string | undefined>(undefined);
  const interactionMessages = resolveWorkspaceInteractionMessages(messages);
  const normalizedIndex = candidates.length === 0 ? 0 : Math.min(index, candidates.length - 1);
  const selectedCandidate = candidates[normalizedIndex];

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  useEffect(() => {
    if (
      selectedCandidate === undefined ||
      announcedDestinationIdRef.current === selectedCandidate.id
    ) {
      return;
    }
    announcedDestinationIdRef.current = selectedCandidate.id;
    announce(selectedCandidate.label);
  }, [announce, selectedCandidate]);

  return (
    <div
      ref={overlayRef}
      className="pf-keyboard-move"
      role="dialog"
      aria-label={interactionMessages.movePanelContainer({
        group: group?.label ?? messages.panelGroupFallback(),
      })}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "Tab") {
          event.preventDefault();
          const delta = event.key === "Tab" && event.shiftKey ? -1 : 1;
          setIndex(
            (value) =>
              (value + delta + Math.max(1, candidates.length)) % Math.max(1, candidates.length),
          );
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          setIndex(
            (value) =>
              (value - 1 + Math.max(1, candidates.length)) % Math.max(1, candidates.length),
          );
          return;
        }
        if (event.key === "Home" && candidates.length > 0) {
          event.preventDefault();
          setIndex(0);
          return;
        }
        if (event.key === "End" && candidates.length > 0) {
          event.preventDefault();
          setIndex(candidates.length - 1);
          return;
        }
        if (event.key === "Enter" && selectedCandidate !== undefined) {
          event.preventDefault();
          onMove(selectedCandidate);
        }
      }}
    >
      <p className="pf-keyboard-move-eyebrow">{messages.chooseDestination()}</p>
      <strong>{selectedCandidate?.label ?? messages.noAvailableGroup()}</strong>
      <p>{messages.moveInstructions()}</p>
      <div className="pf-keyboard-move-dots" aria-hidden="true">
        {candidates.map((candidate, candidateIndex) => (
          <span key={candidate.id} data-current={String(candidateIndex === normalizedIndex)} />
        ))}
      </div>
    </div>
  );
}

interface KeyboardPanelDestination {
  readonly id: string;
  readonly kind: "group" | "edge" | "external";
  readonly label: string;
  readonly commit: () => void;
}

const KEYBOARD_DESTINATION_CLASS_ORDER: readonly KeyboardPanelDestination["kind"][] = [
  "group",
  "edge",
  "external",
];

function nextKeyboardDestinationClassIndex(
  destinations: readonly KeyboardPanelDestination[],
  currentIndex: number,
  delta: -1 | 1,
): number {
  const availableKinds = KEYBOARD_DESTINATION_CLASS_ORDER.filter((kind) =>
    destinations.some((destination) => destination.kind === kind),
  );
  if (availableKinds.length <= 1) return currentIndex;
  const currentKind = destinations[currentIndex]?.kind ?? availableKinds[0];
  const classIndex = currentKind === undefined ? 0 : availableKinds.indexOf(currentKind);
  const nextKind =
    availableKinds[(classIndex + delta + availableKinds.length) % availableKinds.length];
  const nextIndex = destinations.findIndex((destination) => destination.kind === nextKind);
  return nextIndex < 0 ? currentIndex : nextIndex;
}

interface PanelPortalsProps {
  readonly projection: WorkspaceProjection;
  readonly registry: WorkspacePanelRegistry;
  readonly hosts: ReadonlyMap<string, HostRecord>;
  readonly messages: WorkspaceMessageCatalog;
  readonly ownershipRevision: number;
  readonly surfaceDocument: Document | undefined;
  readonly visibleGroupIds: ReadonlySet<string>;
}

function PanelPortals({
  projection,
  registry,
  hosts,
  messages,
  ownershipRevision,
  surfaceDocument,
  visibleGroupIds,
}: PanelPortalsProps) {
  // The revision is deliberately read here: adopting an existing portal host
  // does not itself participate in React reconciliation.
  void ownershipRevision;
  const groupByPanelId = useMemo(() => {
    const result = new Map<string, WorkspaceGroupView>();
    for (const group of Object.values(projection.groups)) {
      for (const panelId of group.panelIds) result.set(panelId, group);
    }
    return result;
  }, [projection.groups]);
  return (
    <>
      {Object.values(projection.panels).map((panel) => {
        const host = hosts.get(panel.id)?.element;
        const definition = registry[panel.type];
        if (host === undefined) return null;
        const group = groupByPanelId.get(panel.id);
        const inExternalDocument =
          surfaceDocument !== undefined && host.ownerDocument !== surfaceDocument;
        const selected =
          inExternalDocument ||
          (group !== undefined &&
            visibleGroupIds.has(group.id) &&
            group.selectedPanelId === panel.id);
        const active = projection.activePanelId === panel.id;
        const policy = panelLifecyclePolicy(panel);
        const lifecycle = panelLifecycle(selected, active, policy);
        if (!selected && policy.hidden === "detach") return null;
        const content =
          definition === undefined ? (
            <MissingPanel panel={panel} messages={messages} />
          ) : (
            <StablePanelContent
              definition={definition}
              panel={panel}
              revision={projection.revision}
              ownershipRevision={ownershipRevision}
              groupId={group?.id}
              selected={selected}
              active={active}
              lifecycle={lifecycle}
              policy={policy}
            />
          );

        return createPortal(
          <PanelBoundary key={panel.id} panel={panel} messages={messages}>
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
  readonly ownershipRevision: number;
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
  ownershipRevision,
  selected,
}: PanelContentProps) {
  void ownershipRevision;
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

/**
 * A pure tab reorder changes projection revision and tab order, but none of a
 * panel renderer's inputs. Keep heavy portal content out of that reconciliation
 * path while allowing lifecycle, registry, or panel changes through normally.
 */
const StablePanelContent = memo(
  PanelContent,
  (previous, next) =>
    previous.active === next.active &&
    previous.definition === next.definition &&
    previous.groupId === next.groupId &&
    previous.lifecycle === next.lifecycle &&
    previous.ownershipRevision === next.ownershipRevision &&
    samePanelView(previous.panel, next.panel) &&
    samePanelLifecyclePolicy(previous.policy, next.policy) &&
    previous.selected === next.selected,
);

/**
 * Projection adapters commonly recreate their small panel view objects for
 * every runtime snapshot. Treat the declared scalar fields and lifecycle
 * policy as values, while retaining reference semantics for application-owned
 * `parameters`: an arbitrary parameter object may carry identity that is
 * meaningful to its renderer.
 */
function samePanelView(previous: WorkspacePanelView, next: WorkspacePanelView): boolean {
  return (
    previous === next ||
    (previous.id === next.id &&
      previous.type === next.type &&
      previous.title === next.title &&
      previous.closable === next.closable &&
      previous.floatable === next.floatable &&
      Object.is(previous.parameters, next.parameters) &&
      sameOptionalPanelLifecyclePolicy(previous.lifecyclePolicy, next.lifecyclePolicy))
  );
}

function sameOptionalPanelLifecyclePolicy(
  previous: WorkspacePanelLifecyclePolicy | undefined,
  next: WorkspacePanelLifecyclePolicy | undefined,
): boolean {
  if (previous === undefined || next === undefined) return previous === next;
  return samePanelLifecyclePolicy(previous, next);
}

function samePanelLifecyclePolicy(
  previous: WorkspacePanelLifecyclePolicy,
  next: WorkspacePanelLifecyclePolicy,
): boolean {
  return (
    previous === next ||
    (previous.hidden === next.hidden &&
      previous.sameDocumentMove === next.sameDocumentMove &&
      previous.crossDocumentMove === next.crossDocumentMove)
  );
}

function MissingPanel({
  panel,
  messages,
}: {
  readonly panel: WorkspacePanelView;
  readonly messages: WorkspaceMessageCatalog;
}) {
  return (
    <section className="pf-panel-placeholder">
      <strong>{panel.title}</strong>
      <p>{messages.missingRenderer({ type: panel.type })}</p>
    </section>
  );
}

function WorkspaceEmptyState({ messages }: { readonly messages: WorkspaceMessageCatalog }) {
  return (
    <section className="pf-empty-state">
      <strong>{messages.noWorkspaceLayout()}</strong>
      <p>{messages.emptyWorkspaceInstructions()}</p>
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

function groupMoveHandleId(prefix: string, groupId: string) {
  return `${prefix}-group-move-${encodeDomId(groupId)}`;
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

type ResizeActor = ReturnType<typeof createResizeActor>;

interface PointerResizeSample {
  readonly coordinate: number;
  readonly position: { readonly inline: number; readonly block: number };
}

interface PointerResizeSession {
  readonly actor: ResizeActor;
  readonly pointerId: number;
  readonly startCoordinate: number;
  readonly beforeSize: number;
  readonly afterSize: number;
  readonly weights: readonly number[];
  readonly captureElement: HTMLDivElement;
  latest: readonly number[];
  pending: PointerResizeSample | undefined;
}

const ZERO_LOGICAL_RECT: LogicalRect = Object.freeze({
  inlineStart: 0,
  blockStart: 0,
  inlineSize: 0,
  blockSize: 0,
});

const EMPTY_SPLIT_OVERRIDES: Readonly<Record<string, SplitLayoutOverride>> = Object.freeze({});
const EMPTY_FLOATING_SURFACES: readonly WorkspaceFloatingSurfaceView[] = Object.freeze([]);

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

function mergeResolvedLayouts(
  main: ResolvedLayout,
  floating: readonly ResolvedLayout[],
): ResolvedLayout {
  const layouts = [main, ...floating];
  return {
    rootNodeId: main.rootNodeId,
    nodeRects: Object.assign({}, ...layouts.map((layout) => layout.nodeRects)),
    groupRects: Object.assign({}, ...layouts.map((layout) => layout.groupRects)),
    splitters: layouts.flatMap((layout) => layout.splitters),
    collapsedNodeIds: layouts.flatMap((layout) => layout.collapsedNodeIds),
    diagnostics: layouts.flatMap((layout) => layout.diagnostics),
  };
}

interface ResolvedLayoutPreviewTargets {
  readonly splitChildren: readonly HTMLElement[];
  readonly splitters: readonly HTMLElement[];
}

const RESOLVED_LAYOUT_PREVIEW_TARGETS = new WeakMap<HTMLElement, ResolvedLayoutPreviewTargets>();

function applyResolvedLayoutPreview(root: HTMLElement | null, layout: ResolvedLayout): void {
  if (root === null) return;
  let targets = RESOLVED_LAYOUT_PREVIEW_TARGETS.get(root);
  if (
    targets === undefined ||
    targets.splitters.length !== layout.splitters.length ||
    targets.splitChildren.some((element) => !root.contains(element)) ||
    targets.splitters.some((element) => !root.contains(element))
  ) {
    targets = {
      splitChildren: Array.from(root.querySelectorAll<HTMLElement>("[data-workspace-split-child]")),
      splitters: Array.from(root.querySelectorAll<HTMLElement>("[data-workspace-splitter]")),
    };
    RESOLVED_LAYOUT_PREVIEW_TARGETS.set(root, targets);
  }

  for (const element of targets.splitChildren) {
    const nodeId = element.dataset.workspaceSplitChild;
    const axis = element.parentElement?.dataset.axis;
    const rect = nodeId === undefined ? undefined : layout.nodeRects[nodeId];
    if (rect === undefined || (axis !== "inline" && axis !== "block")) continue;
    element.dataset.inlineSize = String(rect.inlineSize);
    element.dataset.blockSize = String(rect.blockSize);
    element.style.setProperty("--pf-split-size", `${axisSize(rect, axis)}px`);
  }

  const splitters = new Map(layout.splitters.map((item) => [item.id, item] as const));
  for (const element of targets.splitters) {
    const splitterId = element.dataset.workspaceSplitter;
    const resolved = splitterId === undefined ? undefined : splitters.get(splitterId);
    const axis = element.getAttribute("aria-orientation") === "vertical" ? "inline" : "block";
    if (resolved === undefined) continue;
    element.dataset.inlineStart = String(resolved.rect.inlineStart);
    element.dataset.blockStart = String(resolved.rect.blockStart);
    element.style.setProperty("--pf-splitter-size", `${axisSize(resolved.rect, axis)}px`);
  }
}

function adjacentGroupForNode(
  projection: WorkspaceProjection,
  sourceNodeId: string,
): WorkspaceGroupView | undefined {
  const parent = Object.values(projection.nodes).find(
    (node) => node.kind === "split" && node.childIds.includes(sourceNodeId),
  );
  if (parent === undefined || parent.kind !== "split") return undefined;
  const sourceIndex = parent.childIds.indexOf(sourceNodeId);
  if (sourceIndex < 0) return undefined;
  const candidateIndexes =
    sourceIndex === 0
      ? [1]
      : sourceIndex === parent.childIds.length - 1
        ? [sourceIndex - 1]
        : [sourceIndex - 1, sourceIndex + 1];
  for (const candidateIndex of candidateIndexes) {
    const candidateId = parent.childIds[candidateIndex];
    if (candidateId === undefined) continue;
    const groupId = boundaryGroupForNode(
      projection,
      candidateId,
      candidateIndex < sourceIndex ? "end" : "start",
      new Set(),
    );
    if (groupId === undefined) continue;
    const group = projection.groups[groupId];
    if (group !== undefined) return group;
  }
  return undefined;
}

function boundaryGroupForNode(
  projection: WorkspaceProjection,
  nodeId: string,
  boundary: "start" | "end",
  visited: Set<string>,
): string | undefined {
  if (visited.has(nodeId)) return undefined;
  visited.add(nodeId);
  const node = projection.nodes[nodeId];
  if (node === undefined) return undefined;
  if (node.kind === "group") return node.groupId;
  const childIds = boundary === "start" ? node.childIds : [...node.childIds].reverse();
  for (const childId of childIds) {
    const groupId = boundaryGroupForNode(projection, childId, boundary, visited);
    if (groupId !== undefined) return groupId;
  }
  return undefined;
}

function subtreeHasEmptyGroup(
  projection: WorkspaceProjection,
  nodeId: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  const node = projection.nodes[nodeId];
  if (node === undefined) return false;
  if (node.kind === "group") return projection.groups[node.groupId]?.panelIds.length === 0;
  return node.childIds.some((childId) => subtreeHasEmptyGroup(projection, childId, visited));
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

function solvedPairWeights(
  split: WorkspaceSplitView,
  requestedWeights: readonly number[],
  solvedLayout: ResolvedLayout,
  beforeIndex: number,
  afterIndex: number,
): readonly number[] {
  const beforeNodeId = split.childIds[beforeIndex];
  const afterNodeId = split.childIds[afterIndex];
  const solvedBefore = axisSize(
    beforeNodeId === undefined ? undefined : solvedLayout.nodeRects[beforeNodeId],
    split.axis,
  );
  const solvedAfter = axisSize(
    afterNodeId === undefined ? undefined : solvedLayout.nodeRects[afterNodeId],
    split.axis,
  );
  const solvedTotal = solvedBefore + solvedAfter;
  if (solvedTotal <= 0) return requestedWeights;

  const pairWeight =
    positiveNumber(requestedWeights[beforeIndex]) + positiveNumber(requestedWeights[afterIndex]);
  const minimum = Math.min(pairWeight / 2, Math.max(pairWeight * 0.000001, 0.000001));
  const nextBefore = clamp(
    pairWeight * (solvedBefore / solvedTotal),
    minimum,
    pairWeight - minimum,
  );
  const solvedWeights = [...requestedWeights];
  solvedWeights[beforeIndex] = nextBefore;
  solvedWeights[afterIndex] = pairWeight - nextBefore;
  return solvedWeights;
}

function settleCommit(
  outcome: WorkspaceDispatchOutcome,
  send: (event: ResizeEvent) => string,
  messages: WorkspaceMessageCatalog,
): void {
  if (outcome.status === "committed" || outcome.status === "queued") {
    send({ type: "COMMIT_OK" });
    send({ type: "SETTLED" });
    return;
  }
  send({
    type: "COMMIT_ERROR",
    message: outcome.message ?? messages.resizeDidNotCommit({ status: outcome.status }),
  });
  send({ type: "RETURNED" });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function updateStableHost(
  host: HostRecord,
  options: {
    readonly active: boolean;
    readonly lifecycle: WorkspacePanelLifecycle;
    readonly labelledBy?: string;
    readonly label?: string;
    readonly panelType: string | undefined;
    readonly selected: boolean;
  },
) {
  const nextState: StableHostState = {
    active: options.active,
    lifecycle: options.lifecycle,
    labelledBy: options.labelledBy,
    label: options.label,
    panelType: options.panelType,
    selected: options.selected,
  };
  if (stableHostStatesEqual(host.cache.state, nextState)) return;

  const { element } = host;
  element.hidden = !options.selected;
  element.inert = !options.selected;
  element.setAttribute("aria-hidden", options.selected ? "false" : "true");
  if (options.labelledBy === undefined) element.removeAttribute("aria-labelledby");
  else element.setAttribute("aria-labelledby", options.labelledBy);
  if (options.label === undefined) element.removeAttribute("aria-label");
  else element.setAttribute("aria-label", options.label);
  element.dataset.active = String(options.active);
  element.dataset.lifecycle = options.lifecycle;
  if (options.panelType === undefined) delete element.dataset.panelType;
  else element.dataset.panelType = options.panelType;
  host.cache.state = nextState;
}

function updateHostDestinationCache(host: HostRecord, destination: Element | null): void {
  host.cache.destination = destination;
}

function stableHostStatesEqual(
  previous: StableHostState | undefined,
  next: StableHostState,
): boolean {
  return (
    previous !== undefined &&
    previous.active === next.active &&
    previous.lifecycle === next.lifecycle &&
    previous.labelledBy === next.labelledBy &&
    previous.label === next.label &&
    previous.panelType === next.panelType &&
    previous.selected === next.selected
  );
}

function prepareHostForExternalAccessibility(host: HostRecord, panelTitle: string) {
  host.cache.state = undefined;
  host.element.removeAttribute("aria-labelledby");
  host.element.setAttribute("aria-label", panelTitle);
}

function finalizeExternalHostAccessibility(
  host: HostRecord,
  panelTitle: string,
  labelledBy: string,
  surfaceDocument: Document | undefined,
) {
  host.cache.destination = host.element.parentElement;
  host.cache.state = undefined;
  if (surfaceDocument !== undefined && host.element.ownerDocument === surfaceDocument) {
    host.element.setAttribute("aria-labelledby", labelledBy);
    host.element.removeAttribute("aria-label");
    return;
  }
  host.element.removeAttribute("aria-labelledby");
  host.element.setAttribute("aria-label", panelTitle);
  host.element.hidden = false;
  host.element.inert = false;
  host.element.setAttribute("aria-hidden", "false");
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

function isTabCloseAffordance(target: EventTarget): boolean {
  return target instanceof Element && target.closest("[data-workspace-tab-close]") !== null;
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

function orderedGroups(
  projection: WorkspaceProjection,
  rootNodeId = projection.rootNodeId,
  includeUnreachable = true,
): readonly WorkspaceGroupView[] {
  const ordered: WorkspaceGroupView[] = [];
  const visitedNodes = new Set<string>();
  const visit = (nodeId: string) => {
    if (visitedNodes.has(nodeId)) return;
    visitedNodes.add(nodeId);
    const node = projection.nodes[nodeId];
    if (node?.kind === "group") {
      const group = projection.groups[node.groupId];
      if (group !== undefined) ordered.push(group);
      return;
    }
    if (node?.kind === "split") {
      for (const childId of node.childIds) visit(childId);
    }
  };
  visit(rootNodeId);
  if (includeUnreachable) {
    for (const group of Object.values(projection.groups)) {
      if (!ordered.some((candidate) => candidate.id === group.id)) ordered.push(group);
    }
  }
  return ordered;
}

function groupBelongsToFloatingSurface(projection: WorkspaceProjection, groupId: string): boolean {
  const groupNode = Object.values(projection.nodes).find(
    (node) => node.kind === "group" && node.groupId === groupId,
  );
  if (groupNode === undefined) return false;
  return (projection.floatingSurfaces ?? EMPTY_FLOATING_SURFACES).some((surface) =>
    subtreeContainsNode(projection, surface.rootNodeId, groupNode.id),
  );
}

function floatingSurfaceTitle(
  surface: WorkspaceFloatingSurfaceView,
  projection: WorkspaceProjection,
  fallback: string,
): string {
  if (surface.label?.trim()) return surface.label;
  const groups = orderedGroups(projection, surface.rootNodeId, false);
  if (groups.length === 1) {
    const group = groups[0];
    const panel = group === undefined ? undefined : projection.panels[group.selectedPanelId];
    return panel?.title ?? group?.label ?? fallback;
  }
  return groups[0]?.label ?? fallback;
}

function singlePanelFloatingGroupId(
  surface: WorkspaceFloatingSurfaceView,
  projection: WorkspaceProjection,
): string | undefined {
  const groups = orderedGroups(projection, surface.rootNodeId, false);
  const group = groups.length === 1 ? groups[0] : undefined;
  const panelId = group?.panelIds.length === 1 ? group.panelIds[0] : undefined;
  return group !== undefined && panelId !== undefined && projection.panels[panelId] !== undefined
    ? group.id
    : undefined;
}

function floatingSurfaceSelectedPanelId(
  surface: WorkspaceFloatingSurfaceView,
  projection: WorkspaceProjection,
): string | undefined {
  return orderedGroups(projection, surface.rootNodeId, false).find(
    (group) => projection.panels[group.selectedPanelId] !== undefined,
  )?.selectedPanelId;
}

function defaultResultInterpreter<TCommand, TResult>(
  result: TResult,
  context: WorkspaceDispatchContext<TCommand>,
  messages: WorkspaceMessageCatalog,
): WorkspaceDispatchOutcome {
  if (!isRecord(result)) return { status: "unknown" };
  const status = result.status;
  if (status === "committed") {
    return { status, message: context.label };
  }
  if (status === "queued") {
    return { status, message: messages.commandQueued({ label: context.label }) };
  }
  if (status === "rejected") {
    const reason = extractErrorMessage(result);
    return {
      status,
      message: messages.commandRejected({
        label: context.label,
        ...(reason === undefined ? {} : { reason }),
      }),
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

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

function boundedExternalOutcome(
  outcome: Promise<WorkspaceExternalPanelOutcome>,
  controller: AbortController,
  timeoutMs: number,
  finalize: () => void,
): Promise<WorkspaceExternalPanelOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timerRef: { current?: ReturnType<typeof globalThis.setTimeout> } = {};
    const cleanup = () => {
      if (timerRef.current !== undefined) globalThis.clearTimeout(timerRef.current);
      controller.signal.removeEventListener("abort", handleAbort);
      finalize();
    };
    const complete = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const handleAbort = () => complete(() => reject(controller.signal.reason));

    controller.signal.addEventListener("abort", handleAbort, { once: true });
    if (controller.signal.aborted) {
      handleAbort();
      return;
    }
    timerRef.current = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
    void outcome.then(
      (result) => complete(() => resolve(result)),
      (error: unknown) => complete(() => reject(error)),
    );
  });
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
