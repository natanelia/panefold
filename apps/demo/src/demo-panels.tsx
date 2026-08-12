import { useId, useState, type ReactNode } from "react";
import type { WorkspacePanelRegistry, WorkspacePanelRenderProps } from "@panefold/react";

type GlyphName =
  "route" | "layers" | "map" | "notes" | "inspect" | "validate" | "problems" | "timeline";

export function Glyph({ name }: { readonly name: GlyphName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };
  const paths: Record<GlyphName, ReactNode> = {
    route: (
      <>
        <circle cx="4" cy="12" r="1.5" {...common} />
        <circle cx="12" cy="4" r="1.5" {...common} />
        <path d="M5.5 12c4 0 2-8 5-8" {...common} />
      </>
    ),
    layers: (
      <>
        <path d="m2.5 6 5.5-3 5.5 3L8 9 2.5 6Z" {...common} />
        <path d="m3 9 5 2.8L13 9M3 12l5 2.7 5-2.7" {...common} />
      </>
    ),
    map: (
      <path
        d="m2.5 3 3.7-1.5 3.6 1.6L13.5 2v11L9.8 14l-3.6-1.6-3.7 1.5V3Z M6.2 1.5v10.9M9.8 3.1V14"
        {...common}
      />
    ),
    notes: (
      <>
        <path d="M3 2h10v12H3z" {...common} />
        <path d="M5.2 5h5.6M5.2 8h5.6M5.2 11h3.5" {...common} />
      </>
    ),
    inspect: (
      <>
        <circle cx="7" cy="7" r="4" {...common} />
        <path d="m10 10 3.5 3.5" {...common} />
      </>
    ),
    validate: (
      <>
        <path d="M8 1.5 13 3v4c0 3.1-1.8 5.6-5 7-3.2-1.4-5-3.9-5-7V3l5-1.5Z" {...common} />
        <path d="m5.5 7.5 1.7 1.7 3.5-3.7" {...common} />
      </>
    ),
    problems: (
      <>
        <path d="M8 2 14 13H2L8 2Z" {...common} />
        <path d="M8 5.5v3.8M8 11.3v.2" {...common} />
      </>
    ),
    timeline: (
      <>
        <path d="M4 2v12M4 5h5M4 11h7" {...common} />
        <circle cx="4" cy="5" r="1" fill="currentColor" />
        <circle cx="4" cy="11" r="1" fill="currentColor" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function PanelFrame({
  children,
  toolbar,
  status,
}: {
  readonly children: ReactNode;
  readonly toolbar?: ReactNode;
  readonly status?: ReactNode;
}) {
  return (
    <div className="demo-panel-frame">
      {toolbar === undefined ? null : <div className="demo-panel-toolbar">{toolbar}</div>}
      <div className="demo-panel-body">{children}</div>
      {status === undefined ? null : <div className="demo-panel-status">{status}</div>}
    </div>
  );
}

function MapCanvasPanel({ panel, lifecycle }: WorkspacePanelRenderProps) {
  const [zoom, setZoom] = useState(15.8);
  const [selectedFeature, setSelectedFeature] = useState("LN-1842");
  const [showLabels, setShowLabels] = useState(true);
  const mountToken = useId().replaceAll(":", "");

  return (
    <PanelFrame
      toolbar={
        <>
          <div className="demo-segmented" aria-label="Map view mode">
            <button type="button" aria-pressed="true">
              Map
            </button>
            <button type="button" aria-pressed="false">
              Satellite
            </button>
          </div>
          <span className="demo-toolbar-spacer" />
          <label className="demo-compact-check">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => {
                setShowLabels(event.target.checked);
              }}
            />
            Labels
          </label>
          <button
            type="button"
            className="demo-icon-button"
            aria-label="Zoom out"
            onClick={() => {
              setZoom((value) => Math.max(12, value - 0.5));
            }}
          >
            −
          </button>
          <output aria-label="Map zoom" className="demo-zoom-output">
            {zoom.toFixed(1)}
          </output>
          <button
            type="button"
            className="demo-icon-button"
            aria-label="Zoom in"
            onClick={() => {
              setZoom((value) => Math.min(20, value + 0.5));
            }}
          >
            +
          </button>
        </>
      }
      status={
        <>
          <span>1.3521° N, 103.8198° E</span>
          <span>Zoom {zoom.toFixed(1)}</span>
          <span className="demo-lifecycle-badge" data-state={lifecycle}>
            {lifecycle === "suspended" ? "Render work paused" : `Render ${lifecycle}`}
          </span>
          <span className="demo-mount-proof" title="Local panel state survives same-document moves">
            Host {mountToken}
          </span>
        </>
      }
    >
      <div className="demo-map" data-panel-id={panel.id}>
        <svg
          viewBox="0 0 960 620"
          role="group"
          aria-label="Interactive HD map around One-North with a selected route and lane features"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern id="minor-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M28 0H0V28" fill="none" stroke="currentColor" strokeOpacity=".065" />
            </pattern>
            <pattern id="major-grid" width="140" height="140" patternUnits="userSpaceOnUse">
              <rect width="140" height="140" fill="url(#minor-grid)" />
              <path d="M140 0H0V140" fill="none" stroke="currentColor" strokeOpacity=".12" />
            </pattern>
            <filter id="route-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect width="960" height="620" className="map-base" />
          <rect width="960" height="620" fill="url(#major-grid)" />
          <g className="map-blocks">
            <path d="M80 70h190l35 120-126 72-121-58Z" />
            <path d="M360 52h166l70 110-41 122-192-12-52-101Z" />
            <path d="M670 38h216l25 152-94 81-178-47-27-102Z" />
            <path d="M81 374l168-73 105 81-36 173H94l-49-99Z" />
            <path d="M430 355l177-49 88 106-50 155H438l-71-96Z" />
            <path d="M750 345l151 30 18 167-201 24-40-111Z" />
          </g>
          <g className="map-roads map-roads-casing">
            <path d="M-20 311C160 262 268 231 422 260s257 82 558 10" />
            <path d="M302-20c17 151 10 250 58 348s104 170 152 312" />
            <path d="M650-20c-10 131-35 218-5 330s92 168 88 330" />
            <path d="M-20 493c189-37 302-38 450 11s280 52 550-8" />
            <path d="M96-20c14 91 52 161 44 252s-67 202-68 408" />
          </g>
          <g className="map-roads map-roads-fill">
            <path d="M-20 311C160 262 268 231 422 260s257 82 558 10" />
            <path d="M302-20c17 151 10 250 58 348s104 170 152 312" />
            <path d="M650-20c-10 131-35 218-5 330s92 168 88 330" />
            <path d="M-20 493c189-37 302-38 450 11s280 52 550-8" />
            <path d="M96-20c14 91 52 161 44 252s-67 202-68 408" />
          </g>
          <path
            className="map-route-glow"
            d="M45 302c165-45 255-68 382-40s201 56 341 45c91-7 142-24 218-47"
            filter="url(#route-glow)"
          />
          <path
            className="map-route"
            d="M45 302c165-45 255-68 382-40s201 56 341 45c91-7 142-24 218-47"
          />
          <g className="map-lane-lines">
            <path d="M323-20c12 151 7 246 51 339s104 169 151 301" />
            <path d="M639-20c-9 130-31 217 0 332s88 164 83 328" />
          </g>
          <g className="map-features">
            {["LN-1842", "LN-1843", "LN-1901", "LN-1912"].map((feature, index) => {
              const points = [
                [505, 276],
                [646, 303],
                [349, 249],
                [791, 304],
              ] as const;
              const point = points[index];
              if (point === undefined) return null;
              return (
                <g
                  key={feature}
                  className="map-feature"
                  data-selected={String(feature === selectedFeature)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select lane ${feature}`}
                  onClick={() => {
                    setSelectedFeature(feature);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedFeature(feature);
                    }
                  }}
                >
                  <circle cx={point[0]} cy={point[1]} r="8" />
                  <circle cx={point[0]} cy={point[1]} r="3" />
                  {showLabels ? (
                    <text x={point[0] + 12} y={point[1] - 10}>
                      {feature}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
          {showLabels ? (
            <g className="map-labels">
              <text x="157" y="345">
                North Buona Vista Rd
              </text>
              <text x="327" y="105" transform="rotate(82 327 105)">
                Portsdown Rd
              </text>
              <text x="676" y="150" transform="rotate(94 676 150)">
                Ayer Rajah Ave
              </text>
              <text x="142" y="466">
                one-north
              </text>
              <text x="744" y="460">
                Fusionopolis
              </text>
            </g>
          ) : null}
        </svg>
        <div className="demo-map-compass" aria-hidden="true">
          <span>N</span>
          <i />
        </div>
        <div className="demo-map-card">
          <span className="demo-map-card-kicker">Selected lane</span>
          <strong>{selectedFeature}</strong>
          <span>Primary · 50 km/h · 98.2%</span>
        </div>
      </div>
    </PanelFrame>
  );
}

function RouteExplorerPanel() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(["singapore", "one-north"]),
  );
  const [selected, setSelected] = useState("RA-042");
  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <PanelFrame
      toolbar={
        <label className="demo-search">
          <span className="pf-visually-hidden">Filter routes</span>
          <input type="search" placeholder="Filter routes…" />
        </label>
      }
      status={
        <>
          <span>3 routes</span>
          <span>Last sync 14:32</span>
        </>
      }
    >
      <nav className="demo-tree" aria-label="Route assessment workspace">
        <button
          type="button"
          className="demo-tree-row demo-tree-folder"
          aria-expanded={expanded.has("singapore")}
          onClick={() => {
            toggle("singapore");
          }}
        >
          <span aria-hidden="true">⌄</span>
          <strong>Singapore</strong>
          <small>3</small>
        </button>
        {expanded.has("singapore") ? (
          <div className="demo-tree-branch">
            <button
              type="button"
              className="demo-tree-row demo-tree-folder"
              aria-expanded={expanded.has("one-north")}
              onClick={() => {
                toggle("one-north");
              }}
            >
              <span aria-hidden="true">⌄</span>
              <strong>One-North</strong>
              <small>2</small>
            </button>
            {expanded.has("one-north") ? (
              <div className="demo-tree-branch">
                {["RA-042", "RA-047"].map((route) => (
                  <button
                    key={route}
                    type="button"
                    className="demo-tree-row"
                    aria-current={selected === route ? "true" : undefined}
                    onClick={() => {
                      setSelected(route);
                    }}
                  >
                    <span className="demo-route-dot" aria-hidden="true" />
                    <span>
                      <strong>{route}</strong>
                      <small>North Buona Vista</small>
                    </span>
                    <span className="demo-state-pill">Ready</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className="demo-tree-row demo-tree-folder" aria-expanded="false">
              <span aria-hidden="true">›</span>
              <strong>Jurong East</strong>
              <small>1</small>
            </button>
          </div>
        ) : null}
      </nav>
    </PanelFrame>
  );
}

function LayersPanel() {
  const [layers, setLayers] = useState({
    centerlines: true,
    boundaries: true,
    signs: true,
    pointCloud: false,
    satellite: false,
  });
  const labels: Readonly<Record<keyof typeof layers, string>> = {
    centerlines: "Lane centerlines",
    boundaries: "Road boundaries",
    signs: "Traffic signs",
    pointCloud: "Point cloud",
    satellite: "Satellite imagery",
  };

  return (
    <PanelFrame status={<span>{Object.values(layers).filter(Boolean).length} visible layers</span>}>
      <div className="demo-layer-list">
        {(Object.keys(layers) as (keyof typeof layers)[]).map((key, index) => (
          <label key={key} className="demo-layer-row">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={(event) => {
                setLayers((current) => ({ ...current, [key]: event.target.checked }));
              }}
            />
            <span className={`demo-layer-swatch swatch-${index}`} aria-hidden="true" />
            <span>{labels[key]}</span>
            <small>{index < 3 ? `${614 - index * 121}` : "—"}</small>
          </label>
        ))}
      </div>
    </PanelFrame>
  );
}

function InspectorPanel() {
  const formId = useId();
  const [status, setStatus] = useState("review");
  return (
    <PanelFrame
      toolbar={
        <>
          <span className="demo-kicker">Lane feature</span>
          <span className="demo-toolbar-spacer" />
          <span className="demo-state-pill">Modified</span>
        </>
      }
      status={
        <>
          <span>Local draft</span>
          <button type="submit" form={formId}>
            Apply changes
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="demo-inspector-form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="demo-inspector-heading">
          <span className="demo-feature-icon" aria-hidden="true">
            <Glyph name="route" />
          </span>
          <div>
            <strong>LN-1842</strong>
            <small>lane_centerline</small>
          </div>
        </div>
        <fieldset>
          <legend>Properties</legend>
          <label>
            Road class
            <select defaultValue="primary">
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="residential">Residential</option>
            </select>
          </label>
          <label>
            Speed limit
            <div className="demo-field-with-unit">
              <input type="number" defaultValue="50" min="0" max="130" />
              <span>km/h</span>
            </div>
          </label>
          <label>
            Direction
            <select defaultValue="forward">
              <option value="forward">Forward</option>
              <option value="backward">Backward</option>
              <option value="both">Bidirectional</option>
            </select>
          </label>
          <label>
            Confidence
            <input type="range" defaultValue="98" min="0" max="100" />
            <output>98%</output>
          </label>
        </fieldset>
        <fieldset>
          <legend>Review</legend>
          <div className="demo-radio-cards">
            {(["review", "approved", "blocked"] as const).map((value) => (
              <label key={value} data-checked={String(status === value)}>
                <input
                  type="radio"
                  name="review-status"
                  value={value}
                  checked={status === value}
                  onChange={() => {
                    setStatus(value);
                  }}
                />
                {value[0]?.toUpperCase()}
                {value.slice(1)}
              </label>
            ))}
          </div>
          <label>
            Comment
            <textarea rows={3} defaultValue="Verify divider continuity near junction." />
          </label>
        </fieldset>
      </form>
    </PanelFrame>
  );
}

const validationItems = [
  { level: "error", title: "Boundary gap", detail: "0.42 m gap at node 8192", count: 2 },
  {
    level: "warning",
    title: "Heading discontinuity",
    detail: "12.8° delta exceeds threshold",
    count: 5,
  },
  {
    level: "warning",
    title: "Missing predecessor",
    detail: "Lane LN-1904 has no incoming edge",
    count: 1,
  },
  { level: "passed", title: "Topology connectivity", detail: "1,248 checks passed", count: 0 },
] as const;

function ValidationPanel() {
  const [running, setRunning] = useState(false);
  return (
    <PanelFrame
      toolbar={
        <>
          <span className="demo-kicker">Route RA-042</span>
          <span className="demo-toolbar-spacer" />
          <button
            type="button"
            onClick={() => {
              setRunning(true);
              window.setTimeout(() => {
                setRunning(false);
              }, 900);
            }}
          >
            {running ? "Running…" : "Run validation"}
          </button>
        </>
      }
      status={
        <>
          <span className="demo-status-error">2 errors</span>
          <span className="demo-status-warning">6 warnings</span>
          <span>Updated just now</span>
        </>
      }
    >
      <div className="demo-validation-list" aria-busy={running}>
        {validationItems.map((item) => (
          <button
            key={item.title}
            type="button"
            className="demo-validation-row"
            data-level={item.level}
          >
            <span className="demo-validation-mark" aria-hidden="true">
              {item.level === "passed" ? "✓" : item.level === "error" ? "!" : "△"}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            {item.count === 0 ? null : <span className="demo-count-badge">{item.count}</span>}
          </button>
        ))}
      </div>
    </PanelFrame>
  );
}

const problems = [
  ["Error", "LN-1842", "Boundary gap exceeds 0.30 m", "One-North"],
  ["Error", "LN-1901", "Self-intersection in centerline", "One-North"],
  ["Warning", "LN-1843", "Heading delta 12.8°", "Portsdown"],
  ["Warning", "SG-098", "Sign association is ambiguous", "Portsdown"],
] as const;

function ProblemsPanel() {
  return (
    <PanelFrame
      status={
        <>
          <span>8 issues</span>
          <span>4 shown</span>
        </>
      }
    >
      <div className="demo-table-scroll">
        <table className="demo-problems-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Feature</th>
              <th>Message</th>
              <th>Region</th>
            </tr>
          </thead>
          <tbody>
            {problems.map((problem) => (
              <tr key={`${problem[0]}-${problem[1]}`} tabIndex={0}>
                <td>
                  <span className={`demo-severity severity-${problem[0].toLowerCase()}`}>
                    <i aria-hidden="true" />
                    {problem[0]}
                  </span>
                </td>
                <td>
                  <code>{problem[1]}</code>
                </td>
                <td>{problem[2]}</td>
                <td>{problem[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelFrame>
  );
}

function NotesPanel({ lifecycle }: WorkspacePanelRenderProps) {
  const [value, setValue] = useState(
    "Review the divider continuity near the Portsdown junction.\n\nCompare the 2026-08-10 capture before approving RA-042.",
  );
  const mountToken = useId().replaceAll(":", "");
  return (
    <PanelFrame
      toolbar={
        <>
          <span className="demo-kicker">Review notes</span>
          <span className="demo-toolbar-spacer" />
          <span>{value.length} characters</span>
        </>
      }
      status={
        <>
          <span>Saved locally</span>
          <span className="demo-lifecycle-badge" data-state={lifecycle}>
            {lifecycle === "suspended" ? "Editor suspended" : `Editor ${lifecycle}`}
          </span>
          <span className="demo-mount-proof">Host {mountToken}</span>
        </>
      }
    >
      <label className="demo-notes-label">
        <span className="pf-visually-hidden">Workspace review notes</span>
        <textarea
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          spellCheck="true"
        />
      </label>
    </PanelFrame>
  );
}

function TimelinePanel() {
  const events = [
    ["14:32", "Validation completed", "8 issues across 1,248 checks"],
    ["14:27", "LN-1842 edited", "Speed limit changed by Natan"],
    ["14:18", "Route loaded", "RA-042 · One-North"],
    ["13:54", "Snapshot restored", "Autosave checkpoint #1841"],
  ] as const;
  return (
    <PanelFrame status={<span>Workspace activity · today</span>}>
      <ol className="demo-timeline">
        {events.map((event, index) => (
          <li key={event[0]}>
            <time>{event[0]}</time>
            <span
              className="demo-timeline-dot"
              data-current={String(index === 0)}
              aria-hidden="true"
            />
            <span>
              <strong>{event[1]}</strong>
              <small>{event[2]}</small>
            </span>
          </li>
        ))}
      </ol>
    </PanelFrame>
  );
}

export const demoPanelRegistry: WorkspacePanelRegistry = {
  "map.route-explorer": { render: RouteExplorerPanel, icon: <Glyph name="route" /> },
  "map.layers": { render: LayersPanel, icon: <Glyph name="layers" /> },
  "map.canvas": { render: MapCanvasPanel, icon: <Glyph name="map" /> },
  "map.notes": { render: NotesPanel, icon: <Glyph name="notes" /> },
  "map.inspector": { render: InspectorPanel, icon: <Glyph name="inspect" /> },
  "map.validation": { render: ValidationPanel, icon: <Glyph name="validate" /> },
  "map.problems": { render: ProblemsPanel, icon: <Glyph name="problems" /> },
  "map.timeline": { render: TimelinePanel, icon: <Glyph name="timeline" /> },
};
