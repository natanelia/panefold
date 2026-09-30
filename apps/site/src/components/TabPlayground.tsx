import { useState } from "react";
import { FileCode2, FileText, SlidersHorizontal } from "lucide-react";
import { CodeBlock } from "./CodeBlock";

const placements = [
  ["block-start", "Top"],
  ["block-end", "Bottom"],
  ["inline-start", "Start"],
  ["inline-end", "End"],
] as const;
const contents = [
  ["icon-and-label", "Icons + labels"],
  ["icon-only", "Icons"],
  ["label-only", "Labels"],
] as const;
export function TabPlayground() {
  const [placement, setPlacement] = useState<(typeof placements)[number][0]>("block-start");
  const [content, setContent] = useState<(typeof contents)[number][0]>("icon-and-label");
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [selected, setSelected] = useState("Workspace");
  return (
    <div className="tab-playground">
      <div className="playground-controls">
        <fieldset>
          <legend>Tab rail</legend>
          <div className="segmented">
            {placements.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={placement === value}
                onClick={() => setPlacement(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Tab content</legend>
          <div className="segmented">
            {contents.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={content === value}
                onClick={() => setContent(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="direction-toggle">
          <input
            type="checkbox"
            checked={direction === "rtl"}
            onChange={(event) => setDirection(event.target.checked ? "rtl" : "ltr")}
          />{" "}
          Right-to-left
        </label>
      </div>
      <div className="rail-preview" data-placement={placement} dir={direction}>
        <div className="preview-tabs" aria-label="Appearance example panels">
          {[
            ["Workspace", FileCode2],
            ["Notes", FileText],
            ["Inspector", SlidersHorizontal],
          ].map(([name, Icon]) => {
            const label = name as string;
            const TabIcon = Icon as typeof FileCode2;
            return (
              <button
                key={label}
                type="button"
                aria-label={label}
                aria-pressed={selected === label}
                title={label}
                onClick={() => setSelected(label)}
              >
                {content !== "label-only" ? <TabIcon size={16} aria-hidden="true" /> : null}
                {content !== "icon-only" ? <span>{label}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="preview-content">
          <span className="preview-dot-grid" aria-hidden="true" />
          <span className="section-eyebrow">Your {selected.toLowerCase()}, your way</span>
          <strong>
            {selected === "Workspace"
              ? "Room for the work."
              : selected === "Notes"
                ? "Keep the thought in view."
                : "Details, right where you need them."}
          </strong>
          <p>Presentation changes. Your layout model stays the same.</p>
        </div>
      </div>
      <p className="fine-print">
        Interactive appearance sketch—not the docking runtime. Try real dragging in the playground.
      </p>
      <CodeBlock
        language="tsx"
        label="WorkspaceSurface props"
        code={`tabPresentation={{\n  placement: "${placement}",\n  content: "${content}",\n}}\ndirection="${direction}"`}
      />
    </div>
  );
}
