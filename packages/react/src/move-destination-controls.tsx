import { useId } from "react";
import type { WorkspaceMessageCatalog } from "./messages";

/** Pointer/touch alternatives to the move overlay's existing keyboard shortcuts. */
export function MoveDestinationControls({
  options,
  index,
  messages,
  onChange,
  onMove,
  onCancel,
}: {
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly index: number;
  readonly messages: WorkspaceMessageCatalog;
  readonly onChange: (index: number) => void;
  readonly onMove: () => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  return (
    <div className="pf-move-controls">
      <label htmlFor={id}>{messages.chooseDestination()}</label>
      <select
        id={id}
        value={options[index]?.id ?? ""}
        disabled={options.length === 0}
        onChange={(event) => {
          const next = options.findIndex((option) => option.id === event.target.value);
          if (next >= 0) onChange(next);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <div>
        <button type="button" onClick={onCancel}>
          {messages.cancelMove?.() ?? "Cancel move"}
        </button>
        <button type="button" disabled={options.length === 0} onClick={onMove}>
          {messages.moveHere?.() ?? "Move here"}
        </button>
      </div>
    </div>
  );
}
