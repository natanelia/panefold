import { Check, Command, Layers3 } from "lucide-react";

import { Brand } from "../components/Brand";

export function SocialCardPage() {
  return (
    <main className="relative grid h-screen min-h-[630px] w-screen min-w-[1200px] grid-cols-[1fr_0.95fr] overflow-hidden bg-[#070a0f] p-16">
      <div className="hero-grid absolute inset-0 opacity-55" />
      <div className="absolute -right-40 -top-56 size-[740px] rounded-full bg-cyan-300/[0.09] blur-[130px]" />
      <section className="relative z-10 flex flex-col justify-between">
        <div className="text-white">
          <Brand />
        </div>
        <div className="pb-8">
          <p className="mb-5 font-mono text-[13px] uppercase tracking-[0.16em] text-cyan-200/70">
            Experimental deterministic workspace runtime
          </p>
          <h1 className="max-w-[640px] font-display text-[76px] font-medium leading-[0.95] tracking-[-0.06em] text-white">
            Workspace state you can reason about.
          </h1>
          <p className="mt-7 max-w-[570px] text-xl leading-8 text-slate-400">
            For IDEs, map tools, operations consoles, and every interface where panels become a
            product.
          </p>
        </div>
        <div className="flex gap-6 font-mono text-[11px] text-slate-500">
          <span>36 semantic commands</span>
          <span>190 traced requirements</span>
          <span>MIT</span>
        </div>
      </section>

      <section className="relative z-10 flex items-center">
        <div className="w-full rotate-[1.5deg] overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0b111a] shadow-[0_38px_100px_rgba(0,0,0,.55)]">
          <div className="flex h-12 items-center border-b border-white/[0.09] px-4">
            <div className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/10" />
              <i className="size-2.5 rounded-full bg-white/10" />
            </div>
            <span className="mx-auto font-mono text-[9px] text-slate-600">
              panefold-code / src / App.tsx
            </span>
            <Command className="size-3 text-slate-600" />
          </div>
          <div className="grid h-[410px] grid-cols-[0.32fr_1fr_0.45fr]">
            <div className="border-r border-white/[0.08] p-3">
              <MiniTab label="Explorer" />
              <div className="mt-5 space-y-3">
                {[70, 88, 58, 78, 64].map((width, index) => (
                  <div
                    key={width}
                    className={`h-2 rounded-full ${index === 1 ? "bg-cyan-300/25" : "bg-white/[0.07]"}`}
                    style={{ width: `${width}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="relative overflow-hidden border-r border-white/[0.08] bg-[#0c1720]">
              <MiniTab label="App.tsx" />
              <div className="grid grid-cols-[30px_1fr] px-3 py-5 font-mono text-[8px] leading-6">
                <div className="grid text-right text-slate-700">
                  {Array.from({ length: 10 }, (_, index) => (
                    <span key={index}>{index + 1}</span>
                  ))}
                </div>
                <div className="grid min-w-max pl-4 text-slate-300">
                  <code>
                    <span className="text-fuchsia-300">import</span> {"{ WorkspaceSurface }"};
                  </code>
                  <code> </code>
                  <code>
                    <span className="text-fuchsia-300">export function</span>{" "}
                    <span className="text-amber-200">App</span>() {"{"}
                  </code>
                  <code>
                    {" "}
                    <span className="text-fuchsia-300">return</span> (
                  </code>
                  <code>
                    {" "}
                    <span className="text-teal-200">&lt;WorkspaceSurface</span>
                  </code>
                  <code>
                    {" "}
                    <span className="text-sky-200">workspaceLabel</span>=
                    <span className="text-orange-200">&quot;Panefold Code&quot;</span>
                  </code>
                  <code>
                    {" "}
                    <span className="text-sky-200">responsive</span>=
                    <span className="text-orange-200">&quot;auto&quot;</span>
                  </code>
                  <code>
                    {" "}
                    <span className="text-teal-200">/&gt;</span>
                  </code>
                  <code> );</code>
                  <code>{"}"}</code>
                </div>
              </div>
              <div className="absolute right-2 top-12 grid w-12 gap-1 opacity-25">
                {[80, 52, 72, 45, 88, 64].map((width) => (
                  <i key={width} className="h-px bg-cyan-200" style={{ width: `${width}%` }} />
                ))}
              </div>
            </div>
            <div className="p-3">
              <MiniTab label="Outline" />
              <div className="mt-4 space-y-2">
                {["Symbol", "Line", "Type"].map((label, index) => (
                  <div key={label} className="rounded-md border border-white/[0.08] p-3">
                    <p className="font-mono text-[7px] uppercase tracking-wider text-slate-600">
                      {label}
                    </p>
                    <p
                      className={`mt-2 text-[10px] ${index === 0 ? "text-cyan-200" : "text-slate-300"}`}
                    >
                      {index === 0 ? "WorkspaceSurface" : index === 1 ? "10" : "Component"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex h-9 items-center border-t border-white/[0.08] px-4 font-mono text-[8px] text-slate-600">
            <span className="flex items-center gap-1.5 text-teal-300">
              <Check className="size-2.5" /> Kernel valid
            </span>
            <span className="ml-auto rounded bg-teal-300/10 px-2 py-1 text-teal-300">
              committed · r42
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

function MiniTab({ label }: { readonly label: string }) {
  return (
    <div className="flex h-7 items-center gap-1.5 border-b border-cyan-300/70 text-[8px] text-slate-300">
      <Layers3 className="size-2.5 text-cyan-300" />
      {label}
    </div>
  );
}
