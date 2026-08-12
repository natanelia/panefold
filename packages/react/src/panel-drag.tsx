import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { LogicalRect, ResolvedLayout } from "@panefold/geometry";
import { createDragActor, type DragEvent } from "@panefold/protocol-xstate";
import { revision } from "@panefold/model";

import {
  createPanelDropCandidates,
  hitTestPanelDropCandidates,
  panelsForGroup,
  type PanelDropCandidate,
} from "./panel-drop";
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
} from "./types";

type DragActorState =
  "idle" | "armed" | "dragging" | "committing" | "settling" | "cancelling" | "recovering";

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

type ActiveCandidate<TCommand = unknown> = ExternalCandidate | InternalCandidate<TCommand>;

interface DragSession<TCommand = unknown> {
  readonly panel: WorkspacePanelView;
  readonly sourceGroup: WorkspaceGroupView;
  readonly projection: WorkspaceProjection;
  readonly layout: ResolvedLayout;
  readonly bounds: LogicalRect;
  readonly direction: WorkspaceDirection;
  readonly geometryEpoch: string;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly captureElement: HTMLElement;
  readonly candidates: readonly PanelDropCandidate<TCommand>[];
  current: WorkspaceExternalPanelPosition;
  target: ActiveCandidate<TCommand> | undefined;
}

export interface ExternalPanelInvocation {
  readonly panel: WorkspacePanelView;
  readonly sourceGroup: WorkspaceGroupView;
  readonly sourcePanels: readonly WorkspacePanelView[];
  readonly origin: "pointer" | "keyboard" | "menu";
  readonly position: WorkspaceExternalPanelPosition;
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
  readonly planDrop:
    | ((
        request: WorkspacePanelDropRequest,
        context: WorkspacePanelDropPlanContext,
      ) => WorkspacePanelDropPlan<TCommand> | undefined)
    | undefined;
  readonly getRoot: () => HTMLElement | null;
  readonly announce: (message: string) => void;
  readonly commitDrop: (
    request: WorkspacePanelDropRequest,
    label: string,
    origin: "pointer",
    plannedCommand?: TCommand,
  ) => WorkspaceDispatchOutcome;
  /** Calling this function must invoke the application handler synchronously. */
  readonly requestExternal: (
    invocation: ExternalPanelInvocation,
  ) => WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
  readonly restoreFocus: (panelId: string) => void;
}

export interface PanelDragController {
  readonly state: DragActorState;
  readonly view: PanelDragView | undefined;
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
  readonly targetKind: "center" | "edge" | "external" | undefined;
  readonly targetEdge: string | undefined;
  readonly targetLabel: string | undefined;
  readonly externalAvailable: boolean;
  readonly bounds: LogicalRect;
  readonly direction: WorkspaceDirection;
  readonly rootRect: PhysicalRect;
}

interface PhysicalRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function usePanelDrag<TCommand>(
  options: UsePanelDragOptions<TCommand>,
): PanelDragController {
  const [actor] = useState(() => createDragActor());
  const [state, setState] = useState<DragActorState>("idle");
  const [view, setView] = useState<PanelDragView | undefined>(undefined);
  const sessionRef = useRef<DragSession<TCommand> | null>(null);
  const suppressClickRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
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

  useEffect(() => {
    mountedRef.current = true;
    const subscription = actor.subscribe((snapshot) => {
      if (mountedRef.current) setState(String(snapshot.value) as DragActorState);
    });
    actor.start();
    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      actor.stop();
    };
  }, [actor]);

  const send = useCallback(
    (event: DragEvent): DragActorState => {
      actor.send(event);
      const next = String(actor.getSnapshot().value) as DragActorState;
      setState(next);
      return next;
    },
    [actor],
  );

  const release = useCallback((session: DragSession<TCommand>) => {
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
      const current = send(event);
      if (current === "recovering") send({ type: "RECOVERED" });
      if (current === "cancelling") send({ type: "RETURNED" });
      release(session);
      sessionRef.current = null;
      setView(undefined);
      options.announce(message);
      restore(session.panel.id);
    },
    [options, release, restore, send],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.projection.revision === options.projection.revision) return;
    const current = String(actor.getSnapshot().value);
    if (current !== "armed" && current !== "dragging") return;
    resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
  }, [actor, options.messages, options.projection.revision, resetRejected]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session === null || session.geometryEpoch === geometryEpoch) return;
    const current = String(actor.getSnapshot().value);
    if (current !== "armed" && current !== "dragging") return;
    resetRejected(session, options.messages.workspaceChangedBeforePanelMove());
  }, [actor, geometryEpoch, options.messages, resetRejected]);

  const updateCandidate = useCallback(
    (session: DragSession<TCommand>, position: WorkspaceExternalPanelPosition) => {
      session.current = position;
      send({
        type: "POINTER_MOVE",
        pointerId: session.pointerId,
        position: { x: position.clientX, y: position.clientY },
      });
      if (String(actor.getSnapshot().value) !== "dragging") return;

      const rootRect = measureRoot(options.getRoot(), session.bounds);
      let target: ActiveCandidate<TCommand> | undefined;
      if (outside(position, rootRect)) {
        target = {
          kind: "external",
          id: "external",
          label: options.externalAvailable
            ? options.messages.openPanelInNewWindow({ title: session.panel.title })
            : options.messages.newWindowUnavailable(),
          available: options.externalAvailable,
        };
      } else {
        const logicalPoint = toLogicalPoint(position, rootRect, session.bounds, session.direction);
        const candidate = hitTestPanelDropCandidates(session.candidates, logicalPoint);
        if (candidate !== undefined) target = { kind: "internal", candidate };
      }

      const previousId = activeCandidateId(session.target);
      session.target = target;
      const dragCandidate =
        target === undefined
          ? undefined
          : {
              id: activeCandidateId(target) ?? "",
              label: target.kind === "external" ? target.label : target.candidate.label,
            };
      send({ type: "SET_CANDIDATE", candidate: dragCandidate });
      if (activeCandidateId(target) !== previousId && dragCandidate !== undefined) {
        options.announce(dragCandidate.label);
      }
      setView(createDragView(session, target, rootRect));
    },
    [actor, options, send],
  );

  const begin = useCallback(
    (
      panel: WorkspacePanelView,
      group: WorkspaceGroupView,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (!options.enabled || event.button !== 0 || sessionRef.current !== null) return;
      const position = externalPosition(event);
      const session: DragSession<TCommand> = {
        panel,
        sourceGroup: group,
        projection: options.projection,
        layout: options.resolvedLayout,
        bounds: options.logicalBounds,
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
        current: position,
        target: undefined,
      };
      sessionRef.current = session;
      send({
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
      updateCandidate(session, externalPosition(event));
      if (String(actor.getSnapshot().value) === "dragging") event.preventDefault();
    },
    [actor, updateCandidate],
  );

  const settleExternal = useCallback(
    (session: DragSession<TCommand>, outcome: WorkspaceExternalPanelOutcome) => {
      if (!mountedRef.current) return;
      if (outcome.status === "committed") {
        send({ type: "COMMIT_OK" });
        send({ type: "SETTLED" });
        options.announce(
          outcome.message ??
            options.messages.openedPanelInNewWindow({ title: session.panel.title }),
        );
        return;
      }
      send({
        type: "COMMIT_ERROR",
        message:
          outcome.message ??
          options.messages.couldNotOpenPanelInNewWindow({
            title: session.panel.title,
          }),
      });
      send({ type: "RECOVERED" });
      options.announce(
        outcome.message ??
          options.messages.couldNotOpenPanelInNewWindow({ title: session.panel.title }),
      );
      restore(session.panel.id);
    },
    [options, restore, send],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      updateCandidate(session, externalPosition(event));
      const next = send({ type: "POINTER_UP", pointerId: event.pointerId });
      release(session);

      if (next === "idle") {
        sessionRef.current = null;
        setView(undefined);
        return;
      }

      suppressClickRef.current = session.panel.id;
      session.captureElement.ownerDocument.defaultView?.setTimeout(() => {
        if (suppressClickRef.current === session.panel.id) suppressClickRef.current = undefined;
      }, 0);
      sessionRef.current = null;
      setView(undefined);

      if (next !== "committing" || session.target === undefined) {
        if (next === "cancelling") send({ type: "RETURNED" });
        options.announce(options.messages.panelMoveCancelledNoDestination());
        restore(session.panel.id);
        return;
      }

      // The candidate was projected from this exact revision. Never ask the
      // application planner to commit stale geometry.
      if (
        currentRevisionRef.current !== session.projection.revision ||
        currentGeometryEpochRef.current !== session.geometryEpoch
      ) {
        send({ type: "REVISION_CONFLICT" });
        send({ type: "RECOVERED" });
        options.announce(options.messages.workspaceChangedBeforePanelMove());
        restore(session.panel.id);
        return;
      }

      if (session.target.kind === "internal") {
        const outcome = options.commitDrop(
          session.target.candidate.request,
          session.target.candidate.label,
          "pointer",
          session.target.candidate.plan.command,
        );
        if (outcome.status === "committed" || outcome.status === "queued") {
          send({ type: "COMMIT_OK" });
          send({ type: "SETTLED" });
        } else {
          send({
            type: "COMMIT_ERROR",
            message: outcome.message ?? options.messages.panelMoveRejected(),
          });
          send({ type: "RECOVERED" });
          restore(session.panel.id);
        }
        return;
      }

      if (!session.target.available) {
        send({ type: "COMMIT_ERROR", message: options.messages.newWindowUnavailable() });
        send({ type: "RECOVERED" });
        options.announce(options.messages.newWindowUnavailable());
        restore(session.panel.id);
        return;
      }

      // Intentionally call inside pointerup, before creating a promise chain,
      // so window.open remains covered by browser transient activation.
      let outcome: WorkspaceExternalPanelOutcome | Promise<WorkspaceExternalPanelOutcome>;
      try {
        outcome = options.requestExternal({
          panel: session.panel,
          sourceGroup: session.sourceGroup,
          sourcePanels: panelsForGroup(session.projection, session.sourceGroup),
          origin: "pointer",
          position: session.current,
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
              message:
                error instanceof Error
                  ? error.message
                  : options.messages.couldNotOpenPanelInNewWindow({
                      title: session.panel.title,
                    }),
            }),
        );
      } else {
        settleExternal(session, outcome);
      }
    },
    [options, release, restore, send, settleExternal, updateCandidate],
  );

  const cancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = sessionRef.current;
      if (session === null || session.pointerId !== event.pointerId) return;
      const type = event.type === "lostpointercapture" ? "CAPTURE_LOST" : "POINTER_CANCEL";
      const next = send({ type, pointerId: event.pointerId });
      release(session);
      sessionRef.current = null;
      setView(undefined);
      if (next === "cancelling") send({ type: "RETURNED" });
      if (next !== "idle") options.announce(options.messages.moveCancelled());
      restore(session.panel.id);
    },
    [options, release, restore, send],
  );

  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Escape") return;
      const session = sessionRef.current;
      if (session === null) return;
      event.preventDefault();
      const next = send({ type: "CANCEL" });
      release(session);
      sessionRef.current = null;
      setView(undefined);
      if (next === "cancelling") send({ type: "RETURNED" });
      options.announce(options.messages.moveCancelled());
      restore(session.panel.id);
    },
    [options, release, restore, send],
  );

  const consumeClick = useCallback((panelId: string) => {
    if (suppressClickRef.current !== panelId) return false;
    suppressClickRef.current = undefined;
    return true;
  }, []);

  return { state, view, begin, move, finish, cancel, keyDown, consumeClick };
}

export function PanelDragOverlay({ view }: { readonly view: PanelDragView }) {
  const preview = toOverlayRect(view.previewRect, view.bounds, view.rootRect, view.direction);
  const ghostX = view.pointer.clientX - view.rootRect.left;
  const ghostY = view.pointer.clientY - view.rootRect.top;
  return (
    <div
      className="pf-panel-drag"
      data-workspace-panel-drag="true"
      data-workspace-drop-target={view.targetId}
      data-workspace-drop-kind={view.targetKind}
      data-workspace-drop-edge={view.targetEdge}
      aria-hidden="true"
    >
      {preview === undefined ? null : (
        <div
          className="pf-panel-drop-preview"
          style={
            {
              "--pf-drop-x": `${preview.left}px`,
              "--pf-drop-y": `${preview.top}px`,
              "--pf-drop-width": `${preview.width}px`,
              "--pf-drop-height": `${preview.height}px`,
            } as CSSProperties
          }
        />
      )}
      <div
        className="pf-panel-drag-ghost"
        data-external={String(view.targetKind === "external")}
        data-available={String(view.externalAvailable)}
        style={
          {
            "--pf-drag-x": `${ghostX}px`,
            "--pf-drag-y": `${ghostY}px`,
          } as CSSProperties
        }
      >
        <strong>{view.panelTitle}</strong>
        {view.targetLabel === undefined ? null : <span>{view.targetLabel}</span>}
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
  return {
    panelTitle: session.panel.title,
    pointer: session.current,
    previewRect: candidate?.previewRect,
    targetId: activeCandidateId(target),
    targetKind: target?.kind === "external" ? "external" : candidate?.request.target.kind,
    targetEdge:
      candidate?.request.target.kind === "edge" ? candidate.request.target.edge : undefined,
    targetLabel: target?.kind === "external" ? target.label : candidate?.label,
    externalAvailable: target?.kind === "external" ? target.available : true,
    bounds: session.bounds,
    direction: session.direction,
    rootRect,
  };
}

function activeCandidateId<TCommand>(
  target: ActiveCandidate<TCommand> | undefined,
): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === "external" ? target.id : target.candidate.id;
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
