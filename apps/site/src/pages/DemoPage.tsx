import { ArrowLeft, ExternalLink, Info } from "lucide-react";

import { SiteLink } from "../components/SiteLink";
import { siteAsset } from "../lib/router";

export function DemoPage({ navigate }: { readonly navigate: (path: string) => void }) {
  return (
    <main className="flex h-dvh min-h-0 flex-col pt-[68px]">
      <div className="flex min-h-[54px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.08] bg-[#080c12] px-4 py-2 md:px-6">
        <SiteLink
          to="/"
          navigate={navigate}
          data-track="demo_back_home"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white"
        >
          <ArrowLeft className="size-3.5" /> Back to Panefold
        </SiteLink>
        <span className="h-4 w-px bg-white/10" />
        <div className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-slate-400">
          <Info className="size-3.5 text-cyan-300" /> Atlas is an interactive reference fixture.
          State lives in this session only.
        </div>
        <a
          href={siteAsset("atlas/")}
          target="_blank"
          rel="noreferrer"
          data-track="demo_open_standalone"
          className="ml-auto hidden items-center gap-2 text-[11px] font-medium text-slate-400 hover:text-white sm:flex"
        >
          Open alone <ExternalLink className="size-3" />
        </a>
      </div>
      <iframe
        title="Panefold Atlas live workspace demo"
        src={siteAsset("atlas/")}
        className="block min-h-0 flex-1 w-full bg-[#08101d]"
      />
    </main>
  );
}
