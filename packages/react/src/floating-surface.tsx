import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { LogicalRect } from "@panefold/geometry";
import type { SurfaceFrameScheduler } from "@panefold/motion";
import { revision } from "@panefold/model";
import {
  createFloatingManipulationActor,
  type FloatingManipulationEvent,
} from "@panefold/protocol-xstate";

import type { ResolvedWorkspaceInteractionMessages } from "./messages";
import type {
  WorkspaceCommandOrigin,
  WorkspaceDirection,
  WorkspaceDispatchOutcome,
  WorkspaceFloatingBounds,
  WorkspaceFloatingSurfaceView,
} from "./types";

export const FLOATING_SURFACE_CHROME_SIZE = 34;
const MINIMUM_FLOATING_WIDTH = 200;
const MINIMUM_FLOATING_HEIGHT = 120;

type FloatingManipulationActor = ReturnType<typeof createFloatingManipulationActor>;
type FloatingResizeEdge =
  "top" | "right" | "bottom" | "left" | "top-left" | "top-right" | "bottom-right" | "bottom-left";

interface FloatingPointerSample {
  readonly clientX: number;
  readonly clientY: number;
}

interface FloatingPointerSession {
  readonly actor: FloatingManipulationActor;
  readonly mode: "move" | "resize";
  readonly edge: FloatingResizeEdge | undefined;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startBounds: WorkspaceFloatingBounds;
  readonly baseRevision: string;
  readonly viewportKey: string;
  readonly captureElement: HTMLElement;
  latestBounds: WorkspaceFloatingBounds;
  pending: FloatingPointerSample | undefined;
}

interface FloatingSurfaceHeaderSlot {
  readonly groupId: string;
  readonly target: HTMLDivElement | null;
}

const FloatingSurfaceHeaderSlotContext = createContext<FloatingSurfaceHeaderSlot | undefined>(
  undefined,
);

/** Resolves the titlebar portal owned by a compact single-group floating frame. */
export function useFloatingSurfaceHeaderSlot(groupId: string): HTMLDivElement | null | undefined {
  const slot = useContext(FloatingSurfaceHeaderSlotContext);
  return slot?.groupId === groupId ? slot.target : undefined;
}

export interface FloatingSurfaceFrameProps {
  readonly surface: WorkspaceFloatingSurfaceView;
  readonly compactGroupId?: string;
  readonly bounds: WorkspaceFloatingBounds;
  readonly projectionRevision: string;
  readonly title: string;
  readonly active: boolean;
  readonly frontmost: boolean;
  readonly zIndex: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scheduler: SurfaceFrameScheduler;
  readonly scheduleKey: string;
  readonly messages: ResolvedWorkspaceInteractionMessages;
  readonly onMove?: (
    bounds: WorkspaceFloatingBounds,
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
  ) => WorkspaceDispatchOutcome;
  readonly onResize?: (
    bounds: WorkspaceFloatingBounds,
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
  ) => WorkspaceDispatchOutcome;
  readonly onRaise?: (origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">) => void;
  readonly onMinimize?: (
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
  ) => WorkspaceDispatchOutcome;
  readonly onMaximize?: (
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
  ) => WorkspaceDispatchOutcome;
  readonly onRestore?: (
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
  ) => WorkspaceDispatchOutcome;
  readonly onRedock?: (
    origin: Extract<WorkspaceCommandOrigin, "pointer" | "keyboard">,
  ) => WorkspaceDispatchOutcome;
  readonly children?: ReactNode;
}

/**
 * Disposable DOM interaction around one canonical floating-surface view. The
 * frame previews pointer geometry directly and emits one semantic command on
 * release; it never retains committed bounds in React state.
 */
export function FloatingSurfaceFrame({
  surface,
  compactGroupId,
  bounds,
  projectionRevision,
  title,
  active,
  frontmost,
  zIndex,
  viewportWidth,
  viewportHeight,
  scheduler,
  scheduleKey,
  messages,
  onMove,
  onResize,
  onRaise,
  onMinimize,
  onMaximize,
  onRestore,
  onRedock,
  children,
}: FloatingSurfaceFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const sessionRef = useRef<FloatingPointerSession | undefined>(undefined);
  const handledRevisionRef = useRef(projectionRevision);
  const viewportKey = `${String(viewportWidth)}:${String(viewportHeight)}`;
  const handledViewportKeyRef = useRef(viewportKey);
  const currentRevisionRef = useRef(projectionRevision);
  const currentViewportKeyRef = useRef(viewportKey);
  const viewportVersionRef = useRef(0);
  const titlebarRef = useRef<HTMLElement>(null);
  const restoreControlRef = useRef<HTMLButtonElement>(null);
  const [headerSlotTarget, setHeaderSlotTarget] = useState<HTMLDivElement | null>(null);
  const focusAfterStateChangeRef = useRef<"restore-control" | "titlebar" | undefined>(undefined);
  const titleId = useId();
  const minimized = surface.minimized === true;
  const canMove = !surface.maximized;
  const canResize = canMove && !minimized;
  const compactHeader = compactGroupId !== undefined && !minimized;
  const headerSlot = useMemo<FloatingSurfaceHeaderSlot | undefined>(
    () =>
      compactHeader && compactGroupId !== undefined
        ? { groupId: compactGroupId, target: headerSlotTarget }
        : undefined,
    [compactGroupId, compactHeader, headerSlotTarget],
  );

  const applyPreview = useCallback(
    (next: WorkspaceFloatingBounds) => {
      const frame = frameRef.current;
      if (frame === null) return;
      frame.style.left = `${String(next.x)}px`;
      frame.style.top = `${String(next.y)}px`;
      frame.style.width = `${String(next.width)}px`;
      frame.style.height = `${String(minimized ? FLOATING_SURFACE_CHROME_SIZE : next.height)}px`;
    },
    [minimized],
  );

  const publishState = useCallback((value: unknown) => {
    const frame = frameRef.current;
    if (frame !== null) frame.dataset.floatingManipulation = String(value);
  }, []);

  const send = useCallback(
    (actor: FloatingManipulationActor, event: FloatingManipulationEvent) => {
      actor.send(event);
      const state = actor.getSnapshot().value;
      publishState(state);
      return String(state);
    },
    [publishState],
  );

  const disposeSession = useCallback(
    (session: FloatingPointerSession, restore: boolean) => {
      if (sessionRef.current === session) sessionRef.current = undefined;
      scheduler.cancel(scheduleKey);
      if (session.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      session.actor.stop();
      publishState("idle");
      if (restore) applyPreview(bounds);
    },
    [applyPreview, bounds, publishState, scheduleKey, scheduler],
  );

  useLayoutEffect(() => {
    currentRevisionRef.current = projectionRevision;
    currentViewportKeyRef.current = viewportKey;
    if (sessionRef.current === undefined) applyPreview(bounds);
    const focusTarget = focusAfterStateChangeRef.current;
    if (focusTarget === undefined) return;
    focusAfterStateChangeRef.current = undefined;
    if (focusTarget === "restore-control") restoreControlRef.current?.focus();
    else titlebarRef.current?.focus();
  }, [applyPreview, bounds, projectionRevision, surface.maximized, minimized, viewportKey]);

  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = undefined;
      scheduler.cancel(scheduleKey);
      if (session?.captureElement.hasPointerCapture?.(session.pointerId)) {
        session.captureElement.releasePointerCapture?.(session.pointerId);
      }
      session?.actor.stop();
      publishState("idle");
    },
    [publishState, scheduleKey, scheduler],
  );

  useEffect(() => {
    if (handledRevisionRef.current === projectionRevision) return;
    handledRevisionRef.current = projectionRevision;
    const session = sessionRef.current;
    if (session === undefined) return;
    send(session.actor, { type: "CANCEL" });
    send(session.actor, { type: "RECOVERED" });
    disposeSession(session, true);
  }, [disposeSession, projectionRevision, send]);

  useEffect(() => {
    if (handledViewportKeyRef.current === viewportKey) return;
    handledViewportKeyRef.current = viewportKey;
    viewportVersionRef.current += 1;
    const session = sessionRef.current;
    if (session === undefined) return;
    send(session.actor, { type: "VIEWPORT_CHANGED", version: viewportVersionRef.current });
    send(session.actor, { type: "CANCEL" });
    send(session.actor, { type: "RECOVERED" });
    disposeSession(session, true);
  }, [disposeSession, send, viewportKey]);

  const consumeLatest = useCallback(
    (session: FloatingPointerSession) => {
      const sample = session.pending;
      if (sample === undefined || sessionRef.current !== session) return;
      session.pending = undefined;
      const deltaX = sample.clientX - session.startClientX;
      const deltaY = sample.clientY - session.startClientY;
      const next =
        session.mode === "move"
          ? moveBounds(session.startBounds, deltaX, deltaY, viewportWidth, viewportHeight)
          : resizeBounds(
              session.startBounds,
              session.edge ?? "bottom-right",
              deltaX,
              deltaY,
              viewportWidth,
              viewportHeight,
            );
      session.latestBounds = next;
      send(session.actor, {
        type: "MOVE",
        pointerId: session.pointerId,
        position: floatingPosition(next),
      });
      applyPreview(next);
    },
    [applyPreview, send, viewportHeight, viewportWidth],
  );

  const begin = (
    mode: FloatingPointerSession["mode"],
    edge: FloatingResizeEdge | undefined,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (
      event.button !== 0 ||
      (mode === "move" ? !canMove || onMove === undefined : !canResize || onResize === undefined) ||
      sessionRef.current !== undefined
    ) {
      return;
    }
    const actor = createFloatingManipulationActor();
    actor.start();
    const session: FloatingPointerSession = {
      actor,
      mode,
      edge,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBounds: bounds,
      baseRevision: projectionRevision,
      viewportKey,
      latestBounds: bounds,
      pending: undefined,
      captureElement: event.currentTarget,
    };
    sessionRef.current = session;
    send(actor, {
      type: "START",
      mode,
      pointerId: event.pointerId,
      position: floatingPosition(bounds),
      baseRevision: safeRevision(projectionRevision),
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    session.pending = { clientX: event.clientX, clientY: event.clientY };
    scheduler.schedule(scheduleKey, () => consumeLatest(session));
    event.stopPropagation();
    event.preventDefault();
  };

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    scheduler.cancel(scheduleKey);
    if (currentRevisionRef.current !== session.baseRevision) {
      send(session.actor, { type: "POINTER_END", pointerId: event.pointerId });
      send(session.actor, { type: "REVISION_CONFLICT" });
      send(session.actor, { type: "RECOVERED" });
      disposeSession(session, true);
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (currentViewportKeyRef.current !== session.viewportKey) {
      viewportVersionRef.current += 1;
      send(session.actor, { type: "VIEWPORT_CHANGED", version: viewportVersionRef.current });
      send(session.actor, { type: "CANCEL" });
      send(session.actor, { type: "RECOVERED" });
      disposeSession(session, true);
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    session.pending = { clientX: event.clientX, clientY: event.clientY };
    consumeLatest(session);
    send(session.actor, { type: "POINTER_END", pointerId: event.pointerId });
    const changed = !sameBounds(session.startBounds, session.latestBounds);
    if (!changed) {
      send(session.actor, { type: "COMMIT_OK" });
      send(session.actor, { type: "SETTLED" });
      disposeSession(session, true);
      if (!frontmost || !active) onRaise?.("pointer");
      return;
    }

    let outcome: WorkspaceDispatchOutcome;
    try {
      outcome =
        session.mode === "move"
          ? (onMove?.(session.latestBounds, "pointer") ?? { status: "unknown" })
          : (onResize?.(session.latestBounds, "pointer") ?? { status: "unknown" });
    } catch {
      send(session.actor, { type: "COMMIT_ERROR", message: "dispatch-failed" });
      send(session.actor, { type: "RECOVERED" });
      disposeSession(session, true);
      return;
    }
    const committed = outcome.status === "committed" || outcome.status === "queued";
    if (committed) {
      send(session.actor, { type: "COMMIT_OK" });
      send(session.actor, { type: "SETTLED" });
    } else {
      send(session.actor, { type: "COMMIT_ERROR", message: outcome.status });
      send(session.actor, { type: "RECOVERED" });
    }
    disposeSession(session, !committed);
    event.stopPropagation();
    event.preventDefault();
  };

  const cancel = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    send(session.actor, {
      type: event.type === "lostpointercapture" ? "CAPTURE_LOST" : "POINTER_CANCEL",
      pointerId: event.pointerId,
    });
    send(session.actor, { type: "RECOVERED" });
    disposeSession(session, true);
    event.stopPropagation();
  };

  const moveByKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!canMove) return;
    if (
      (event.key === "Enter" || event.key === " ") &&
      (!frontmost || !active) &&
      onRaise !== undefined
    ) {
      event.preventDefault();
      onRaise("keyboard");
      return;
    }
    if (onMove === undefined) return;
    const step = event.shiftKey ? 32 : 8;
    const delta = keyboardDelta(event.key, step);
    if (delta === undefined) return;
    event.preventDefault();
    const next = moveBounds(bounds, delta.x, delta.y, viewportWidth, viewportHeight);
    if (!sameBounds(bounds, next)) onMove(next, "keyboard");
  };

  const resizeByKeyboard = (edge: FloatingResizeEdge, event: KeyboardEvent<HTMLElement>) => {
    if (!canResize || onResize === undefined) return;
    const step = event.shiftKey ? 32 : 8;
    const delta = keyboardDelta(event.key, step);
    if (delta === undefined || !edgeAcceptsDelta(edge, delta)) return;
    event.preventDefault();
    const next = resizeBounds(bounds, edge, delta.x, delta.y, viewportWidth, viewportHeight);
    if (!sameBounds(bounds, next)) onResize(next, "keyboard");
  };

  const frameStyle = {
    left: `${String(bounds.x)}px`,
    top: `${String(bounds.y)}px`,
    width: `${String(bounds.width)}px`,
    height: `${String(minimized ? FLOATING_SURFACE_CHROME_SIZE : bounds.height)}px`,
    zIndex,
  } satisfies CSSProperties;

  return (
    <FloatingSurfaceHeaderSlotContext.Provider value={headerSlot}>
      <section
        ref={frameRef}
        className="pf-floating-surface"
        aria-labelledby={titleId}
        data-workspace-floating-surface={surface.id}
        data-active={String(active)}
        data-frontmost={String(frontmost)}
        data-maximized={String(surface.maximized)}
        data-minimized={String(minimized)}
        data-compact-header={String(compactGroupId !== undefined)}
        data-floating-manipulation="idle"
        style={frameStyle}
        onPointerDown={() => {
          if (!frontmost || !active) onRaise?.("pointer");
        }}
      >
        <header
          ref={titlebarRef}
          className="pf-floating-titlebar"
          data-compact-header={String(compactHeader)}
          tabIndex={canMove && (onMove !== undefined || onRaise !== undefined) ? 0 : -1}
          aria-label={messages.moveFloatingSurface({ title })}
          onPointerDown={(event) => begin("move", undefined, event)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={moveByKeyboard}
          onDoubleClick={() => {
            if (surface.maximized && onRestore !== undefined) {
              focusAfterStateChangeRef.current = "titlebar";
              const outcome = onRestore("pointer");
              if (!acceptedOutcome(outcome)) focusAfterStateChangeRef.current = undefined;
            } else if (!minimized && onMaximize !== undefined) {
              focusAfterStateChangeRef.current = "restore-control";
              const outcome = onMaximize("pointer");
              if (!acceptedOutcome(outcome)) focusAfterStateChangeRef.current = undefined;
            }
          }}
        >
          <strong
            id={titleId}
            className={compactHeader ? "pf-visually-hidden" : "pf-floating-title"}
            dir="auto"
          >
            {title}
          </strong>
          {compactHeader ? (
            <>
              <div ref={setHeaderSlotTarget} className="pf-floating-header-slot" />
              <span className="pf-floating-header-drag-region" aria-hidden="true" />
            </>
          ) : null}
          <div
            className="pf-floating-controls"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            {onRedock === undefined ? null : (
              <button
                type="button"
                aria-label={messages.redockFloatingSurface({ title })}
                title={messages.redockFloatingSurface({ title })}
                onClick={(event) => onRedock(event.detail === 0 ? "keyboard" : "pointer")}
              >
                <span aria-hidden="true">↙</span>
              </button>
            )}
            {minimized || onMinimize === undefined ? null : (
              <button
                type="button"
                aria-label={messages.minimizeFloatingSurface({ title })}
                title={messages.minimizeFloatingSurface({ title })}
                onClick={(event) => {
                  focusAfterStateChangeRef.current = "restore-control";
                  const outcome = onMinimize(event.detail === 0 ? "keyboard" : "pointer");
                  if (!acceptedOutcome(outcome)) focusAfterStateChangeRef.current = undefined;
                }}
              >
                <span aria-hidden="true">−</span>
              </button>
            )}
            {surface.maximized || minimized ? (
              onRestore === undefined ? null : (
                <button
                  ref={restoreControlRef}
                  type="button"
                  aria-label={messages.restoreFloatingSurface({ title })}
                  title={messages.restoreFloatingSurface({ title })}
                  onClick={(event) => {
                    focusAfterStateChangeRef.current = "titlebar";
                    const outcome = onRestore(event.detail === 0 ? "keyboard" : "pointer");
                    if (!acceptedOutcome(outcome)) focusAfterStateChangeRef.current = undefined;
                  }}
                >
                  <span aria-hidden="true">❐</span>
                </button>
              )
            ) : onMaximize === undefined ? null : (
              <button
                type="button"
                aria-label={messages.maximizeFloatingSurface({ title })}
                title={messages.maximizeFloatingSurface({ title })}
                onClick={(event) => {
                  focusAfterStateChangeRef.current = "restore-control";
                  const outcome = onMaximize(event.detail === 0 ? "keyboard" : "pointer");
                  if (!acceptedOutcome(outcome)) focusAfterStateChangeRef.current = undefined;
                }}
              >
                <span aria-hidden="true">□</span>
              </button>
            )}
          </div>
        </header>
        {minimized ? null : <div className="pf-floating-content">{children}</div>}
        {!canResize || onResize === undefined
          ? null
          : FLOATING_RESIZE_EDGES.map((edge) => (
              <div
                key={edge}
                className="pf-floating-resize-handle"
                data-resize-edge={edge}
                role="separator"
                tabIndex={0}
                aria-label={messages.resizeFloatingSurface({ title, edge: edgeLabel(edge) })}
                onPointerDown={(event) => begin("resize", edge, event)}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={(event) => resizeByKeyboard(edge, event)}
              />
            ))}
      </section>
    </FloatingSurfaceHeaderSlotContext.Provider>
  );
}

const FLOATING_RESIZE_EDGES: readonly FloatingResizeEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

export function resolveFloatingSurfaceBounds(
  surface: WorkspaceFloatingSurfaceView,
  viewportWidth: number,
  viewportHeight: number,
): WorkspaceFloatingBounds {
  const safeViewportWidth = finiteSize(viewportWidth);
  const safeViewportHeight = finiteSize(viewportHeight);
  if (surface.maximized && safeViewportWidth > 0 && safeViewportHeight > 0) {
    return { x: 0, y: 0, width: safeViewportWidth, height: safeViewportHeight };
  }
  if (safeViewportWidth === 0 || safeViewportHeight === 0) return surface.bounds;
  const minimumWidth = Math.min(MINIMUM_FLOATING_WIDTH, safeViewportWidth);
  const minimumHeight = Math.min(MINIMUM_FLOATING_HEIGHT, safeViewportHeight);
  const width = clamp(finiteSize(surface.bounds.width), minimumWidth, safeViewportWidth);
  const height = clamp(finiteSize(surface.bounds.height), minimumHeight, safeViewportHeight);
  return {
    x: clamp(finiteOrigin(surface.bounds.x), 0, Math.max(0, safeViewportWidth - width)),
    y: clamp(finiteOrigin(surface.bounds.y), 0, Math.max(0, safeViewportHeight - height)),
    width,
    height,
  };
}

/** Maps physical floating-window hints into the renderer's global logical geometry. */
export function floatingSurfaceContentBounds(
  bounds: WorkspaceFloatingBounds,
  workspaceBounds: LogicalRect,
  direction: WorkspaceDirection,
): LogicalRect {
  const inlineOffset =
    direction === "ltr" ? bounds.x : workspaceBounds.inlineSize - bounds.x - bounds.width;
  return {
    inlineStart: workspaceBounds.inlineStart + inlineOffset,
    blockStart: workspaceBounds.blockStart + bounds.y + FLOATING_SURFACE_CHROME_SIZE,
    inlineSize: bounds.width,
    blockSize: Math.max(0, bounds.height - FLOATING_SURFACE_CHROME_SIZE),
  };
}

function moveBounds(
  bounds: WorkspaceFloatingBounds,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): WorkspaceFloatingBounds {
  return {
    ...bounds,
    x: clamp(bounds.x + deltaX, 0, Math.max(0, viewportWidth - bounds.width)),
    y: clamp(bounds.y + deltaY, 0, Math.max(0, viewportHeight - bounds.height)),
  };
}

function resizeBounds(
  bounds: WorkspaceFloatingBounds,
  edge: FloatingResizeEdge,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): WorkspaceFloatingBounds {
  const minimumWidth = Math.min(MINIMUM_FLOATING_WIDTH, viewportWidth);
  const minimumHeight = Math.min(MINIMUM_FLOATING_HEIGHT, viewportHeight);
  let x = bounds.x;
  let y = bounds.y;
  let width = bounds.width;
  let height = bounds.height;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  if (edge.includes("left")) {
    x = clamp(bounds.x + deltaX, 0, right - minimumWidth);
    width = right - x;
  }
  if (edge.includes("right")) {
    width = clamp(bounds.width + deltaX, minimumWidth, viewportWidth - bounds.x);
  }
  if (edge.includes("top")) {
    y = clamp(bounds.y + deltaY, 0, bottom - minimumHeight);
    height = bottom - y;
  }
  if (edge.includes("bottom")) {
    height = clamp(bounds.height + deltaY, minimumHeight, viewportHeight - bounds.y);
  }
  return { x, y, width, height };
}

function floatingPosition(bounds: WorkspaceFloatingBounds) {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function keyboardDelta(
  key: string,
  step: number,
): { readonly x: number; readonly y: number } | undefined {
  if (key === "ArrowLeft") return { x: -step, y: 0 };
  if (key === "ArrowRight") return { x: step, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -step };
  if (key === "ArrowDown") return { x: 0, y: step };
  return undefined;
}

function edgeAcceptsDelta(
  edge: FloatingResizeEdge,
  delta: { readonly x: number; readonly y: number },
): boolean {
  return (
    (delta.x !== 0 && (edge.includes("left") || edge.includes("right"))) ||
    (delta.y !== 0 && (edge.includes("top") || edge.includes("bottom")))
  );
}

function edgeLabel(edge: FloatingResizeEdge): string {
  return edge.replace("-", " ");
}

function acceptedOutcome(outcome: WorkspaceDispatchOutcome): boolean {
  return outcome.status === "committed" || outcome.status === "queued";
}

function sameBounds(left: WorkspaceFloatingBounds, right: WorkspaceFloatingBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function safeRevision(value: string) {
  try {
    return revision(BigInt(value));
  } catch {
    return revision(0);
  }
}

function finiteOrigin(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function finiteSize(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
