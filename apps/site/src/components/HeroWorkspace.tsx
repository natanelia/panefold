import { Check, ChevronDown, Command, Layers3, Search } from "lucide-react";
import { useEffect, useState } from "react";

const scenes = [
  {
    center: "workspace.ts",
    right: "Outline",
    moved: false,
    columns: "22% 1fr 25%",
    receipt: "select-panel",
    revision: "r41",
  },
  {
    center: "workspace.ts",
    right: "Outline",
    moved: false,
    columns: "22% 1fr 32%",
    receipt: "resize-split",
    revision: "r42",
  },
  {
    center: "App.tsx",
    right: "workspace.ts",
    moved: true,
    columns: "22% 1fr 32%",
    receipt: "move-panel",
    revision: "r43",
  },
  {
    center: "workspace.ts",
    right: "Outline",
    moved: false,
    columns: "22% 1fr 32%",
    receipt: "undo-workspace-operation",
    revision: "r44",
  },
] as const;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function HeroWorkspace() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const scene = scenes[sceneIndex] ?? scenes[0];

  useEffect(() => {
    if (reducedMotion || paused) return;
    const timer = window.setInterval(() => {
      setSceneIndex((value) => (value + 1) % scenes.length);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion]);

  return (
    <div
      className="hero-workspace group relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[18px] border border-white/[0.13] bg-[#0b1018] shadow-[0_40px_120px_rgba(0,0,0,0.55),0_0_80px_rgba(56,189,248,0.06)]"
      data-scene={sceneIndex}
      data-paused={paused || reducedMotion}
    >
      <div aria-hidden="true">
        <div className="flex h-11 items-center border-b border-white/[0.08] bg-[#0d131d] px-3.5">
          <div className="flex gap-1.5">
            <i className="size-2.5 rounded-full bg-white/15" />
            <i className="size-2.5 rounded-full bg-white/10" />
            <i className="size-2.5 rounded-full bg-white/10" />
          </div>
          <div className="mx-auto flex h-6 items-center gap-2 rounded-md border border-white/[0.07] bg-black/20 px-3 text-[9px] font-medium tracking-wide text-slate-500">
            <span className="size-1.5 rounded-full bg-teal-300 shadow-[0_0_8px_#5eead4]" />
            panefold-code / src / App.tsx
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
            <Command className="size-3" /> K
          </div>
        </div>

        <div className="flex h-9 items-center border-b border-white/[0.07] bg-[#0a0f17] px-3">
          <div className="mr-5 flex items-center gap-2">
            <span className="relative grid size-5 grid-cols-2 gap-px rounded border border-cyan-300/25 p-[3px]">
              <i className="row-span-2 rounded-[1px] bg-cyan-300/30" />
              <i className="rounded-[1px] bg-sky-300/20" />
              <i className="rounded-[1px] bg-teal-300/20" />
            </span>
            <strong className="text-[10px] font-semibold text-slate-200">Panefold</strong>
          </div>
          <span className="h-4 w-px bg-white/10" />
          <div className="ml-4 flex items-center gap-2 text-[9px] text-slate-400">
            <span className="size-1.5 rounded-full bg-teal-300" />
            panefold-demo · TypeScript workspace
          </div>
          <div className="ml-auto flex gap-1.5">
            {["↶", "↷", "◫"].map((item) => (
              <span
                key={item}
                className="grid size-5 place-items-center rounded border border-white/[0.07] text-[9px] text-slate-500"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div
          className="hero-workspace-grid grid h-[430px] min-h-0 transition-[grid-template-columns] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] max-md:h-[310px]"
          style={{ gridTemplateColumns: scene.columns }}
        >
          <section className="min-w-0 border-r border-white/[0.08] bg-[#0b111a]">
            <PanelTabs labels={["Explorer"]} selected="Explorer" />
            <div className="p-2.5">
              <div className="mb-2 flex items-center gap-1.5 rounded border border-white/[0.08] bg-black/15 px-2 py-1.5 text-[8px] text-slate-600">
                <Search className="size-2.5" /> Filter files
              </div>
              <TreeRow depth={0} label="src" open />
              <TreeRow depth={1} label="App.tsx" active />
              <TreeRow depth={1} label="workspace.ts" />
              <TreeRow depth={0} label="package.json" />
              <TreeRow depth={0} label="tsconfig.json" />
            </div>
          </section>

          <section className="min-w-0 border-r border-white/[0.08] bg-[#0d141e]">
            <PanelTabs
              labels={scene.moved ? ["App.tsx"] : ["App.tsx", "workspace.ts"]}
              selected={scene.center}
            />
            {scene.center === "workspace.ts" ? <NotesPanel /> : <CodePreview />}
          </section>

          <section className="min-w-0 bg-[#0b111a]">
            <PanelTabs
              labels={
                scene.moved
                  ? ["Outline", "Source Control", "workspace.ts"]
                  : ["Outline", "Source Control"]
              }
              selected={scene.right}
            />
            {scene.right === "workspace.ts" ? (
              <NotesPanel compact />
            ) : (
              <div className="space-y-3 p-3 text-[8px]">
                <MetaBlock label="Symbol" value="WorkspaceSurface" accent />
                <div className="grid grid-cols-2 gap-2">
                  <MetaBlock label="Line" value="10" />
                  <MetaBlock label="Type" value="Component" />
                </div>
                <div className="border-t border-white/[0.08] pt-3">
                  <p className="mb-2 font-semibold uppercase tracking-[0.15em] text-slate-400">
                    Symbols
                  </p>
                  {["commands", "projector", "responsive"].map((label, index) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 border-b border-white/[0.05] py-2 text-slate-400"
                    >
                      <span
                        className={`grid size-3 place-items-center rounded-sm border ${index < 2 ? "border-teal-300/40 bg-teal-300/10 text-teal-200" : "border-white/10"}`}
                      >
                        {index < 2 ? <Check className="size-2" /> : null}
                      </span>
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="flex h-9 items-center border-t border-white/[0.08] bg-[#080d14] px-3 text-[8px] text-slate-600">
          <span className="flex items-center gap-1.5 text-teal-300/80">
            <Check className="size-2.5" /> Kernel valid
          </span>
          <span className="mx-3 h-3 w-px bg-white/[0.08]" />
          <span>4 groups · 8 panels</span>
          <div className="ml-auto flex min-w-[150px] items-center justify-end gap-2 font-mono text-slate-500">
            <span key={scene.receipt} className="hero-receipt text-cyan-300">
              {scene.receipt}
            </span>
            <span className="rounded bg-teal-300/10 px-1.5 py-0.5 text-teal-300">committed</span>
            <span>{scene.revision}</span>
          </div>
        </div>
      </div>
      {reducedMotion ? null : (
        <button
          type="button"
          className="absolute bottom-11 right-3 z-10 rounded-md border border-white/10 bg-[#080d14]/90 px-2 py-1 font-mono text-[8px] text-slate-400 opacity-0 transition hover:text-white group-hover:opacity-100 focus:opacity-100"
          aria-label={
            paused ? "Play animated workspace preview" : "Pause animated workspace preview"
          }
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? "Play" : "Pause"}
        </button>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-[18px] ring-1 ring-inset ring-white/[0.04]" />
    </div>
  );
}

function NotesPanel({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className="h-[calc(100%-32px)] overflow-hidden bg-[#0c121b] p-4 text-[8px] text-slate-400">
      <p className="font-mono text-[7px] uppercase tracking-[0.15em] text-cyan-300/70">
        src / workspace.ts
      </p>
      <h3 className="mt-3 text-[11px] font-semibold text-slate-200">Workbench configuration</h3>
      <div className="mt-4 space-y-3">
        {[
          "Enable responsive projection",
          "Persist the canonical layout",
          "Preserve stable editor hosts",
        ].map((note, index) => (
          <div key={note} className="flex gap-2 border-b border-white/[0.06] pb-3">
            <span
              className={`mt-0.5 grid size-3 shrink-0 place-items-center rounded-sm border ${index === 0 ? "border-teal-300/40 bg-teal-300/10 text-teal-200" : "border-white/15"}`}
            >
              {index === 0 ? <Check className="size-2" /> : null}
            </span>
            <span className="leading-4">{note}</span>
          </div>
        ))}
      </div>
      {compact ? null : (
        <div className="mt-4 rounded-md border border-cyan-300/10 bg-cyan-300/[0.025] p-3 leading-4 text-slate-400">
          The editor, side bars, and terminal share one deterministic workspace snapshot.
        </div>
      )}
    </div>
  );
}

function PanelTabs({
  labels,
  selected,
}: {
  readonly labels: readonly string[];
  readonly selected: string;
}) {
  return (
    <div className="flex h-8 items-end border-b border-white/[0.08] bg-[#0a0f17] px-1">
      {labels.map((label) => (
        <div
          key={label}
          className={`relative flex h-7 items-center gap-1.5 px-2 text-[8px] ${selected === label ? "text-slate-200" : "text-slate-600"}`}
        >
          {label === "Explorer" ? <Layers3 className="size-2.5" /> : null}
          {label}
          {selected === label ? (
            <i className="absolute inset-x-1 bottom-0 h-px bg-cyan-300 shadow-[0_0_7px_#67e8f9]" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TreeRow({
  depth,
  label,
  open,
  active,
}: {
  readonly depth: number;
  readonly label: string;
  readonly open?: boolean;
  readonly active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded px-1.5 py-1.5 text-[8px] ${active ? "bg-cyan-300/[0.08] text-cyan-100" : "text-slate-500"}`}
      style={{ paddingInlineStart: 6 + depth * 11 }}
    >
      <ChevronDown className={`size-2.5 ${open ? "" : "-rotate-90"}`} />
      <span
        className={`size-1.5 rounded-sm ${active ? "bg-cyan-300" : "border border-white/15"}`}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}

function MetaBlock({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
      <p className="mb-1 text-[7px] uppercase tracking-[0.13em] text-slate-600">{label}</p>
      <p className={accent ? "font-medium text-cyan-200" : "text-slate-300"}>{value}</p>
    </div>
  );
}

function CodePreview() {
  const lines = [
    <>
      <span className="text-fuchsia-300">import</span> {"{ WorkspaceSurface }"}{" "}
      <span className="text-fuchsia-300">from</span>{" "}
      <span className="text-orange-200">&quot;@panefold/react&quot;</span>;
    </>,
    null,
    <>
      <span className="text-fuchsia-300">export function</span>{" "}
      <span className="text-amber-200">App</span>() {"{"}
    </>,
    <>
      {" "}
      <span className="text-fuchsia-300">return</span> (
    </>,
    <>
      {" "}
      <span className="text-teal-200">&lt;WorkspaceSurface</span>
    </>,
    <>
      {" "}
      <span className="text-sky-200">workspaceLabel</span>=
      <span className="text-orange-200">&quot;Panefold Code&quot;</span>
    </>,
    <>
      {" "}
      <span className="text-sky-200">responsive</span>=
      <span className="text-orange-200">&quot;auto&quot;</span>
    </>,
    <>
      {" "}
      <span className="text-teal-200">/&gt;</span>
    </>,
    <> );</>,
    <> {"}"}</>,
  ];
  return (
    <div className="relative h-[calc(100%-32px)] overflow-hidden bg-[#0d1117] px-2 py-4 font-mono text-[8px] leading-6 text-slate-300">
      <div className="grid grid-cols-[24px_minmax(0,1fr)]">
        <div className="grid text-right text-slate-700">
          {lines.map((_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <div className="grid min-w-max pl-3">
          {lines.map((line, index) => (
            <code key={index}>{line ?? " "}</code>
          ))}
        </div>
      </div>
      <div className="absolute right-2 top-4 grid w-12 gap-1 opacity-30" aria-hidden="true">
        {[72, 48, 84, 66, 55, 80, 62].map((width, index) => (
          <i
            key={`${width}-${index}`}
            className="h-px bg-cyan-200"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-6 items-center border-t border-white/[0.06] px-3 text-[7px] text-slate-600">
        Ln 6, Col 24 <span className="ml-auto text-teal-300/70">TypeScript React</span>
      </div>
    </div>
  );
}
