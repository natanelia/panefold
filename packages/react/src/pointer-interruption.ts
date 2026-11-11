import { useCallback, useLayoutEffect, useRef } from "react";

/** Observe only the document that owns an active pointer gesture. */
export function usePointerInterruption(onInterrupt: () => void) {
  const onInterruptRef = useRef(onInterrupt);
  const disposeRef = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    onInterruptRef.current = onInterrupt;
  });

  const stop = useCallback(() => {
    const dispose = disposeRef.current;
    disposeRef.current = undefined;
    dispose?.();
  }, []);

  useLayoutEffect(() => stop, [stop]);

  const start = useCallback(
    (element: HTMLElement, options?: { readonly cancelOnEscape?: boolean }) => {
      stop();
      const ownerDocument = element.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;
      const interrupt = () => {
        // Detach before cancellation can release capture or update the tree.
        stop();
        onInterruptRef.current();
      };
      const onWindowBlur = (event: Event) => {
        if (event.target === event.currentTarget) interrupt();
      };
      const onPageHide = (event: Event) => {
        // Native pagehide uses Document as its legacy target override.
        if (event.target === event.currentTarget || event.target === ownerDocument) interrupt();
      };
      const onVisibilityChange = (event: Event) => {
        if (event.target === ownerDocument && ownerDocument.visibilityState === "hidden")
          interrupt();
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        interrupt();
      };
      ownerWindow?.addEventListener("blur", onWindowBlur);
      ownerWindow?.addEventListener("pagehide", onPageHide);
      ownerDocument.addEventListener("visibilitychange", onVisibilityChange);
      // Pointer capture does not move keyboard focus. Bubble so an editor can
      // claim Escape before it cancels the gesture, even with focus elsewhere.
      if (options?.cancelOnEscape) ownerDocument.addEventListener("keydown", onKeyDown);
      disposeRef.current = () => {
        ownerWindow?.removeEventListener("blur", onWindowBlur);
        ownerWindow?.removeEventListener("pagehide", onPageHide);
        ownerDocument.removeEventListener("visibilitychange", onVisibilityChange);
        if (options?.cancelOnEscape) ownerDocument.removeEventListener("keydown", onKeyDown);
      };
    },
    [stop],
  );

  return { start, stop };
}
