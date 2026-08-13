import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { LogicalRect, ResolvedLayout } from "@panefold/geometry";
import type { SurfaceFrameScheduler } from "@panefold/motion";
import { createDragActor, type DragEvent } from "@panefold/protocol-xstate";
import { revision } from "@panefold/model";

import {
  createPanelDropCandidates,
  hitTestPanelDropCandidates,
  panelsForGroup,
  type PanelDropCandidate,
} from "./panel-drop";
import {
  createTabReorderIndex,
  hitTestTabReorder,
  resolveTabReorderCandidate,
  translateTabReorderIndex,
  type PhysicalTabRect,
  type TabReorderCandidate,
  type TabReorderIndex,
  type TabReorderShift,
  type TabStripOrientation,
} from "./tab-reorder";
import type { ResolvedWorkspaceInteractionMessages } from "./messages";
import type {
  WorkspaceDirection,
  WorkspaceDispatchOutcome,
  WorkspaceExternalPanelOutcome,
  WorkspaceExternalPanelPosition,
  WorkspaceGroupView,
  WorkspacePanelDropRequest,
  WorkspacePanelDropPlan,
  WorkspacePanelDropPlanContext,
  WorkspacePanelView,
  WorkspaceProjection,
  WorkspacePanelReorderPlacement,
} from "./types";

type DragActorState =
  "idle" | "armed" | "dragging" | "committing" | "settling" | "cancelling" | "recovering";
type DragActor = ReturnType<typeof createDragActor>;

interface ExternalCandidate {
  readonly kind: "external";
  readonly id: "external";
  readonly label: string;
  readonly available: boolean;
}

interface InternalCandidate<TCommand = unknown> {
  readonly kind: "internal";
  readonly candidate: PanelDropCandidate<TCommand>;
}

interface ReorderCandidate {
  readonly kind: "reorder";
  readonly candidate: TabReorderCandidate;
}

type ActiveCandidate<TCommand = unknown> =
  ExternalCandidate | InternalCandidate<TCommand> | ReorderCandidate;

interface DragSession<TCommand = unknown> {
  readonly actor: DragActor;
  readonly panel: WorkspacePanelView;
  readonly sourceGroup: WorkspaceGroupView;
  readonly projection: WorkspaceProjection;
  readonly layout: ResolvedLayout;
  readonly bounds: LogicalRect;
  /** Physical surface geometry captured once when pointer ownership begins. */
  readonly rootRect: PhysicalRect;
  readonly direction: WorkspaceDirection;
  readonly geometryEpoch: string;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly captureElement: HTMLElement;
  readonly candidates: readonly PanelDropCandidate<TCommand>[];
  reorderIndex: TabReorderIndex<TCommand> | undefined;
  readonly reorderScrollElement: HTMLElement | undefined;
  readonly reorderGeometry: TabReorderGeometry | undefined;
  readonly reorderScrollPosition: { left: number; top: number };
  reorderScrollChanged: boolean;
  reorderResizeObserver: ResizeObserver | undefined;
  current: WorkspaceExternalPanelPosition;
  pending: WorkspaceExternalPanelPosition | undefined;
  target: ActiveCandidate<TCommand> | undefined;
}

export interface ExternalPanelInvocation {
  readonly panel: WorkspacePanelView;
  readonly sourceGroup: WorkspaceGroupView;
  readonly sourcePanels: readonly WorkspacePanelView[];
  readonly origin: "pointer" | "keyboard" | "menu";
  readonly position: WorkspaceExternalPanelPosition;
  readonly controller: AbortController;
  readonly pointer?: { readonly pointerId: number; readonly pointerType: string };
}

interface UsePanelDragOptions<TCommand> {
  readonly projection: WorkspaceProjection;
  readonly resolvedLayout: ResolvedLayout;
  readonly logicalBounds: LogicalRect;
  readonly direction: WorkspaceDirection;
  readonly messages: ResolvedWorkspaceInteractionMessages;
  readonly enabled: boolean;
  readonly internalEnabled: boolean;
  readonly externalAvailable: boolean;
  readonly splitterSize: number;
  readonly frameScheduler: SurfaceFrameScheduler;
  readonly scheduleKey: string;
  readonly planDrop:
    | ((
        request: WorkspacePanelDropRequest,
        context: WorkspacePanelDropPlanContext,
      ) => WorkspacePanelDropPlan<TCommand> | undefined)
    | undefined;
  readonly createReorderCommand:
    | ((panelId: string, groupId: string, placement: WorkspacePanelReorderPlacement) => TCommand)
    | undefined;
  readonly getRoot: () => HTMLElement | null;
  readonly announce: (message: string) => void;
  readonly commitDrop: (
    request: WorkspacePanelDropRequest,
    label: string,
    origin: "pointer",
    plannedCommand?: TCommand,
  ) => WorkspaceDispatchOutcome;
  readonly commitReorder: (
    command: TCommand,
    label: string,
    origin: "pointer",
  ) => WorkspaceDispatchOutcome;
  /** Calling this function must invoke the application handler synchronously. */
  readonly requestExternal: (
    invocation: ExternalPanelInvocation,
  ) => WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
  readonly restoreFocus: (panelId: string) => void;
}

export interface PanelDragController {
  readonly overlayRef: (element: HTMLDivElement | null) => void;
  readonly begin: (
    panel: WorkspacePanelView,
    group: WorkspaceGroupView,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly move: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly finish: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly cancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly keyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly consumeClick: (panelId: string) => boolean;
}

export interface PanelDragView {
  readonly panelTitle: string;
  readonly pointer: WorkspaceExternalPanelPosition;
  readonly previewRect: LogicalRect | undefined;
  readonly targetId: string | undefined;
  readonly targetKind: "center" | "edge" | "reorder" | "external" | undefined;
  readonly targetEdge: string | undefined;
  readonly targetLabel: string | undefined;
  readonly externalAvailable: boolean;
  readonly bounds: LogicalRect;
  readonly direction: WorkspaceDirection;
  readonly rootRect: PhysicalRect;
  readonly reorderIndicator: PhysicalTabRect | undefined;
  readonly reorderShifts: Readonly<Record<string, TabReorderShift>>;
  readonly sourcePanelId: string;
  readonly sourceGroupId: string;
}

interface PhysicalRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface TabReorderGeometry {
  readonly stripElement: HTMLElement;
  readonly stripRect: PhysicalRect;
  readonly tabs: readonly TabReorderGeometryEntry[];
}

interface TabReorderGeometryEntry {
  readonly element: HTMLElement;
  readonly panelId: string;
  readonly layoutLeft: number;
  readonly layoutTop: number;
  readonly width: number;
  readonly height: number;
}

interface MeasuredTabReorder<TCommand> {
  readonly index: TabReorderIndex<TCommand>;
  readonly geometry: TabReorderGeometry;
}

const EMPTY_TAB_REORDER_SHIFTS: Readonly<Record<string, TabReorderShift>> = Object.freeze({});

interface TabReorderPaintState {
  readonly shifts: Readonly<Record<string, TabReorderShift>>;
  readonly sourcePanelId: string;
  readonly sourceGroupId: string;
  readonly targetKind: PanelDragView["targetKind"];
  readonly groupElement: HTMLElement;
  readonly tabsByPanelId: ReadonlyMap<string, HTMLElement>;
  readonly touchedTabs: readonly HTMLElement[];
}

const MAX_FAILURE_MESSAGE_LENGTH = 512;

const TAB_REORDER_PAINTS = new WeakMap<HTMLDivElement, TabReorderPaintState>();

export function usePanelDrag<TCommand>(
  options: UsePanelDragOptions<TCommand>,
): PanelDragController {
  const actorRef = useRef<DragActor | null>(null);
  const stateRef = useRef<DragActorState>("idle");
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const latestViewRef = useRef<PanelDragView | undefined>(undefined);
  const sessionRef = useRef<DragSession<TCommand> | null>(null);
  const suppressClickRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  const getRootRef = useRef(options.getRoot);
  useLayoutEffect(() => {
    getRootRef.current = options.getRoot;
  }, [options.getRoot]);
  const geometryEpoch = panelDragGeometryEpoch(
    options.resolvedLayout,
    options.logicalBounds,
    options.direction,
    options.splitterSize,
  );
  const currentGeometryEpochRef = useRef(geometryEpoch);
  const currentRevisionRef = useRef(options.projection.revision);
  useLayoutEffect(() => {
    currentRevisionRef.current = options.projection.revision;
  }, [options.projection.revision]);
  useLayoutEffect(() => {
    currentGeometryEpochRef.current = geometryEpoch;
  }, [geometryEpoch]);

  const publishState = useCallback((next: DragActorState) => {
    if (stateRef.current === next) return;
    stateRef.current = next;
    const root = getRootRef.current();
    if (root !== null) root.dataset.panelDragState = next;
  }, []);

  const send = useCallback(
    (actor: DragActor, event: DragEvent): DragActorState => {
      actor.send(event);
      const next = String(actor.getSnapshot().value) as DragActorState;
      publishState(next);
      return next;
    },
    [publishState],
  );

  const disposeActor = useCallback(
    (actor: DragActor) => {
      if (actorRef.current !== actor) return;
      actorRef.current = null;
      actor.stop();
      publishState("idle");
    },
    [publishState],
  );

  const clearPresentation = useCallback(() => {
    latestViewRef.current = undefined;
    clearPanelDragOverlay(overlayRef.current);
    clearTabReorderStyles(getRootRef.current());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      options.frameScheduler.cancel(options.scheduleKey);
      const session = sessionRef.current;
      session?.reorderResizeObserver?.disconnect();
      if (session?.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      sessionRef.current = null;
      const actor = actorRef.current;
      actorRef.current = null;
      actor?.stop();
      clearTabReorderStyles(getRootRef.current());
    };
  }, [options.frameScheduler, options.scheduleKey]);

  useLayoutEffect(() => {
    const root = getRootRef.current();
    if (root !== null) root.dataset.panelDragState = stateRef.current;
    const element = overlayRef.current;
    const latest = latestViewRef.current;
    if (element !== null && latest !== undefined) updatePanelDragOverlay(element, latest);
  });

  const release = useCallback((session: DragSession<TCommand>) => {
    session.reorderResizeObserver?.disconnect();
    session.reorderResizeObserver = undefined;
    if (session.captureElement.hasPointerCapture?.(session.pointerId)) {
      session.captureElement.releasePointerCapture?.(session.pointerId);
    }
  }, []);

  const restore = useCallback(
    (panelId: string) => {
      options.restoreFocus(panelId);
    },
    [options],
  );

  const resetRejected = useCallback(
    (session: DragSession<TCommand>, message: string, event: DragEvent = { type: "CANCEL" }) => {
      options.frameScheduler.cancel(options.scheduleKey);
      session.pending = undefined;
      const current = send(session.actor, event);
      if (current === "recovering") send(session.actor, { type: "RECOVERED" });
      if (current === "cancelling") send(session.actor, { type: "RETURNED" });
      release(session);
      sessionRef.current = null;
      clearPresentation();
      options.announce(message);
      restore(session.panel.id);
      disposeActor(session.actor);
    },
    [clearPresentation, disposeActor, options, release, restore, send],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.projection.revision === options.projection.revision) return;
    const current = String(session.actor.getSnapshot().value);
    if (current !== "armed" && current !== "dragging") return;
    resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
  }, [options.messages, options.projection.revision, resetRejected]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.geometryEpoch === geometryEpoch) return;
    const current = String(session.actor.getSnapshot().value);
    if (current !== "armed" && current !== "dragging") return;
    resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
  }, [geometryEpoch, options.messages, resetRejected]);

  const paintCandidate = useCallback(
    function paintCandidate(session: DragSession<TCommand>, allowAutoScroll: boolean): void {
      if (
        sessionRef.current !== session ||
        actorRef.current !== session.actor ||
        String(session.actor.getSnapshot().value) !== "dragging"
      ) {
        return;
      }
      const rootRect = session.rootRect;
      const autoScrolled = Boolean(
        allowAutoScroll &&
        !outside(session.current, rootRect) &&
        autoScrollTabStrip(
          session.reorderScrollElement,
          session.reorderIndex?.orientation,
          session.reorderIndex?.stripRect,
          session.current,
          session.direction,
        ),
      );
      syncReorderScroll(session);
      const scrollChanged = session.reorderScrollChanged;
      session.reorderScrollChanged = false;
      let target: ActiveCandidate<TCommand> | undefined;
      if (outside(session.current, rootRect)) {
        target = {
          kind: "external",
          id: "external",
          label: options.externalAvailable
            ? options.messages.openPanelInNewWindow({ title: session.panel.title })
            : options.messages.newWindowUnavailable(),
          available: options.externalAvailable,
        };
      } else {
        const reorderIndex = session.reorderIndex;
        const reorderCandidate =
          reorderIndex === undefined
            ? undefined
            : hitTestTabReorder(reorderIndex, {
                x: session.current.clientX,
                y: session.current.clientY,
              });
        if (reorderIndex !== undefined && reorderCandidate !== undefined) {
          const previous =
            session.target?.kind === "reorder" ? session.target.candidate : undefined;
          target = {
            kind: "reorder",
            candidate:
              !scrollChanged && previous?.id === reorderCandidate.id
                ? previous
                : resolveTabReorderCandidate(reorderIndex, reorderCandidate, previous),
          };
        } else {
          const logicalPoint = toLogicalPoint(
            session.current,
            rootRect,
            session.bounds,
            session.direction,
          );
          const candidate = hitTestPanelDropCandidates(session.candidates, logicalPoint);
          if (candidate !== undefined) target = { kind: "internal", candidate };
        }
      }

      const previousId = activeCandidateId(session.target);
      session.target = target;
      const nextId = activeCandidateId(target);
      const dragCandidate =
        target === undefined
          ? undefined
          : {
              id: nextId ?? "",
              label: target.kind === "external" ? target.label : target.candidate.label,
            };
      if (nextId !== previousId) {
        send(session.actor, { type: "SET_CANDIDATE", candidate: dragCandidate });
      }
      const nextView = createDragView(session, target, rootRect);
      latestViewRef.current = nextView;
      if (overlayRef.current !== null) updatePanelDragOverlay(overlayRef.current, nextView);
      if (autoScrolled && sessionRef.current === session) {
        options.frameScheduler.schedule(options.scheduleKey, () => paintCandidate(session, true));
      }
    },
    [options, send],
  );

  useEffect(() => {
    const root = getRootRef.current();
    const ownerWindow = root?.ownerDocument.defaultView;
    if (root === null || ownerWindow === undefined || ownerWindow === null) return;

    const invalidate = () => {
      const session = sessionRef.current;
      if (session === null) return;
      const current = String(session.actor.getSnapshot().value);
      if (current !== "armed" && current !== "dragging") return;
      resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
    };
    const handleScroll = (event: Event) => {
      const session = sessionRef.current;
      if (session !== null && event.target === session.reorderScrollElement) {
        if (syncReorderScroll(session)) {
          options.frameScheduler.schedule(options.scheduleKey, () =>
            paintCandidate(session, false),
          );
        }
        return;
      }
      // Ancestor and owner-window scrolling changes the physical coordinate
      // space of every cached drop target, so it cannot be translated safely.
      invalidate();
    };
    const handleResize = () => invalidate();
    ownerWindow.addEventListener("resize", handleResize);
    ownerWindow.addEventListener("scroll", handleScroll, true);

    const Observer = ownerWindow.ResizeObserver;
    const observer =
      Observer === undefined
        ? undefined
        : new Observer(() => {
            const session = sessionRef.current;
            if (session === null) return;
            const measured = measureRoot(root, session.bounds);
            if (!samePhysicalRect(measured, session.rootRect)) invalidate();
          });
    observer?.observe(root);

    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener("resize", handleResize);
      ownerWindow.removeEventListener("scroll", handleScroll, true);
    };
  }, [
    options.frameScheduler,
    options.messages,
    options.scheduleKey,
    paintCandidate,
    resetRejected,
  ]);

  const consumeLatestPointer = useCallback(
    (session: DragSession<TCommand>, allowAutoScroll: boolean) => {
      const position = session.pending;
      if (
        position === undefined ||
        sessionRef.current !== session ||
        actorRef.current !== session.actor
      ) {
        return;
      }
      session.pending = undefined;
      session.current = position;
      const next = send(session.actor, {
        type: "POINTER_MOVE",
        pointerId: session.pointerId,
        position: { x: position.clientX, y: position.clientY },
      });
      if (next === "dragging") paintCandidate(session, allowAutoScroll);
    },
    [paintCandidate, send],
  );

  const queuePointerSample = useCallback(
    (session: DragSession<TCommand>, position: WorkspaceExternalPanelPosition) => {
      session.pending = position;
      options.frameScheduler.schedule(options.scheduleKey, () =>
        consumeLatestPointer(session, true),
      );
    },
    [consumeLatestPointer, options.frameScheduler, options.scheduleKey],
  );

  const begin = useCallback(
    (
      panel: WorkspacePanelView,
      group: WorkspaceGroupView,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (
        !options.enabled ||
        event.button !== 0 ||
        sessionRef.current !== null ||
        actorRef.current !== null
      ) {
        return;
      }
      const position = externalPosition(event);
      const tabElement = event.currentTarget;
      const rootRect = measureRoot(options.getRoot(), options.logicalBounds);
      const reorderScrollElement = tabElement.closest<HTMLElement>("[role=tablist]") ?? undefined;
      const createReorderCommand = options.createReorderCommand;
      const measuredReorder =
        createReorderCommand === undefined
          ? undefined
          : measureTabReorderIndex(
              tabElement,
              panel,
              group,
              options.projection,
              options.direction,
              createReorderCommand,
              options.messages,
            );
      const actor = createDragActor();
      actor.start();
      actorRef.current = actor;
      const session: DragSession<TCommand> = {
        actor,
        panel,
        sourceGroup: group,
        projection: options.projection,
        layout: options.resolvedLayout,
        bounds: options.logicalBounds,
        rootRect,
        direction: options.direction,
        geometryEpoch,
        pointerId: event.pointerId,
        pointerType: event.pointerType || "mouse",
        captureElement: event.currentTarget,
        candidates: options.internalEnabled
          ? createPanelDropCandidates(
              options.projection,
              options.resolvedLayout,
              panel.id,
              options.direction,
              0.25,
              0.5,
              options.splitterSize,
              {
                movedPanelTo: options.messages.movedPanelTo,
                splitPanel: options.messages.splitPanel,
              },
              options.planDrop,
            )
          : [],
        reorderIndex: measuredReorder?.index,
        reorderScrollElement,
        reorderGeometry: measuredReorder?.geometry,
        reorderScrollPosition: {
          left: reorderScrollElement?.scrollLeft ?? 0,
          top: reorderScrollElement?.scrollTop ?? 0,
        },
        reorderScrollChanged: false,
        reorderResizeObserver: undefined,
        current: position,
        pending: undefined,
        target: undefined,
      };
      sessionRef.current = session;
      send(actor, {
        type: "POINTER_DOWN",
        pointerId: event.pointerId,
        position: { x: event.clientX, y: event.clientY },
        baseRevision: safeRevision(options.projection.revision),
      });
      event.currentTarget.setPointerCapture?.(event.pointerId);

      const Observer = event.currentTarget.ownerDocument.defaultView?.ResizeObserver;
      const reorderGeometry = session.reorderGeometry;
      if (Observer !== undefined && reorderGeometry !== undefined) {
        const observer = new Observer(() => {
          if (sessionRef.current !== session) return;
          const current = String(session.actor.getSnapshot().value);
          if (current !== "armed" && current !== "dragging") return;
          if (!sameTabReorderGeometry(reorderGeometry)) {
            resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
          }
        });
        session.reorderResizeObserver = observer;
        observer.observe(reorderGeometry.stripElement);
        for (const entry of reorderGeometry.tabs) observer.observe(entry.element);
      }
    },
    [geometryEpoch, options, resetRejected, send],
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      queuePointerSample(session, externalPosition(event));
      event.preventDefault();
    },
    [queuePointerSample],
  );

  const settleExternal = useCallback(
    (session: DragSession<TCommand>, outcome: WorkspaceExternalPanelOutcome) => {
      if (!mountedRef.current || actorRef.current !== session.actor) return;
      const fallback = options.messages.couldNotOpenPanelInNewWindow({
        title: session.panel.title,
      });
      let status: WorkspaceExternalPanelOutcome["status"];
      let message: string | undefined;
      try {
        status = outcome.status;
        message = boundedMessage(outcome.message, fallback);
      } catch (error) {
        status = "rejected";
        message = boundedFailureMessage(error, fallback);
      }

      if (status === "committed") {
        try {
          send(session.actor, { type: "COMMIT_OK" });
          send(session.actor, { type: "SETTLED" });
          options.announce(
            message ?? options.messages.openedPanelInNewWindow({ title: session.panel.title }),
          );
        } finally {
          disposeActor(session.actor);
        }
        return;
      }
      try {
        send(session.actor, { type: "COMMIT_ERROR", message: message ?? fallback });
        send(session.actor, { type: "RECOVERED" });
        restore(session.panel.id);
        options.announce(message ?? fallback);
      } finally {
        disposeActor(session.actor);
      }
    },
    [disposeActor, options, restore, send],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      options.frameScheduler.cancel(options.scheduleKey);
      session.pending = externalPosition(event);
      consumeLatestPointer(session, false);
      if (
        session.reorderGeometry !== undefined &&
        !sameTabReorderGeometry(session.reorderGeometry)
      ) {
        resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
        return;
      }
      const next = send(session.actor, { type: "POINTER_UP", pointerId: event.pointerId });
      release(session);

      if (next === "idle") {
        sessionRef.current = null;
        clearPresentation();
        disposeActor(session.actor);
        return;
      }

      suppressClickRef.current = session.panel.id;
      session.captureElement.ownerDocument.defaultView?.setTimeout(() => {
        if (suppressClickRef.current === session.panel.id) suppressClickRef.current = undefined;
      }, 0);
      sessionRef.current = null;
      options.frameScheduler.cancel(options.scheduleKey);
      clearPresentation();

      if (next !== "committing" || session.target === undefined) {
        if (next === "cancelling") send(session.actor, { type: "RETURNED" });
        options.announce(options.messages.panelMoveCancelledNoDestination());
        restore(session.panel.id);
        disposeActor(session.actor);
        return;
      }

      // The candidate was projected from this exact revision. Never ask the
      // application planner to commit stale geometry.
      if (
        currentRevisionRef.current !== session.projection.revision ||
        currentGeometryEpochRef.current !== session.geometryEpoch
      ) {
        send(session.actor, { type: "REVISION_CONFLICT" });
        send(session.actor, { type: "RECOVERED" });
        options.announce(options.messages.workspaceChangedBeforePanelMove());
        restore(session.panel.id);
        disposeActor(session.actor);
        return;
      }

      if (session.target.kind === "reorder") {
        const candidate = session.target.candidate;
        if (!candidate.changed) {
          send(session.actor, { type: "COMMIT_OK" });
          send(session.actor, { type: "SETTLED" });
          try {
            options.announce(candidate.commitLabel);
            restore(session.panel.id);
          } finally {
            disposeActor(session.actor);
          }
          return;
        }
        let command: TCommand;
        try {
          const reorderIndex = session.reorderIndex;
          if (reorderIndex === undefined) throw new Error("The tab reorder plan is unavailable");
          command = reorderIndex.createCommand(
            session.panel.id,
            session.sourceGroup.id,
            candidate.placement,
          );
        } catch {
          try {
            send(session.actor, {
              type: "COMMIT_ERROR",
              message: options.messages.panelPlacementUnavailable(),
            });
            send(session.actor, { type: "RECOVERED" });
            restore(session.panel.id);
            options.announce(options.messages.panelPlacementUnavailable());
          } finally {
            disposeActor(session.actor);
          }
          return;
        }
        try {
          const outcome = options.commitReorder(command, candidate.commitLabel, "pointer");
          settleDispatch(session, outcome, candidate.commitLabel, options, send, restore);
        } catch (error) {
          rejectThrownCommit(session, error, options, send, restore);
        } finally {
          disposeActor(session.actor);
        }
        return;
      }

      if (session.target.kind === "internal") {
        try {
          const outcome = options.commitDrop(
            session.target.candidate.request,
            session.target.candidate.label,
            "pointer",
            session.target.candidate.plan.command,
          );
          settleDispatch(session, outcome, session.target.candidate.label, options, send, restore);
        } catch (error) {
          rejectThrownCommit(session, error, options, send, restore);
        } finally {
          disposeActor(session.actor);
        }
        return;
      }

      if (!session.target.available) {
        send(session.actor, {
          type: "COMMIT_ERROR",
          message: options.messages.newWindowUnavailable(),
        });
        send(session.actor, { type: "RECOVERED" });
        options.announce(options.messages.newWindowUnavailable());
        restore(session.panel.id);
        disposeActor(session.actor);
        return;
      }

      // Intentionally call inside pointerup, before creating a promise chain,
      // so window.open remains covered by browser transient activation.
      let outcome: WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
      const controller = new AbortController();
      try {
        outcome = options.requestExternal({
          panel: session.panel,
          sourceGroup: session.sourceGroup,
          sourcePanels: panelsForGroup(session.projection, session.sourceGroup),
          origin: "pointer",
          position: session.current,
          controller,
          pointer: { pointerId: session.pointerId, pointerType: session.pointerType },
        });
      } catch (error) {
        settleExternal(session, {
          status: "rejected",
          message:
            error instanceof Error
              ? error.message
              : options.messages.couldNotOpenPanelInNewWindow({ title: session.panel.title }),
        });
        return;
      }
      if (isPromiseLike(outcome)) {
        void outcome.then(
          (result) => settleExternal(session, result),
          (error: unknown) =>
            settleExternal(session, {
              status: "rejected",
              message: boundedFailureMessage(
                error,
                options.messages.couldNotOpenPanelInNewWindow({ title: session.panel.title }),
              ),
            }),
        );
      } else {
        settleExternal(session, outcome);
      }
    },
    [
      clearPresentation,
      consumeLatestPointer,
      disposeActor,
      options,
      release,
      resetRejected,
      restore,
      send,
      settleExternal,
    ],
  );

  const cancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      options.frameScheduler.cancel(options.scheduleKey);
      session.pending = undefined;
      const type = event.type === "lostpointercapture" ? "CAPTURE_LOST" : "POINTER_CANCEL";
      const next = send(session.actor, { type, pointerId: event.pointerId });
      release(session);
      sessionRef.current = null;
      clearPresentation();
      if (next === "cancelling") send(session.actor, { type: "RETURNED" });
      if (next !== "idle") options.announce(options.messages.moveCancelled());
      restore(session.panel.id);
      disposeActor(session.actor);
    },
    [clearPresentation, disposeActor, options, release, restore, send],
  );

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Escape") return;
      const session = sessionRef.current;
      if (session === null) return;
      event.preventDefault();
      options.frameScheduler.cancel(options.scheduleKey);
      session.pending = undefined;
      const next = send(session.actor, { type: "CANCEL" });
      release(session);
      sessionRef.current = null;
      clearPresentation();
      if (next === "cancelling") send(session.actor, { type: "RETURNED" });
      options.announce(options.messages.moveCancelled());
      restore(session.panel.id);
      disposeActor(session.actor);
    },
    [clearPresentation, disposeActor, options, release, restore, send],
  );

  const consumeClick = useCallback((panelId: string) => {
    if (suppressClickRef.current !== panelId) return false;
    suppressClickRef.current = undefined;
    return true;
  }, []);

  const setOverlayRef = useCallback((element: HTMLDivElement | null) => {
    overlayRef.current = element;
    const latest = latestViewRef.current;
    if (element !== null && latest !== undefined) updatePanelDragOverlay(element, latest);
  }, []);

  return {
    overlayRef: setOverlayRef,
    begin,
    move,
    finish,
    cancel,
    keyDown,
    consumeClick,
  };
}

export function PanelDragOverlay({
  overlayRef,
}: {
  readonly overlayRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={overlayRef} className="pf-panel-drag" hidden aria-hidden="true">
      <div className="pf-panel-drop-preview" hidden />
      <div
        className="pf-tab-reorder-indicator"
        data-workspace-tab-reorder-indicator="true"
        hidden
      />
      <div className="pf-panel-drag-ghost" data-external="false" data-available="true">
        <strong />
      </div>
    </div>
  );
}

function createDragView<TCommand>(
  session: DragSession<TCommand>,
  target: ActiveCandidate<TCommand> | undefined,
  rootRect: PhysicalRect,
): PanelDragView {
  const candidate = target?.kind === "internal" ? target.candidate : undefined;
  const reorderCandidate = target?.kind === "reorder" ? target.candidate : undefined;
  return {
    panelTitle: session.panel.title,
    pointer: session.current,
    previewRect: candidate?.previewRect,
    targetId: activeCandidateId(target),
    targetKind:
      target?.kind === "external"
        ? "external"
        : target?.kind === "reorder"
          ? "reorder"
          : candidate?.request.target.kind,
    targetEdge:
      candidate?.request.target.kind === "edge" ? candidate.request.target.edge : undefined,
    targetLabel:
      target?.kind === "external"
        ? target.label
        : target?.kind === "reorder"
          ? target.candidate.label
          : candidate?.label,
    externalAvailable: target?.kind === "external" ? target.available : true,
    bounds: session.bounds,
    direction: session.direction,
    rootRect,
    reorderIndicator: reorderCandidate?.indicatorRect,
    reorderShifts: reorderCandidate?.shifts ?? EMPTY_TAB_REORDER_SHIFTS,
    sourcePanelId: session.panel.id,
    sourceGroupId: session.sourceGroup.id,
  };
}

function activeCandidateId<TCommand>(
  target: ActiveCandidate<TCommand> | undefined,
): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === "external" ? target.id : target.candidate.id;
}

function measureTabReorderIndex<TCommand>(
  sourceTab: HTMLButtonElement,
  panel: WorkspacePanelView,
  group: WorkspaceGroupView,
  projection: WorkspaceProjection,
  direction: WorkspaceDirection,
  createCommand: (
    panelId: string,
    groupId: string,
    placement: WorkspacePanelReorderPlacement,
  ) => TCommand,
  messages: ResolvedWorkspaceInteractionMessages,
): MeasuredTabReorder<TCommand> | undefined {
  const tabList = sourceTab.closest<HTMLElement>("[role=tablist]");
  const groupElement = sourceTab.closest<HTMLElement>("[data-tab-orientation]");
  if (tabList === null || groupElement === null) return undefined;
  const orientation: TabStripOrientation =
    groupElement.dataset.tabOrientation === "vertical" ? "vertical" : "horizontal";
  const tabsByPanelId = new Map(
    Array.from(tabList.querySelectorAll<HTMLElement>("[data-workspace-panel-tab]")).flatMap(
      (candidate) => {
        const panelId = candidate.dataset.workspacePanelTab;
        return panelId === undefined ? [] : [[panelId, candidate] as const];
      },
    ),
  );
  const measuredTabs = group.panelIds.flatMap((panelId) => {
    const tab = tabsByPanelId.get(panelId);
    const candidatePanel = projection.panels[panelId];
    return tab === undefined || candidatePanel === undefined
      ? []
      : [{ panel: candidatePanel, element: tab, rect: physicalRect(tab.getBoundingClientRect()) }];
  });
  const stripRect = physicalRect(tabList.getBoundingClientRect());
  const index = createTabReorderIndex({
    panel,
    groupId: group.id,
    orderedTabs: measuredTabs.map(({ panel: candidatePanel, rect }) => ({
      panel: candidatePanel,
      rect,
    })),
    stripRect,
    orientation,
    direction,
    createCommand,
    labels: {
      moveBefore: messages.moveTabBefore,
      moveAfter: messages.moveTabAfter,
      movedBefore: messages.movedTabBefore,
      movedAfter: messages.movedTabAfter,
      keptPosition: messages.keptTabPosition,
    },
  });
  if (index === undefined) return undefined;
  return {
    index,
    geometry: {
      stripElement: tabList,
      stripRect,
      tabs: measuredTabs.map(({ panel: candidatePanel, element, rect }) => ({
        element,
        panelId: candidatePanel.id,
        layoutLeft: element.offsetLeft,
        layoutTop: element.offsetTop,
        width: rect.width,
        height: rect.height,
      })),
    },
  };
}

function syncReorderScroll<TCommand>(session: DragSession<TCommand>): boolean {
  const element = session.reorderScrollElement;
  if (element === undefined) return false;
  const previous = session.reorderScrollPosition;
  const left = element.scrollLeft;
  const top = element.scrollTop;
  const deltaLeft = left - previous.left;
  const deltaTop = top - previous.top;
  previous.left = left;
  previous.top = top;
  if (deltaLeft === 0 && deltaTop === 0) return false;
  const index = session.reorderIndex;
  if (index === undefined) return false;
  session.reorderIndex = translateTabReorderIndex(index, {
    x: -deltaLeft,
    y: -deltaTop,
  });
  session.reorderScrollChanged = true;
  return true;
}

function sameTabReorderGeometry(geometry: TabReorderGeometry): boolean {
  const strip = geometry.stripElement;
  if (!strip.isConnected) return false;
  if (!sameGeometryRect(physicalRect(strip.getBoundingClientRect()), geometry.stripRect)) {
    return false;
  }
  const currentTabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-workspace-panel-tab]"));
  if (currentTabs.length !== geometry.tabs.length) return false;
  return geometry.tabs.every((expected, index) => {
    const current = currentTabs[index];
    if (
      current !== expected.element ||
      current.dataset.workspacePanelTab !== expected.panelId ||
      current.offsetLeft !== expected.layoutLeft ||
      current.offsetTop !== expected.layoutTop
    ) {
      return false;
    }
    const rect = physicalRect(current.getBoundingClientRect());
    return (
      sameGeometryValue(rect.width, expected.width) &&
      sameGeometryValue(rect.height, expected.height)
    );
  });
}

function sameGeometryRect(left: PhysicalRect, right: PhysicalRect): boolean {
  return (
    sameGeometryValue(left.left, right.left) &&
    sameGeometryValue(left.top, right.top) &&
    sameGeometryValue(left.width, right.width) &&
    sameGeometryValue(left.height, right.height)
  );
}

function sameGeometryValue(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.5;
}

function physicalRect(rect: Pick<DOMRect, "left" | "top" | "width" | "height">): PhysicalTabRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function autoScrollTabStrip(
  element: HTMLElement | undefined,
  orientation: TabStripOrientation | undefined,
  rect: PhysicalTabRect | undefined,
  position: WorkspaceExternalPanelPosition,
  direction: WorkspaceDirection,
): TabReorderShift | false {
  if (element === undefined || orientation === undefined || rect === undefined) return false;
  const acquisition = 28;
  const maximumStep = 24;
  if (orientation === "vertical") {
    if (position.clientX < rect.left || position.clientX >= rect.left + rect.width) return false;
    const available = element.scrollHeight - element.clientHeight;
    if (available <= 0) return false;
    const delta = edgeScrollDelta(
      position.clientY,
      rect.top,
      rect.height,
      acquisition,
      maximumStep,
    );
    const before = element.scrollTop;
    element.scrollTop = clamp(before + delta, 0, available);
    const applied = element.scrollTop - before;
    return applied === 0 ? false : { x: 0, y: -applied };
  }
  if (position.clientY < rect.top || position.clientY >= rect.top + rect.height) return false;
  const available = element.scrollWidth - element.clientWidth;
  if (available <= 0) return false;
  const physicalDelta = edgeScrollDelta(
    position.clientX,
    rect.left,
    rect.width,
    acquisition,
    maximumStep,
  );
  const delta = physicalDelta;
  const before = element.scrollLeft;
  const rtlUsesNegativeOffsets = direction === "rtl" && before <= 0;
  element.scrollLeft = rtlUsesNegativeOffsets
    ? clamp(before + delta, -available, 0)
    : clamp(before + delta, 0, available);
  const applied = element.scrollLeft - before;
  return applied === 0 ? false : { x: -applied, y: 0 };
}

function settleDispatch<TCommand>(
  session: DragSession<TCommand>,
  outcome: WorkspaceDispatchOutcome,
  committedLabel: string,
  options: UsePanelDragOptions<TCommand>,
  send: (actor: DragActor, event: DragEvent) => DragActorState,
  restore: (panelId: string) => void,
): void {
  const status = outcome.status;
  if (status === "committed" || status === "queued") {
    send(session.actor, { type: "COMMIT_OK" });
    send(session.actor, { type: "SETTLED" });
    // WorkspaceSurface.dispatch owns the localized success announcement. This
    // fallback is reachable only for an interpreter that returns no message.
    if (outcome.message === undefined && status === "committed") {
      options.announce(committedLabel);
    }
    return;
  }
  const message = boundedMessage(outcome.message, options.messages.panelMoveRejected());
  send(session.actor, { type: "COMMIT_ERROR", message });
  send(session.actor, { type: "RECOVERED" });
  if (outcome.message === undefined) options.announce(message);
  restore(session.panel.id);
}

function rejectThrownCommit<TCommand>(
  session: DragSession<TCommand>,
  error: unknown,
  options: UsePanelDragOptions<TCommand>,
  send: (actor: DragActor, event: DragEvent) => DragActorState,
  restore: (panelId: string) => void,
): void {
  const message = boundedFailureMessage(error, options.messages.panelMoveRejected());
  send(session.actor, { type: "COMMIT_ERROR", message });
  send(session.actor, { type: "RECOVERED" });
  restore(session.panel.id);
  options.announce(message);
}

function boundedFailureMessage(error: unknown, fallback: string): string {
  let candidate: unknown;
  try {
    candidate = error instanceof Error ? error.message : undefined;
  } catch {
    candidate = undefined;
  }
  return boundedMessage(candidate, fallback);
}

function boundedMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string") return fallback;
  const compact = message.trim();
  if (compact.length === 0) return fallback;
  return compact.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

function edgeScrollDelta(
  coordinate: number,
  start: number,
  size: number,
  acquisition: number,
  maximumStep: number,
): number {
  const fromStart = coordinate - start;
  const fromEnd = start + size - coordinate;
  if (fromStart >= 0 && fromStart < acquisition) {
    return -Math.max(1, Math.round(maximumStep * (1 - fromStart / acquisition)));
  }
  if (fromEnd >= 0 && fromEnd < acquisition) {
    return Math.max(1, Math.round(maximumStep * (1 - fromEnd / acquisition)));
  }
  return 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function updatePanelDragOverlay(element: HTMLDivElement | null, view: PanelDragView): void {
  if (element === null) return;
  element.hidden = false;
  element.dataset.workspacePanelDrag = "true";
  setData(element, "workspaceDropTarget", view.targetId);
  setData(element, "workspaceDropKind", view.targetKind);
  setData(element, "workspaceDropEdge", view.targetEdge);

  const preview = element.querySelector<HTMLElement>(".pf-panel-drop-preview");
  const overlayPreview = toOverlayRect(
    view.previewRect,
    view.bounds,
    view.rootRect,
    view.direction,
  );
  setOverlayRect(preview, overlayPreview);

  const indicator = element.querySelector<HTMLElement>(".pf-tab-reorder-indicator");
  setOverlayRect(indicator, view.reorderIndicator);

  const ghost = element.querySelector<HTMLElement>(".pf-panel-drag-ghost");
  if (ghost !== null) {
    ghost.dataset.external = String(view.targetKind === "external");
    ghost.dataset.available = String(view.externalAvailable);
    ghost.style.setProperty("--pf-drag-x", `${view.pointer.clientX - view.rootRect.left}px`);
    ghost.style.setProperty("--pf-drag-y", `${view.pointer.clientY - view.rootRect.top}px`);
    const title = ghost.querySelector<HTMLElement>("strong");
    if (title !== null) title.textContent = view.panelTitle;
    const label = ghost.querySelector<HTMLElement>("span");
    if (view.targetLabel === undefined) label?.remove();
    else if (label === null) {
      const next = ghost.ownerDocument.createElement("span");
      next.textContent = view.targetLabel;
      ghost.append(next);
    } else label.textContent = view.targetLabel;
  }

  const root = element.closest<HTMLElement>(".pf-workspace");
  const previousPaint = TAB_REORDER_PAINTS.get(element);
  if (
    previousPaint?.shifts === view.reorderShifts &&
    previousPaint.sourcePanelId === view.sourcePanelId &&
    previousPaint.sourceGroupId === view.sourceGroupId &&
    previousPaint.targetKind === view.targetKind
  ) {
    return;
  }
  for (const tab of previousPaint?.touchedTabs ?? []) {
    tab.style.removeProperty("--pf-tab-reorder-x");
    tab.style.removeProperty("--pf-tab-reorder-y");
    delete tab.dataset.reorderSource;
  }
  const cachedGroup =
    previousPaint?.sourceGroupId === view.sourceGroupId &&
    previousPaint.groupElement.isConnected &&
    root?.contains(previousPaint.groupElement)
      ? previousPaint
      : undefined;
  const sourceGroup =
    cachedGroup?.groupElement ??
    root?.querySelector<HTMLElement>(
      `[data-workspace-group="${escapeCssString(view.sourceGroupId)}"]`,
    );
  if (sourceGroup === null || sourceGroup === undefined) {
    TAB_REORDER_PAINTS.delete(element);
    return;
  }
  const tabsByPanelId =
    cachedGroup?.tabsByPanelId ??
    new Map(
      Array.from(sourceGroup.querySelectorAll<HTMLElement>("[data-workspace-panel-tab]")).flatMap(
        (tab) => {
          const panelId = tab.dataset.workspacePanelTab;
          return panelId === undefined ? [] : [[panelId, tab] as const];
        },
      ),
    );
  const touchedTabs = new Set<HTMLElement>();
  for (const [panelId, shift] of Object.entries(view.reorderShifts)) {
    const tab = tabsByPanelId.get(panelId);
    if (tab === undefined) continue;
    if (shift !== undefined) {
      tab.style.setProperty("--pf-tab-reorder-x", `${shift.x}px`);
      tab.style.setProperty("--pf-tab-reorder-y", `${shift.y}px`);
    }
    touchedTabs.add(tab);
  }
  if (view.targetKind === "reorder") {
    const sourceTab = tabsByPanelId.get(view.sourcePanelId);
    if (sourceTab !== undefined) {
      sourceTab.dataset.reorderSource = "true";
      touchedTabs.add(sourceTab);
    }
  }
  TAB_REORDER_PAINTS.set(element, {
    shifts: view.reorderShifts,
    sourcePanelId: view.sourcePanelId,
    sourceGroupId: view.sourceGroupId,
    targetKind: view.targetKind,
    groupElement: sourceGroup,
    tabsByPanelId,
    touchedTabs: [...touchedTabs],
  });
}

function clearPanelDragOverlay(element: HTMLDivElement | null): void {
  if (element === null) return;
  element.hidden = true;
  delete element.dataset.workspacePanelDrag;
  delete element.dataset.workspaceDropTarget;
  delete element.dataset.workspaceDropKind;
  delete element.dataset.workspaceDropEdge;
  setOverlayRect(element.querySelector<HTMLElement>(".pf-panel-drop-preview"), undefined);
  setOverlayRect(element.querySelector<HTMLElement>(".pf-tab-reorder-indicator"), undefined);
  const ghost = element.querySelector<HTMLElement>(".pf-panel-drag-ghost");
  ghost?.querySelector<HTMLElement>("span")?.remove();
  const previousPaint = TAB_REORDER_PAINTS.get(element);
  for (const tab of previousPaint?.touchedTabs ?? []) {
    tab.style.removeProperty("--pf-tab-reorder-x");
    tab.style.removeProperty("--pf-tab-reorder-y");
    delete tab.dataset.reorderSource;
  }
  TAB_REORDER_PAINTS.delete(element);
}

function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function clearTabReorderStyles(root: HTMLElement | null): void {
  if (root === null) return;
  for (const tab of root.querySelectorAll<HTMLElement>("[data-workspace-panel-tab]")) {
    tab.style.removeProperty("--pf-tab-reorder-x");
    tab.style.removeProperty("--pf-tab-reorder-y");
    delete tab.dataset.reorderSource;
  }
}

function setData(
  element: HTMLElement,
  key: "workspaceDropTarget" | "workspaceDropKind" | "workspaceDropEdge",
  value: string | undefined,
) {
  if (value === undefined) delete element.dataset[key];
  else element.dataset[key] = value;
}

function setOverlayRect(
  element: HTMLElement | null,
  rect: Pick<PhysicalTabRect, "left" | "top" | "width" | "height"> | undefined,
) {
  if (element === null) return;
  element.hidden = rect === undefined;
  if (rect === undefined) return;
  element.style.setProperty("--pf-drop-x", `${rect.left}px`);
  element.style.setProperty("--pf-drop-y", `${rect.top}px`);
  element.style.setProperty("--pf-drop-width", `${rect.width}px`);
  element.style.setProperty("--pf-drop-height", `${rect.height}px`);
}

function externalPosition(event: ReactPointerEvent<HTMLElement>): WorkspaceExternalPanelPosition {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
  };
}

function measureRoot(root: HTMLElement | null, bounds: LogicalRect): PhysicalRect {
  const measured = root?.getBoundingClientRect();
  if (measured !== undefined && measured.width > 0 && measured.height > 0) {
    return {
      left: measured.left,
      top: measured.top,
      width: measured.width,
      height: measured.height,
    };
  }
  return {
    left: 0,
    top: 0,
    width: Math.max(0, bounds.inlineSize),
    height: Math.max(0, bounds.blockSize),
  };
}

function samePhysicalRect(left: PhysicalRect, right: PhysicalRect): boolean {
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

function panelDragGeometryEpoch(
  layout: ResolvedLayout,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
  splitterSize: number,
): string {
  const rectKey = (rect: LogicalRect | undefined) =>
    rect === undefined
      ? null
      : [rect.inlineStart, rect.blockStart, rect.inlineSize, rect.blockSize];
  const groupRects = Object.entries(layout.groupRects)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([groupId, rect]) => [groupId, rectKey(rect)]);
  const splitters = [...layout.splitters]
    .sort((left, right) => compareCodeUnits(left.id, right.id))
    .map((splitter) => [
      splitter.id,
      splitter.splitNodeId,
      splitter.axis,
      splitter.beforeNodeId,
      splitter.afterNodeId,
      rectKey(splitter.rect),
    ]);
  return JSON.stringify([
    direction,
    splitterSize,
    layout.rootNodeId,
    rectKey(bounds),
    rectKey(layout.nodeRects[layout.rootNodeId]),
    groupRects,
    splitters,
    [...layout.collapsedNodeIds].sort(compareCodeUnits),
  ]);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function outside(position: WorkspaceExternalPanelPosition, rect: PhysicalRect): boolean {
  return (
    position.clientX < rect.left ||
    position.clientX >= rect.left + rect.width ||
    position.clientY < rect.top ||
    position.clientY >= rect.top + rect.height
  );
}

function toLogicalPoint(
  position: WorkspaceExternalPanelPosition,
  rootRect: PhysicalRect,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
) {
  const physicalInline = rootRect.width <= 0 ? 0 : position.clientX - rootRect.left;
  const inlineOffset =
    rootRect.width <= 0 ? 0 : (physicalInline / rootRect.width) * bounds.inlineSize;
  const blockOffset =
    rootRect.height <= 0
      ? 0
      : ((position.clientY - rootRect.top) / rootRect.height) * bounds.blockSize;
  return {
    inline:
      direction === "rtl"
        ? bounds.inlineStart + bounds.inlineSize - inlineOffset
        : bounds.inlineStart + inlineOffset,
    block: bounds.blockStart + blockOffset,
  };
}

function toOverlayRect(
  rect: LogicalRect | undefined,
  bounds: LogicalRect,
  rootRect: PhysicalRect,
  direction: WorkspaceDirection,
): PhysicalRect | undefined {
  if (rect === undefined || bounds.inlineSize <= 0 || bounds.blockSize <= 0) return undefined;
  const inlineOffset = rect.inlineStart - bounds.inlineStart;
  const physicalInline =
    direction === "rtl" ? bounds.inlineSize - inlineOffset - rect.inlineSize : inlineOffset;
  return {
    left: (physicalInline / bounds.inlineSize) * rootRect.width,
    top: ((rect.blockStart - bounds.blockStart) / bounds.blockSize) * rootRect.height,
    width: (rect.inlineSize / bounds.inlineSize) * rootRect.width,
    height: (rect.blockSize / bounds.blockSize) * rootRect.height,
  };
}

function safeRevision(value: string) {
  try {
    return revision(value);
  } catch {
    return revision(0);
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}
