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
import { revision } from "@panefold/model";
import { createDragActor, type DragEvent } from "@panefold/protocol-xstate";

import {
  createGroupDropCandidates,
  hitTestGroupDropCandidates,
  type GroupDropCandidate,
} from "./group-drop";
import type { ResolvedWorkspaceInteractionMessages } from "./messages";
import type {
  WorkspaceDirection,
  WorkspaceDispatchOutcome,
  WorkspaceGroupDropPlan,
  WorkspaceGroupDropPlanContext,
  WorkspaceGroupDropRequest,
  WorkspaceGroupView,
  WorkspaceProjection,
} from "./types";

type DragActorState =
  | "idle"
  | "armed"
  | "dragging"
  | "committing"
  | "settling"
  | "cancelling"
  | "recovering";
type DragActor = ReturnType<typeof createDragActor>;

interface PointerPosition {
  readonly clientX: number;
  readonly clientY: number;
}

interface PhysicalRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface GroupDragSession<TCommand> {
  readonly actor: DragActor;
  readonly group: WorkspaceGroupView;
  readonly projection: WorkspaceProjection;
  readonly bounds: LogicalRect;
  readonly rootRect: PhysicalRect;
  readonly direction: WorkspaceDirection;
  readonly geometryEpoch: string;
  readonly pointerId: number;
  readonly captureElement: HTMLButtonElement;
  readonly candidates: readonly GroupDropCandidate<TCommand>[];
  current: PointerPosition;
  pending: PointerPosition | undefined;
  target: GroupDropCandidate<TCommand> | undefined;
}

interface UseGroupDragOptions<TCommand> {
  readonly projection: WorkspaceProjection;
  readonly resolvedLayout: ResolvedLayout;
  readonly logicalBounds: LogicalRect;
  readonly direction: WorkspaceDirection;
  readonly messages: ResolvedWorkspaceInteractionMessages;
  readonly enabled: boolean;
  readonly splitterSize: number;
  readonly frameScheduler: SurfaceFrameScheduler;
  readonly scheduleKey: string;
  readonly planDrop:
    | ((
        request: WorkspaceGroupDropRequest,
        context: WorkspaceGroupDropPlanContext,
      ) => WorkspaceGroupDropPlan<TCommand> | undefined)
    | undefined;
  readonly getRoot: () => HTMLElement | null;
  readonly announce: (message: string) => void;
  readonly commitDrop: (
    request: WorkspaceGroupDropRequest,
    label: string,
    origin: "pointer",
    plannedCommand: TCommand,
  ) => WorkspaceDispatchOutcome;
  readonly restoreFocus: (groupId: string) => void;
}

export interface GroupDragController {
  readonly overlayRef: (element: HTMLDivElement | null) => void;
  readonly begin: (group: WorkspaceGroupView, event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly move: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly finish: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly cancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly keyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly consumeClick: (groupId: string) => boolean;
}

interface GroupDragView {
  readonly groupLabel: string;
  readonly pointer: PointerPosition;
  readonly previewRect: LogicalRect | undefined;
  readonly targetId: string | undefined;
  readonly targetKind: "swap" | "edge" | undefined;
  readonly targetEdge: string | undefined;
  readonly targetLabel: string | undefined;
  readonly bounds: LogicalRect;
  readonly direction: WorkspaceDirection;
  readonly rootRect: PhysicalRect;
}

const MAX_FAILURE_MESSAGE_LENGTH = 512;

export function useGroupDrag<TCommand>(
  options: UseGroupDragOptions<TCommand>,
): GroupDragController {
  const actorRef = useRef<DragActor | null>(null);
  const stateRef = useRef<DragActorState>("idle");
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const latestViewRef = useRef<GroupDragView | undefined>(undefined);
  const sessionRef = useRef<GroupDragSession<TCommand> | null>(null);
  const suppressClickRef = useRef<string | undefined>(undefined);
  const getRootRef = useRef(options.getRoot);
  useLayoutEffect(() => {
    getRootRef.current = options.getRoot;
  }, [options.getRoot]);
  const geometryEpoch = groupDragGeometryEpoch(
    options.resolvedLayout,
    options.logicalBounds,
    options.direction,
    options.splitterSize,
  );
  const currentGeometryEpochRef = useRef(geometryEpoch);
  const currentRevisionRef = useRef(options.projection.revision);
  useLayoutEffect(() => {
    currentGeometryEpochRef.current = geometryEpoch;
  }, [geometryEpoch]);
  useLayoutEffect(() => {
    currentRevisionRef.current = options.projection.revision;
  }, [options.projection.revision]);

  const publishState = useCallback((next: DragActorState) => {
    if (stateRef.current === next) return;
    stateRef.current = next;
    const root = getRootRef.current();
    if (root !== null) root.dataset.groupDragState = next;
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
    clearGroupDragOverlay(overlayRef.current);
  }, []);

  const release = useCallback((session: GroupDragSession<TCommand>) => {
    if (session.captureElement.hasPointerCapture?.(session.pointerId)) {
      session.captureElement.releasePointerCapture?.(session.pointerId);
    }
  }, []);

  useEffect(() => {
    return () => {
      options.frameScheduler.cancel(options.scheduleKey);
      const session = sessionRef.current;
      if (session?.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      sessionRef.current = null;
      const actor = actorRef.current;
      actorRef.current = null;
      actor?.stop();
    };
  }, [options.frameScheduler, options.scheduleKey]);

  useLayoutEffect(() => {
    const root = getRootRef.current();
    if (root !== null) root.dataset.groupDragState = stateRef.current;
    const element = overlayRef.current;
    const latest = latestViewRef.current;
    if (element !== null && latest !== undefined) updateGroupDragOverlay(element, latest);
  });

  const restore = useCallback(
    (groupId: string) => {
      options.restoreFocus(groupId);
    },
    [options],
  );

  const resetRejected = useCallback(
    (
      session: GroupDragSession<TCommand>,
      message: string,
      event: DragEvent = { type: "CANCEL" },
    ) => {
      options.frameScheduler.cancel(options.scheduleKey);
      session.pending = undefined;
      const current = send(session.actor, event);
      if (current === "recovering") send(session.actor, { type: "RECOVERED" });
      if (current === "cancelling") send(session.actor, { type: "RETURNED" });
      release(session);
      sessionRef.current = null;
      clearPresentation();
      options.announce(message);
      restore(session.group.id);
      disposeActor(session.actor);
    },
    [clearPresentation, disposeActor, options, release, restore, send],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.projection.revision === options.projection.revision) return;
    const current = String(session.actor.getSnapshot().value);
    if (current !== "armed" && current !== "dragging") return;
    resetRejected(session, options.messages.workspaceChangedBeforeGroupMove());
  }, [options.messages, options.projection.revision, resetRejected]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.geometryEpoch === geometryEpoch) return;
    const current = String(session.actor.getSnapshot().value);
    if (current !== "armed" && current !== "dragging") return;
    resetRejected(session, options.messages.workspaceChangedBeforeGroupMove());
  }, [geometryEpoch, options.messages, resetRejected]);

  const paintCandidate = useCallback(
    (session: GroupDragSession<TCommand>) => {
      if (
        sessionRef.current !== session ||
        actorRef.current !== session.actor ||
        String(session.actor.getSnapshot().value) !== "dragging"
      ) {
        return;
      }
      const target = outside(session.current, session.rootRect)
        ? undefined
        : hitTestGroupDropCandidates(
            session.candidates,
            toLogicalPoint(session.current, session.rootRect, session.bounds, session.direction),
          );
      const previousId = session.target?.id;
      session.target = target;
      if (target?.id !== previousId) {
        send(session.actor, {
          type: "SET_CANDIDATE",
          candidate: target === undefined ? undefined : { id: target.id, label: target.label },
        });
      }
      const nextView = createGroupDragView(session, target);
      latestViewRef.current = nextView;
      if (overlayRef.current !== null) updateGroupDragOverlay(overlayRef.current, nextView);
    },
    [send],
  );

  const consumeLatestPointer = useCallback(
    (session: GroupDragSession<TCommand>) => {
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
      if (next === "dragging") paintCandidate(session);
    },
    [paintCandidate, send],
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
      resetRejected(session, options.messages.workspaceChangedBeforeGroupMove());
    };
    ownerWindow.addEventListener("resize", invalidate);
    ownerWindow.addEventListener("scroll", invalidate, true);
    const Observer = ownerWindow.ResizeObserver;
    const observer =
      Observer === undefined
        ? undefined
        : new Observer(() => {
            const session = sessionRef.current;
            if (
              session !== null &&
              !samePhysicalRect(measureRoot(root, session.bounds), session.rootRect)
            ) {
              invalidate();
            }
          });
    observer?.observe(root);
    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener("resize", invalidate);
      ownerWindow.removeEventListener("scroll", invalidate, true);
    };
  }, [options.messages, resetRejected]);

  const begin = useCallback(
    (group: WorkspaceGroupView, event: ReactPointerEvent<HTMLButtonElement>) => {
      const root = options.getRoot();
      if (
        !options.enabled ||
        event.button !== 0 ||
        sessionRef.current !== null ||
        actorRef.current !== null ||
        (root?.dataset.panelDragState !== undefined && root.dataset.panelDragState !== "idle")
      ) {
        return;
      }
      const actor = createDragActor();
      actor.start();
      actorRef.current = actor;
      const session: GroupDragSession<TCommand> = {
        actor,
        group,
        projection: options.projection,
        bounds: options.logicalBounds,
        rootRect: measureRoot(root, options.logicalBounds),
        direction: options.direction,
        geometryEpoch,
        pointerId: event.pointerId,
        captureElement: event.currentTarget,
        candidates: createGroupDropCandidates(
          options.projection,
          options.resolvedLayout,
          group.id,
          options.direction,
          0.25,
          0.5,
          options.splitterSize,
          {
            swapPanelContainers: options.messages.swapPanelContainers,
            movePanelContainerBeside: options.messages.movePanelContainerBeside,
          },
          options.planDrop,
        ),
        current: pointerPosition(event),
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
    },
    [geometryEpoch, options, send],
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      session.pending = pointerPosition(event);
      options.frameScheduler.schedule(options.scheduleKey, () => consumeLatestPointer(session));
      event.preventDefault();
    },
    [consumeLatestPointer, options.frameScheduler, options.scheduleKey],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      options.frameScheduler.cancel(options.scheduleKey);
      session.pending = pointerPosition(event);
      consumeLatestPointer(session);
      const next = send(session.actor, { type: "POINTER_UP", pointerId: event.pointerId });
      release(session);

      if (next === "idle") {
        sessionRef.current = null;
        clearPresentation();
        disposeActor(session.actor);
        return;
      }

      suppressClickRef.current = session.group.id;
      session.captureElement.ownerDocument.defaultView?.setTimeout(() => {
        if (suppressClickRef.current === session.group.id) suppressClickRef.current = undefined;
      }, 0);
      sessionRef.current = null;
      clearPresentation();

      if (next !== "committing" || session.target === undefined) {
        if (next === "cancelling") send(session.actor, { type: "RETURNED" });
        options.announce(options.messages.groupMoveCancelledNoDestination());
        restore(session.group.id);
        disposeActor(session.actor);
        return;
      }
      if (
        currentRevisionRef.current !== session.projection.revision ||
        currentGeometryEpochRef.current !== session.geometryEpoch
      ) {
        send(session.actor, { type: "REVISION_CONFLICT" });
        send(session.actor, { type: "RECOVERED" });
        options.announce(options.messages.workspaceChangedBeforeGroupMove());
        restore(session.group.id);
        disposeActor(session.actor);
        return;
      }

      const candidate = session.target;
      try {
        const outcome = options.commitDrop(
          candidate.request,
          candidate.label,
          "pointer",
          candidate.plan.command,
        );
        settleDispatch(session, outcome, candidate.label, options, send, restore);
      } catch (error) {
        const message = boundedFailureMessage(error, options.messages.groupMoveRejected());
        send(session.actor, { type: "COMMIT_ERROR", message });
        send(session.actor, { type: "RECOVERED" });
        restore(session.group.id);
        options.announce(message);
      } finally {
        disposeActor(session.actor);
      }
    },
    [clearPresentation, consumeLatestPointer, disposeActor, options, release, restore, send],
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
      restore(session.group.id);
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
      restore(session.group.id);
      disposeActor(session.actor);
    },
    [clearPresentation, disposeActor, options, release, restore, send],
  );

  const consumeClick = useCallback((groupId: string) => {
    if (suppressClickRef.current !== groupId) return false;
    suppressClickRef.current = undefined;
    return true;
  }, []);

  const setOverlayRef = useCallback((element: HTMLDivElement | null) => {
    overlayRef.current = element;
    const latest = latestViewRef.current;
    if (element !== null && latest !== undefined) updateGroupDragOverlay(element, latest);
  }, []);

  return { overlayRef: setOverlayRef, begin, move, finish, cancel, keyDown, consumeClick };
}

export function GroupDragOverlay({
  overlayRef,
}: {
  readonly overlayRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={overlayRef} className="pf-panel-drag pf-group-drag" hidden aria-hidden="true">
      <div className="pf-panel-drop-preview" hidden />
      <div className="pf-panel-drag-ghost pf-group-drag-ghost">
        <strong />
      </div>
    </div>
  );
}

function createGroupDragView<TCommand>(
  session: GroupDragSession<TCommand>,
  target: GroupDropCandidate<TCommand> | undefined,
): GroupDragView {
  return {
    groupLabel: session.group.label?.trim() || "Panel group",
    pointer: session.current,
    previewRect: target?.previewRect,
    targetId: target?.id,
    targetKind: target?.request.target.kind,
    targetEdge: target?.request.target.kind === "edge" ? target.request.target.edge : undefined,
    targetLabel: target?.label,
    bounds: session.bounds,
    direction: session.direction,
    rootRect: session.rootRect,
  };
}

function settleDispatch<TCommand>(
  session: GroupDragSession<TCommand>,
  outcome: WorkspaceDispatchOutcome,
  committedLabel: string,
  options: UseGroupDragOptions<TCommand>,
  send: (actor: DragActor, event: DragEvent) => DragActorState,
  restore: (groupId: string) => void,
): void {
  if (outcome.status === "committed" || outcome.status === "queued") {
    send(session.actor, { type: "COMMIT_OK" });
    send(session.actor, { type: "SETTLED" });
    if (outcome.message === undefined && outcome.status === "committed") {
      options.announce(committedLabel);
    }
    restore(session.group.id);
    return;
  }
  const message = boundedMessage(outcome.message, options.messages.groupMoveRejected());
  send(session.actor, { type: "COMMIT_ERROR", message });
  send(session.actor, { type: "RECOVERED" });
  if (outcome.message === undefined) options.announce(message);
  restore(session.group.id);
}

function updateGroupDragOverlay(element: HTMLDivElement, view: GroupDragView): void {
  element.hidden = false;
  element.dataset.workspaceGroupDrag = "true";
  setData(element, "workspaceDropTarget", view.targetId);
  setData(element, "workspaceDropKind", view.targetKind);
  setData(element, "workspaceDropEdge", view.targetEdge);
  setOverlayRect(
    element.querySelector<HTMLElement>(".pf-panel-drop-preview"),
    toOverlayRect(view.previewRect, view.bounds, view.rootRect, view.direction),
  );
  const ghost = element.querySelector<HTMLElement>(".pf-group-drag-ghost");
  if (ghost === null) return;
  ghost.style.setProperty("--pf-drag-x", `${view.pointer.clientX - view.rootRect.left}px`);
  ghost.style.setProperty("--pf-drag-y", `${view.pointer.clientY - view.rootRect.top}px`);
  const title = ghost.querySelector<HTMLElement>("strong");
  if (title !== null) title.textContent = view.groupLabel;
  const label = ghost.querySelector<HTMLElement>("span");
  if (view.targetLabel === undefined) label?.remove();
  else if (label === null) {
    const next = ghost.ownerDocument.createElement("span");
    next.textContent = view.targetLabel;
    ghost.append(next);
  } else label.textContent = view.targetLabel;
}

function clearGroupDragOverlay(element: HTMLDivElement | null): void {
  if (element === null) return;
  element.hidden = true;
  delete element.dataset.workspaceGroupDrag;
  delete element.dataset.workspaceDropTarget;
  delete element.dataset.workspaceDropKind;
  delete element.dataset.workspaceDropEdge;
  setOverlayRect(element.querySelector<HTMLElement>(".pf-panel-drop-preview"), undefined);
  element.querySelector<HTMLElement>(".pf-group-drag-ghost span")?.remove();
}

function setData(
  element: HTMLElement,
  key: "workspaceDropTarget" | "workspaceDropKind" | "workspaceDropEdge",
  value: string | undefined,
): void {
  if (value === undefined) delete element.dataset[key];
  else element.dataset[key] = value;
}

function setOverlayRect(element: HTMLElement | null, rect: PhysicalRect | undefined): void {
  if (element === null) return;
  element.hidden = rect === undefined;
  if (rect === undefined) return;
  element.style.setProperty("--pf-drop-x", `${rect.left}px`);
  element.style.setProperty("--pf-drop-y", `${rect.top}px`);
  element.style.setProperty("--pf-drop-width", `${rect.width}px`);
  element.style.setProperty("--pf-drop-height", `${rect.height}px`);
}

function pointerPosition(event: ReactPointerEvent<HTMLElement>): PointerPosition {
  return { clientX: event.clientX, clientY: event.clientY };
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

function outside(position: PointerPosition, rect: PhysicalRect): boolean {
  return (
    position.clientX < rect.left ||
    position.clientX > rect.left + rect.width ||
    position.clientY < rect.top ||
    position.clientY > rect.top + rect.height
  );
}

function toLogicalPoint(
  position: PointerPosition,
  rootRect: PhysicalRect,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
) {
  const physicalInline =
    direction === "rtl"
      ? rootRect.left + rootRect.width - position.clientX
      : position.clientX - rootRect.left;
  return {
    inline: bounds.inlineStart + halfOpenRatio(physicalInline, rootRect.width) * bounds.inlineSize,
    block:
      bounds.blockStart +
      halfOpenRatio(position.clientY - rootRect.top, rootRect.height) * bounds.blockSize,
  };
}

function halfOpenRatio(offset: number, size: number): number {
  if (size <= 0) return 0;
  return Math.min(1 - Number.EPSILON, Math.max(0, offset / size));
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

function groupDragGeometryEpoch(
  layout: ResolvedLayout,
  bounds: LogicalRect,
  direction: WorkspaceDirection,
  splitterSize: number,
): string {
  const rectKey = (rect: LogicalRect | undefined) =>
    rect === undefined
      ? null
      : [rect.inlineStart, rect.blockStart, rect.inlineSize, rect.blockSize];
  return JSON.stringify([
    direction,
    splitterSize,
    layout.rootNodeId,
    rectKey(bounds),
    Object.entries(layout.groupRects)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([groupId, rect]) => [groupId, rectKey(rect)]),
    Object.entries(layout.nodeRects)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([nodeId, rect]) => [nodeId, rectKey(rect)]),
  ]);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRevision(value: string) {
  try {
    return revision(value);
  } catch {
    return revision(0);
  }
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
