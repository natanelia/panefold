import { useEffect, useRef, type ButtonHTMLAttributes } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  readonly onClick: () => void;
};

/** A touch release is the activation boundary; do not rely on a later compatibility click.
 * Mouse and keyboard retain native button behavior. A swipe or cancelled touch never activates.
 */
export function TouchButton({ onClick, disabled, type = "button", ...props }: Props) {
  const touch = useRef<{ id: number; x: number; y: number; moved: boolean } | undefined>(undefined);
  const activatedAt = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      onPointerDown={(event) => {
        activatedAt.current = undefined;
        touch.current =
          !disabled && event.pointerType === "touch" && event.isPrimary
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            : undefined;
      }}
      onPointerMove={(event) => {
        const start = touch.current;
        if (
          start?.id === event.pointerId &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
        )
          start.moved = true;
      }}
      onPointerCancel={() => {
        touch.current = undefined;
      }}
      onPointerUp={(event) => {
        const start = touch.current;
        touch.current = undefined;
        if (disabled || start?.id !== event.pointerId || start.moved) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          return;
        activatedAt.current = event.timeStamp;
        const button = event.currentTarget;
        // Complete the native touch sequence before removing or opening a dialog.
        // This prevents the browser's remaining default focus action from undoing
        // the dialog's focus restoration.
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined;
          if (!button.isConnected || button.disabled) return;
          button.focus({ preventScroll: true });
          onClick();
        });
      }}
      onClick={(event) => {
        const touchTime = activatedAt.current;
        // Native touch may emit a compatibility click after pointerup. Keyboard and
        // assistive-technology clicks (detail=0) are independent activations.
        if (event.detail !== 0 && touchTime !== undefined && event.timeStamp - touchTime < 1000) {
          activatedAt.current = undefined;
          return;
        }
        if (!disabled) onClick();
      }}
    />
  );
}
