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
              atlas / route-analysis
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
              <MiniTab label="Map canvas" />
              <div className="absolute inset-0 top-9 opacity-25 [background-image:linear-gradient(rgba(125,211,252,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,.14)_1px,transparent_1px)] [background-size:27px_27px]" />
              <svg
                className="absolute inset-0 top-9 h-[calc(100%-36px)] w-full"
                viewBox="0 0 500 360"
                fill="none"
              >
                <path
                  d="M45 350 C85 250 150 252 205 205 S260 120 320 115 S420 122 470 35"
                  stroke="#1d2d3c"
                  strokeWidth="16"
                />
                <path
                  d="M72 304 C120 260 146 243 207 204 S260 144 322 116 S404 84 456 54"
                  stroke="#5eead4"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <circle cx="72" cy="304" r="7" fill="#0c1720" stroke="#7dd3fc" strokeWidth="3" />
                <circle cx="456" cy="54" r="7" fill="#0c1720" stroke="#5eead4" strokeWidth="3" />
              </svg>
            </div>
            <div className="p-3">
              <MiniTab label="Inspector" />
              <div className="mt-4 space-y-2">
                {["Selection", "Distance", "Traffic"].map((label, index) => (
                  <div key={label} className="rounded-md border border-white/[0.08] p-3">
                    <p className="font-mono text-[7px] uppercase tracking-wider text-slate-600">
                      {label}
                    </p>
                    <p
                      className={`mt-2 text-[10px] ${index === 0 ? "text-cyan-200" : "text-slate-300"}`}
                    >
                      {index === 0 ? "Ayer Rajah Ave" : index === 1 ? "2.8 km" : "Moderate"}
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
