import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorkspacePanelRegistry, WorkspacePanelRenderProps } from "@panefold/react";

const LazyHeavyContentFixturePanel = lazy(async () => {
  const module = await import("./heavy-content-fixture");
  return { default: module.HeavyContentFixturePanel };
});

type GlyphName =
  "code" | "explorer" | "file" | "outline" | "problems" | "search" | "source" | "terminal";

export function Glyph({ name }: { readonly name: GlyphName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.55,
  };
  const paths: Record<GlyphName, ReactNode> = {
    code: (
      <>
        <path d="m6 4-4 4 4 4M10 4l4 4-4 4" {...common} />
        <path d="m9 2-2 12" {...common} />
      </>
    ),
    explorer: (
      <>
        <path d="M3 3h6l2 2h3v9H3z" {...common} />
        <path d="M3 6h11" {...common} />
      </>
    ),
    file: (
      <>
        <path d="M4 1.8h5l3 3v9.4H4z" {...common} />
        <path d="M9 1.8v3h3" {...common} />
      </>
    ),
    outline: (
      <>
        <circle cx="3" cy="3.5" r="1" fill="currentColor" />
        <circle cx="3" cy="8" r="1" fill="currentColor" />
        <circle cx="3" cy="12.5" r="1" fill="currentColor" />
        <path d="M6 3.5h7M6 8h5M6 12.5h6" {...common} />
      </>
    ),
    problems: (
      <>
        <path d="M8 2 14 13H2z" {...common} />
        <path d="M8 5.5v3.8M8 11.3v.2" {...common} />
      </>
    ),
    search: (
      <>
        <circle cx="7" cy="7" r="4" {...common} />
        <path d="m10 10 3.5 3.5" {...common} />
      </>
    ),
    source: (
      <>
        <circle cx="4" cy="3" r="1.5" {...common} />
        <circle cx="12" cy="5" r="1.5" {...common} />
        <circle cx="4" cy="13" r="1.5" {...common} />
        <path d="M4 4.5v7M5.5 12c5 0 6.5-2.7 6.5-5.5" {...common} />
      </>
    ),
    terminal: (
      <>
        <path d="m3 5 3 3-3 3M8 12h5" {...common} />
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
  className = "",
}: {
  readonly children: ReactNode;
  readonly toolbar?: ReactNode;
  readonly status?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={`demo-panel-frame ${className}`.trim()}>
      {toolbar === undefined ? null : <div className="demo-panel-toolbar">{toolbar}</div>}
      <div className="demo-panel-body">{children}</div>
      {status === undefined ? null : <div className="demo-panel-status">{status}</div>}
    </div>
  );
}

function HeavyContentFixtureBoundary(props: WorkspacePanelRenderProps) {
  return (
    <Suspense
      fallback={
        <div
          className="demo-panel-loading"
          aria-busy="true"
          aria-label="Loading editor lifecycle fixture"
        >
          <span className="demo-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <strong>Loading fixture lab</strong>
            <span>Preparing browser lifecycle probes…</span>
          </div>
        </div>
      }
    >
      <LazyHeavyContentFixturePanel {...props} />
    </Suspense>
  );
}

function useLifecycleWorkProbe(lifecycle: WorkspacePanelRenderProps["lifecycle"]) {
  const workProbeRef = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const output = workProbeRef.current;
    const ownerWindow = output?.ownerDocument.defaultView;
    if (output === null || ownerWindow === undefined || ownerWindow === null) return;
    output.dataset.lifecycle = lifecycle;
    if (lifecycle === "suspended") return;
    let frame = 0;
    let frameWindow = ownerWindow;
    const tick = () => {
      const currentWindow = output.ownerDocument.defaultView;
      if (currentWindow === null) return;
      frameWindow = currentWindow;
      frame = currentWindow.requestAnimationFrame(() => {
        const workUnits = Number(output.dataset.workUnits ?? "0") + 1;
        output.dataset.workUnits = String(workUnits);
        output.value = String(workUnits);
        tick();
      });
    };
    tick();
    return () => {
      frameWindow.cancelAnimationFrame(frame);
    };
  }, [lifecycle]);
  return workProbeRef;
}

interface ExplorerFile {
  readonly name: string;
  readonly path: string;
  readonly type: "json" | "markdown" | "typescript";
  readonly dirty?: boolean;
}

const explorerFiles: readonly ExplorerFile[] = [
  { name: "App.tsx", path: "src/App.tsx", type: "typescript", dirty: true },
  { name: "workspace.ts", path: "src/workspace.ts", type: "typescript", dirty: true },
  { name: "README.md", path: "README.md", type: "markdown" },
  { name: "package.json", path: "package.json", type: "json" },
  { name: "tsconfig.json", path: "tsconfig.json", type: "json" },
];

function FileExplorerPanel() {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("src/App.tsx");
  const visibleFiles = explorerFiles.filter((file) =>
    file.path.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <PanelFrame
      className="demo-sidebar-panel"
      toolbar={
        <>
          <strong className="demo-pane-heading">EXPLORER</strong>
          <span className="demo-toolbar-spacer" />
          <button
            type="button"
            className="demo-icon-button"
            aria-label={expanded ? "Collapse folders" : "Expand folders"}
            title={expanded ? "Collapse folders" : "Expand folders"}
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            {expanded ? "⊟" : "⊞"}
          </button>
        </>
      }
      status={
        <>
          <span>PANEFOLD-DEMO</span>
          <span>{visibleFiles.length} files</span>
        </>
      }
    >
      <label className="demo-sidebar-filter">
        <span className="demo-visually-hidden">Filter files</span>
        <Glyph name="search" />
        <input
          type="search"
          value={filter}
          placeholder="Filter files"
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />
      </label>
      <nav className="demo-tree" aria-label="File Explorer">
        <button
          className="demo-tree-row demo-tree-folder"
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <span className="demo-tree-chevron" aria-hidden="true">
            {expanded ? "⌄" : "›"}
          </span>
          <strong>PANEFOLD-DEMO</strong>
        </button>
        {expanded ? (
          <div className="demo-tree-branch">
            <div className="demo-tree-section" aria-label="src folder">
              <span className="demo-tree-chevron" aria-hidden="true">
                ⌄
              </span>
              <strong>src</strong>
            </div>
            {visibleFiles.map((file) => (
              <button
                className="demo-tree-row demo-file-row"
                type="button"
                key={file.path}
                aria-current={selected === file.path ? "page" : undefined}
                title={file.path}
                onClick={() => {
                  setSelected(file.path);
                }}
              >
                <span className={`demo-file-icon file-${file.type}`} aria-hidden="true">
                  {file.type === "typescript" ? "TS" : file.type === "markdown" ? "M↓" : "{}"}
                </span>
                <span>{file.name}</span>
                {file.dirty ? <i className="demo-dirty-dot" aria-label="Modified" /> : null}
              </button>
            ))}
            {visibleFiles.length === 0 ? (
              <p className="demo-empty-state">No files match “{filter}”.</p>
            ) : null}
          </div>
        ) : null}
      </nav>
    </PanelFrame>
  );
}

const appSource = [
  "import { useMemo } from 'react';",
  "import { WorkspaceSurface } from '@panefold/react';",
  "",
  "import { panels, projectWorkspace } from './workspace';",
  "",
  "export function App() {",
  "  const commands = useMemo(() => createCommands(), []);",
  "",
  "  return (",
  "    <WorkspaceSurface",
  '      workspaceLabel="Panefold Code"',
  "      panels={panels}",
  "      commands={commands}",
  "      projector={projectWorkspace}",
  '      responsive="auto"',
  "    />",
  "  );",
  "}",
] as const;

const syntaxPattern =
  /(\/\/.*|'.*?'|".*?"|\b(?:const|export|from|function|import|return|true|false|type|readonly)\b|WorkspaceSurface|useMemo|createCommands|projectWorkspace)/g;

function highlightSourceLine(line: string) {
  return line.split(syntaxPattern).map((part, index) => {
    let token = "";
    if (part.startsWith("//")) token = "comment";
    else if (part.startsWith("'") || part.startsWith('"')) token = "string";
    else if (/^(const|export|from|function|import|return|true|false|type|readonly)$/.test(part))
      token = "keyword";
    else if (/^[A-Z]/.test(part)) token = "type";
    else if (/^(useMemo|createCommands|projectWorkspace)$/.test(part)) token = "function";
    return token === "" ? (
      part
    ) : (
      <span className={`token-${token}`} key={index}>
        {part}
      </span>
    );
  });
}

function AppEditorPanel({ panel, lifecycle }: WorkspacePanelRenderProps) {
  const [activeLine, setActiveLine] = useState(10);
  const [breakpoints, setBreakpoints] = useState<ReadonlySet<number>>(new Set([6]));
  const mountToken = useId().replaceAll(":", "");
  const workProbeRef = useLifecycleWorkProbe(lifecycle);

  const toggleBreakpoint = (line: number) => {
    setBreakpoints((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
    setActiveLine(line);
  };

  return (
    <PanelFrame
      className="demo-editor-panel"
      toolbar={
        <nav className="demo-breadcrumbs" aria-label="Editor breadcrumbs">
          <span>panefold-demo</span>
          <i>›</i>
          <span>src</span>
          <i>›</i>
          <strong>App.tsx</strong>
          <i>›</i>
          <span>App</span>
        </nav>
      }
      status={
        <>
          <span>Ln {activeLine}, Col 1</span>
          <span>Spaces: 2</span>
          <span>UTF-8</span>
          <span className="demo-toolbar-spacer" />
          <span className="demo-lifecycle-badge" data-state={lifecycle}>
            {lifecycle === "suspended" ? "Language service paused" : "TypeScript React"}
          </span>
          <output
            ref={workProbeRef}
            className="demo-visually-hidden"
            aria-label="Editor work units"
            data-work-units="0"
          >
            0
          </output>
          <span className="demo-mount-proof" title="Stable editor host">
            Host {mountToken}
          </span>
        </>
      }
    >
      <div className="demo-code-editor" data-panel-id={panel.id}>
        <div className="demo-code-overview" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div
          className="demo-code-lines"
          role="region"
          aria-label="Read-only App.tsx source"
          tabIndex={0}
        >
          {appSource.map((line, index) => {
            const lineNumber = index + 1;
            const breakpoint = breakpoints.has(lineNumber);
            return (
              <div
                className="demo-code-line"
                data-active={String(activeLine === lineNumber)}
                key={lineNumber}
                onPointerDown={() => {
                  setActiveLine(lineNumber);
                }}
              >
                <button
                  type="button"
                  className="demo-code-gutter"
                  data-breakpoint={String(breakpoint)}
                  aria-label={`${breakpoint ? "Remove" : "Add"} breakpoint on line ${lineNumber}`}
                  onClick={() => {
                    toggleBreakpoint(lineNumber);
                  }}
                >
                  <i aria-hidden="true" />
                  <span>{lineNumber}</span>
                </button>
                <code>{line === "" ? " " : highlightSourceLine(line)}</code>
              </div>
            );
          })}
        </div>
      </div>
    </PanelFrame>
  );
}

const initialWorkspaceSource = `import type { WorkspaceProjection } from '@panefold/react';

export const workspace = {
  name: 'panefold-demo',
  autosave: true,
  layout: ['sidebar', 'editor', 'panel'],
} as const;

export function projectWorkspace(): WorkspaceProjection {
  return createProjection(workspace);
}`;

function WorkspaceEditorPanel({ lifecycle }: WorkspacePanelRenderProps) {
  const [value, setValue] = useState(initialWorkspaceSource);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const mountToken = useId().replaceAll(":", "");
  const workProbeRef = useLifecycleWorkProbe(lifecycle);
  const lines = value.split("\n");

  const updateCursor = (element: HTMLTextAreaElement, source: string) => {
    const beforeCursor = source.slice(0, element.selectionStart);
    const line = beforeCursor.split("\n").length;
    const lastBreak = beforeCursor.lastIndexOf("\n");
    setCursor({ line, column: beforeCursor.length - lastBreak });
  };

  return (
    <PanelFrame
      className="demo-editor-panel"
      toolbar={
        <nav className="demo-breadcrumbs" aria-label="Editor breadcrumbs">
          <span>panefold-demo</span>
          <i>›</i>
          <span>src</span>
          <i>›</i>
          <strong>workspace.ts</strong>
        </nav>
      }
      status={
        <>
          <span>
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span>{value.length} characters</span>
          <span className="demo-toolbar-spacer" />
          <span className="demo-lifecycle-badge" data-state={lifecycle}>
            {lifecycle === "suspended" ? "Editor suspended" : `Editor ${lifecycle}`}
          </span>
          <output
            ref={workProbeRef}
            className="demo-visually-hidden"
            aria-label="workspace.ts editor work units"
            data-work-units="0"
          >
            0
          </output>
          <span className="demo-mount-proof">Host {mountToken}</span>
        </>
      }
    >
      <div className="demo-text-editor">
        <div className="demo-text-line-numbers" aria-hidden="true">
          {lines.map((_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <textarea
          aria-label="workspace.ts editor"
          value={value}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            updateCursor(event.target, next);
          }}
          onSelect={(event) => {
            updateCursor(event.currentTarget, value);
          }}
        />
      </div>
    </PanelFrame>
  );
}

interface SearchResult {
  readonly file: string;
  readonly line: number;
  readonly preview: string;
}

const searchResults: readonly SearchResult[] = [
  { file: "src/App.tsx", line: 2, preview: "import { WorkspaceSurface } from '@panefold/react';" },
  { file: "src/App.tsx", line: 10, preview: "<WorkspaceSurface" },
  { file: "src/App.tsx", line: 11, preview: 'workspaceLabel="Panefold Code"' },
  { file: "src/workspace.ts", line: 3, preview: "export const workspace = {" },
];

function SearchPanel() {
  const [query, setQuery] = useState("WorkspaceSurface");
  const [matchCase, setMatchCase] = useState(false);
  const [selected, setSelected] = useState<string>();
  const matches = useMemo(() => {
    if (query.trim() === "") return [];
    const needle = matchCase ? query : query.toLowerCase();
    return searchResults.filter((result) => {
      const haystack = `${result.file} ${result.preview}`;
      return (matchCase ? haystack : haystack.toLowerCase()).includes(needle);
    });
  }, [matchCase, query]);

  return (
    <PanelFrame
      className="demo-sidebar-panel"
      toolbar={<strong className="demo-pane-heading">SEARCH</strong>}
      status={
        <span>
          {matches.length} results in {new Set(matches.map((item) => item.file)).size} files
        </span>
      }
    >
      <div className="demo-search-box">
        <label>
          <span className="demo-visually-hidden">Search workspace</span>
          <Glyph name="search" />
          <input
            type="search"
            value={query}
            placeholder="Search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          aria-label="Match case"
          aria-pressed={matchCase}
          title="Match case"
          onClick={() => {
            setMatchCase((value) => !value);
          }}
        >
          Aa
        </button>
      </div>
      <div className="demo-search-results" aria-live="polite">
        {matches.length === 0 ? <p>No results found.</p> : null}
        {matches.map((result) => {
          const key = `${result.file}:${result.line}`;
          return (
            <button
              type="button"
              key={key}
              aria-pressed={selected === key}
              onClick={() => {
                setSelected(key);
              }}
            >
              <span className="demo-file-icon file-typescript" aria-hidden="true">
                TS
              </span>
              <span>
                <strong>{result.file}</strong>
                <small>
                  <b>{result.line}</b> {result.preview}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </PanelFrame>
  );
}

const outlineItems = [
  { depth: 0, icon: "ƒ", label: "App" },
  { depth: 1, icon: "◇", label: "commands" },
  { depth: 1, icon: "◇", label: "WorkspaceSurface" },
  { depth: 2, icon: "▫", label: "workspaceLabel" },
  { depth: 2, icon: "▫", label: "panels" },
  { depth: 2, icon: "▫", label: "projector" },
  { depth: 2, icon: "▫", label: "responsive" },
] as const;

function OutlinePanel() {
  const [selected, setSelected] = useState("App");
  return (
    <PanelFrame
      className="demo-sidebar-panel"
      toolbar={
        <>
          <strong className="demo-pane-heading">OUTLINE</strong>
          <span className="demo-toolbar-spacer" />
          <span className="demo-pane-file">App.tsx</span>
        </>
      }
      status={<span>7 symbols</span>}
    >
      <nav className="demo-outline" aria-label="Document Outline">
        {outlineItems.map((item) => (
          <button
            type="button"
            key={item.label}
            aria-current={selected === item.label ? "location" : undefined}
            style={{ paddingInlineStart: `${8 + item.depth * 14}px` }}
            onClick={() => {
              setSelected(item.label);
            }}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </PanelFrame>
  );
}

const initialChanges = [
  { file: "App.tsx", path: "src", state: "M" },
  { file: "workspace.ts", path: "src", state: "M" },
] as const;

function SourceControlPanel() {
  const [message, setMessage] = useState("");
  const [changes, setChanges] =
    useState<readonly (typeof initialChanges)[number][]>(initialChanges);
  const [lastCommit, setLastCommit] = useState<string>();

  return (
    <PanelFrame
      className="demo-sidebar-panel"
      toolbar={
        <>
          <strong className="demo-pane-heading">SOURCE CONTROL</strong>
          <span className="demo-toolbar-spacer" />
          <button
            type="button"
            className="demo-icon-button"
            aria-label="Refresh source control"
            title="Refresh"
            onClick={() => {
              setChanges(initialChanges);
              setLastCommit(undefined);
            }}
          >
            ↻
          </button>
        </>
      }
      status={<span>{lastCommit ?? `${changes.length} working tree changes`}</span>}
    >
      <form
        className="demo-source"
        onSubmit={(event) => {
          event.preventDefault();
          if (message.trim() === "" || changes.length === 0) return;
          setLastCommit(`Committed “${message.trim()}” locally`);
          setChanges([]);
          setMessage("");
        }}
      >
        <label>
          <span className="demo-visually-hidden">Commit message</span>
          <textarea
            value={message}
            rows={2}
            placeholder="Message (⌘Enter to commit)"
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          className="demo-primary-button"
          disabled={message.trim() === "" || changes.length === 0}
        >
          Commit
        </button>
        <div className="demo-source-heading">
          <strong>CHANGES</strong>
          <span>{changes.length}</span>
        </div>
        {changes.map((change) => (
          <button className="demo-change" type="button" key={change.file}>
            <span className="demo-file-icon file-typescript" aria-hidden="true">
              TS
            </span>
            <span>
              <strong>{change.file}</strong>
              <small>{change.path}</small>
            </span>
            <i>{change.state}</i>
          </button>
        ))}
        {changes.length === 0 ? <p className="demo-empty-state">No pending changes.</p> : null}
      </form>
    </PanelFrame>
  );
}

interface TerminalEntry {
  readonly command: string;
  readonly output: readonly string[];
}

const initialTerminalEntries: readonly TerminalEntry[] = [
  {
    command: "pnpm test --run",
    output: [
      "✓ workspace runtime checks passed",
      "✓ 18 tests passed in 1.42s",
      "",
      "Test Files  4 passed (4)",
    ],
  },
];

function terminalOutput(command: string): readonly string[] {
  if (command === "git status")
    return ["On branch main", "Changes not staged for commit:", "  modified: src/App.tsx"];
  if (command === "pnpm test" || command === "pnpm test --run")
    return ["✓ 18 tests passed in 1.42s"];
  if (command === "clear") return [];
  return [`zsh: command not found: ${command.split(" ")[0] ?? command}`];
}

function TerminalPanel() {
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<readonly TerminalEntry[]>(initialTerminalEntries);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <PanelFrame
      className="demo-terminal-panel"
      toolbar={
        <>
          <strong className="demo-pane-heading">TERMINAL</strong>
          <span className="demo-terminal-session">zsh</span>
          <span className="demo-toolbar-spacer" />
          <button
            type="button"
            className="demo-icon-button"
            aria-label="Clear terminal"
            title="Clear"
            onClick={() => {
              setEntries([]);
              inputRef.current?.focus();
            }}
          >
            ⌫
          </button>
        </>
      }
      status={
        <>
          <span>zsh</span>
          <span>pid 4421</span>
        </>
      }
    >
      <div
        className="demo-terminal"
        onPointerDown={() => {
          inputRef.current?.focus();
        }}
      >
        <div className="demo-terminal-history" aria-live="polite">
          {entries.map((entry, index) => (
            <div key={`${entry.command}:${index}`}>
              <p>
                <span>➜</span> <b>panefold-demo</b> <i>git:(main)</i> {entry.command}
              </p>
              {entry.output.map((line, lineIndex) => (
                <p className="demo-terminal-output" key={`${line}:${lineIndex}`}>
                  {line === "" ? <br /> : line}
                </p>
              ))}
            </div>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const command = input.trim();
            if (command === "") return;
            if (command === "clear") setEntries([]);
            else
              setEntries((current) => [...current, { command, output: terminalOutput(command) }]);
            setInput("");
          }}
        >
          <span aria-hidden="true">➜</span>
          <b>panefold-demo</b>
          <i>git:(main)</i>
          <input
            ref={inputRef}
            aria-label="Terminal input"
            value={input}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
        </form>
      </div>
    </PanelFrame>
  );
}

const problemRows = [
  {
    level: "error",
    message: "Cannot find name 'createCommands'.",
    file: "App.tsx",
    line: 7,
    column: 34,
  },
  {
    level: "warning",
    message: "Import 'useMemo' can be simplified.",
    file: "App.tsx",
    line: 1,
    column: 10,
  },
  {
    level: "info",
    message: "Consider enabling noUncheckedIndexedAccess.",
    file: "tsconfig.json",
    line: 8,
    column: 5,
  },
] as const;

function ProblemsPanel() {
  const [selected, setSelected] = useState<string>();
  return (
    <PanelFrame
      className="demo-problems-panel"
      toolbar={
        <>
          <strong className="demo-pane-heading">PROBLEMS</strong>
          <span className="demo-problem-summary">
            <b>⊗ 1</b>
            <i>△ 1</i>
            <span>ⓘ 1</span>
          </span>
        </>
      }
      status={
        <>
          <span>3 problems in 2 files</span>
          <span>Workspace</span>
        </>
      }
    >
      <div className="demo-problem-list" aria-label="Problems">
        {problemRows.map((problem) => {
          const key = `${problem.file}:${problem.line}:${problem.column}`;
          return (
            <button
              type="button"
              key={key}
              aria-pressed={selected === key}
              onClick={() => {
                setSelected(key);
              }}
            >
              <span className={`demo-problem-icon problem-${problem.level}`} aria-hidden="true">
                {problem.level === "error" ? "⊗" : problem.level === "warning" ? "△" : "ⓘ"}
              </span>
              <span>
                <strong>{problem.message}</strong>
                <small>
                  {problem.file} [{problem.line}, {problem.column}]
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </PanelFrame>
  );
}

export const demoPanelRegistry: WorkspacePanelRegistry = {
  "map.route-explorer": { render: FileExplorerPanel, icon: <Glyph name="explorer" /> },
  "map.layers": { render: SearchPanel, icon: <Glyph name="search" /> },
  "map.canvas": { render: AppEditorPanel, icon: <Glyph name="code" /> },
  "map.notes": { render: WorkspaceEditorPanel, icon: <Glyph name="file" /> },
  "map.inspector": { render: OutlinePanel, icon: <Glyph name="outline" /> },
  "map.validation": { render: SourceControlPanel, icon: <Glyph name="source" /> },
  "map.problems": { render: TerminalPanel, icon: <Glyph name="terminal" /> },
  "map.timeline": { render: ProblemsPanel, icon: <Glyph name="problems" /> },
};

export const heavyContentDemoPanelRegistry: WorkspacePanelRegistry = {
  ...demoPanelRegistry,
  "map.canvas": { render: HeavyContentFixtureBoundary, icon: <Glyph name="code" /> },
};
