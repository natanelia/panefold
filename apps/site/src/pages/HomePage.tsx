import { ArrowRight, ArrowUpRight, Check, ShieldCheck, Sparkles } from "lucide-react";

import { GitHubIcon } from "../components/Brand";
import { HeroWorkspace } from "../components/HeroWorkspace";
import { SiteLink } from "../components/SiteLink";
import { VideoShowcase } from "../components/VideoShowcase";
import {
  architectureLayers,
  craftPrinciples,
  featureCards,
  frameworkBindings,
  proofPoints,
} from "../content/marketing";
import { cn } from "../lib/cn";
import { siteAsset } from "../lib/router";

export function HomePage({ navigate }: { readonly navigate: (path: string) => void }) {
  return (
    <main id="main-content" tabIndex={-1}>
      <section className="relative overflow-hidden pb-24 pt-36 md:pb-32 md:pt-44">
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute left-1/2 top-[-180px] h-[680px] w-[900px] -translate-x-1/2 rounded-full bg-cyan-400/[0.055] blur-[120px]" />
        <div className="page-shell relative">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-200/[0.04] px-3 py-1.5 text-[11px] font-medium text-cyan-100/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <Sparkles className="size-3 text-cyan-300" />
              Experimental v0.1 · Repository evidence attached
            </div>
            <h1 className="text-balance font-display text-[clamp(3.2rem,8vw,7.25rem)] font-medium leading-[0.91] tracking-[-0.062em] text-white">
              Workspace state
              <span className="mt-2 block bg-gradient-to-r from-slate-400 via-cyan-100 to-teal-200 bg-clip-text text-transparent">
                you can reason about.
              </span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-slate-400 md:text-lg md:leading-8">
              Panefold is an experimental runtime for deterministic workspace state, with accessible
              interaction patterns built into its React reference projection.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <SiteLink
                to="/demo"
                navigate={navigate}
                data-track="hero_live_demo"
                className="button-primary h-12 px-6 text-sm"
              >
                Explore the live workspace <ArrowRight className="size-4" />
              </SiteLink>
              <a
                href="https://github.com/natanelia/panefold"
                target="_blank"
                rel="noreferrer"
                className="button-secondary h-12 px-5 text-sm"
                data-track="hero_github"
              >
                <GitHubIcon /> View source
              </a>
            </div>
            <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">
              Workspace-local packages · React/Chromium reference profile · no stable conformance
              claim
            </p>
          </div>

          <div className="relative mt-16 md:mt-20">
            <div className="pointer-events-none absolute inset-x-[12%] bottom-[-22%] h-[44%] rounded-full bg-cyan-400/10 blur-[100px]" />
            <HeroWorkspace />
            <p className="sr-only">
              Animated visualization of a Panefold map workspace changing tabs, resizing panes,
              moving a panel, and undoing a transaction.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 border-y border-white/[0.08] sm:grid-cols-4">
            {proofPoints.map((point, index) => (
              <div
                key={point.label}
                className={cn(
                  "px-4 py-5 text-center",
                  index > 0 && "sm:border-l sm:border-white/[0.08]",
                  index % 2 === 1 && "max-sm:border-l max-sm:border-white/[0.08]",
                  index > 1 && "max-sm:border-t max-sm:border-white/[0.08]",
                )}
              >
                <p className="font-mono text-xl font-medium tracking-tight text-slate-100">
                  {point.value}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  {point.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-slate-400">
            Repository-local evidence for v0.1; it does not imply stable certification.{" "}
            <SiteLink
              to="/docs/conformance"
              navigate={navigate}
              className="text-cyan-200/80 underline decoration-cyan-200/20 underline-offset-4 hover:text-cyan-100"
            >
              Inspect conformance status
            </SiteLink>
            .
          </p>
        </div>
      </section>

      <section id="why" className="section-space border-t border-white/[0.06] bg-[#080c12]">
        <div className="page-shell">
          <SectionHeading
            eyebrow="Why Panefold"
            title="Complex interfaces fail in the seams."
            description="Panefold gives layout, focus, history, rendering, and operational work explicit boundaries—so adding a feature does not create a second source of truth."
          />
          <div className="mt-14 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className={cn("feature-card group", feature.size === "wide" && "lg:col-span-2")}
                >
                  <div
                    className={cn(
                      "mb-8 grid size-10 place-items-center rounded-xl border",
                      `feature-${feature.tone}`,
                    )}
                  >
                    <Icon className="size-[18px]" strokeWidth={1.7} />
                  </div>
                  <h3 className="font-display text-xl font-medium tracking-[-0.025em] text-slate-100">
                    {feature.title}
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                    {feature.description}
                  </p>
                  <p className="mt-8 border-t border-white/[0.06] pt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">
                    {feature.detail}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section-space relative overflow-hidden border-t border-white/[0.06]">
        <div className="pointer-events-none absolute right-[-10%] top-[10%] size-[500px] rounded-full bg-teal-300/[0.035] blur-[100px]" />
        <div className="page-shell relative grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="section-eyebrow">Craft, made inspectable</p>
            <h2 className="section-title mt-4">A small set of rules. Applied everywhere.</h2>
            <p className="section-description mt-6">
              Panefold’s polish comes from consistency below the surface: committed authority is
              singular, transitions are explicit, and implemented operational edges expose bounded
              contracts and typed failures.
            </p>
            <SiteLink
              to="/docs/architecture"
              navigate={navigate}
              className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-100"
            >
              Read the architecture <ArrowUpRight className="size-4" />
            </SiteLink>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#090e15] p-4 shadow-2xl md:p-6">
            <div className="mb-5 flex items-center justify-between border-b border-white/[0.07] pb-4">
              <span className="font-mono text-[10px] text-slate-400">authority.graph</span>
              <span className="flex items-center gap-1.5 text-[9px] text-teal-300">
                <span className="size-1.5 rounded-full bg-teal-300" /> valid
              </span>
            </div>
            <div className="grid gap-2">
              {architectureLayers.map((layer, index) => (
                <div
                  key={layer.label}
                  className={cn(
                    "relative rounded-lg border bg-white/[0.018] px-4 py-3.5",
                    layer.color,
                  )}
                  style={{ marginInline: `${index * 18}px` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="font-mono text-[11px] font-medium text-slate-200">
                      {layer.label}
                    </strong>
                    <span className="text-[10px] text-slate-400">{layer.note}</span>
                  </div>
                  {index < architectureLayers.length - 1 ? (
                    <span className="absolute -bottom-3 left-7 z-10 h-3 w-px bg-white/15" />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-lg border border-teal-300/10 bg-teal-300/[0.025] px-4 py-3 font-mono text-[9px] leading-5 text-teal-100/60">
              invariant: committed state has exactly one owner
              <br />
              result: rejection cannot publish a partial snapshot
            </div>
          </div>
        </div>
      </section>

      <section className="section-space border-y border-white/[0.06] bg-[#080c12]">
        <div className="page-shell">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
            <div>
              <p className="section-eyebrow">Interaction film</p>
              <h2 className="section-title mt-4">The details are the product.</h2>
              <p className="section-description mt-6">
                Watch Panefold Code resize with solver-backed geometry, preserve its editor host,
                move panels semantically, and restore a close with one undo.
              </p>
              <ul className="mt-8 grid gap-3 text-sm text-slate-400">
                {[
                  "Frame-coalesced resize previews",
                  "Stable panel identity across movement",
                  "Focus repair outside semantic history",
                  "Reduced-motion-safe transitions",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="grid size-5 place-items-center rounded-full bg-teal-300/10 text-teal-300">
                      <Check className="size-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <VideoShowcase />
          </div>
        </div>
      </section>

      <section className="section-space">
        <div className="page-shell">
          <SectionHeading
            eyebrow="Principled engineering"
            title="Craftsmanship that survives the demo."
            description="The runtime applies the same rules across synthetic heavy-content fixtures, overlapping gestures, injected storage failures, and headless surface-loss tests—while real-world certification remains explicit work."
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.08] md:grid-cols-2">
            {craftPrinciples.map((principle) => {
              const Icon = principle.icon;
              return (
                <article key={principle.index} className="bg-[#080c12] p-7 md:p-9">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-slate-400">{principle.index}</span>
                    <Icon className="size-4 text-cyan-300/70" />
                  </div>
                  <h3 className="mt-8 font-display text-xl font-medium text-slate-100">
                    {principle.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{principle.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section-space border-y border-white/[0.06] bg-[#080c12]">
        <div className="page-shell">
          <div className="mb-9 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="section-eyebrow">Live reference fixture</p>
              <h2 className="section-title mt-4 max-w-2xl">Don’t take the screenshots on faith.</h2>
              <ol className="mt-6 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                {[
                  "Drag a tab to a group center to dock it.",
                  "Drop on any edge to create a new container.",
                  "Drag empty tab-strip space to move a container.",
                  "Use Actions to remove a container in one undoable merge.",
                  "Drag beyond the workspace to open a live popup.",
                  "Reload — the canonical layout returns from IndexedDB.",
                ].map((step, index) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-cyan-300/70">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <SiteLink
              to="/demo"
              navigate={navigate}
              data-track="fixture_fullscreen"
              className="button-secondary h-10 self-start px-4 md:self-auto"
            >
              Open full-screen demo <ArrowUpRight className="size-4" />
            </SiteLink>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#090e15] shadow-[0_30px_80px_rgba(0,0,0,.38)]">
            <div className="flex h-10 items-center border-b border-white/[0.08] bg-[#0c121b] px-3">
              <div className="flex gap-1.5">
                <i className="size-2 rounded-full bg-white/15" />
                <i className="size-2 rounded-full bg-white/10" />
                <i className="size-2 rounded-full bg-white/10" />
              </div>
              <span className="mx-auto font-mono text-[9px] text-slate-400">
                interactive · layout saved in this browser
              </span>
            </div>
            <iframe
              title="Interactive Panefold Code workbench demo"
              src={siteAsset("workbench/")}
              loading="lazy"
              className="h-[620px] w-full bg-[#08101d] max-md:h-[520px]"
            />
          </div>
        </div>
      </section>

      <section className="section-space">
        <div className="page-shell grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="section-eyebrow">One contract, two evidence levels</p>
            <h2 className="section-title mt-4">One browser fixture. Four contract bindings.</h2>
            <p className="section-description mt-6">
              React drives Panefold Code in automated Chromium. Vue, Svelte, Angular, and Web
              Components share the immutable-store and lifecycle contract in JSDOM; browser
              rendering certification remains pending.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {frameworkBindings.map((binding, index) => (
              <div
                key={binding.name}
                className={cn(
                  "flex h-16 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.018] px-4",
                  index === frameworkBindings.length - 1 && "sm:col-span-2",
                )}
              >
                <span className="font-display text-sm font-medium text-slate-300">
                  {binding.name}
                </span>
                <span className="rounded-full border border-white/[0.08] px-2 py-1 font-mono text-[8px] uppercase tracking-wide text-slate-400">
                  {binding.evidence}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-28 pt-8 md:pb-36">
        <div className="page-shell">
          <div className="relative overflow-hidden rounded-[24px] border border-cyan-200/15 bg-[linear-gradient(135deg,rgba(14,28,42,.92),rgba(7,12,18,.96))] px-6 py-14 text-center shadow-[0_30px_100px_rgba(0,0,0,.35)] md:px-12 md:py-20">
            <div className="hero-grid pointer-events-none absolute inset-0 opacity-30" />
            <ShieldCheck className="relative mx-auto size-7 text-teal-300" />
            <h2 className="relative mx-auto mt-5 max-w-3xl text-balance font-display text-4xl font-medium tracking-[-0.045em] text-white md:text-6xl">
              Evaluate Panefold against the hard parts.
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-sm leading-6 text-slate-400">
              Run Panefold Code, inspect support and conformance, then decide whether the
              experimental architecture fits your product.
            </p>
            <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <SiteLink
                to="/docs/overview"
                navigate={navigate}
                data-track="cta_docs"
                className="button-primary h-11 px-5"
              >
                Read the docs <ArrowRight className="size-4" />
              </SiteLink>
              <a
                href="https://github.com/natanelia/panefold"
                target="_blank"
                rel="noreferrer"
                data-track="cta_github"
                className="button-secondary h-11 px-5"
              >
                <GitHubIcon /> Star on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="section-eyebrow">{eyebrow}</p>
      <h2 className="section-title mt-4">{title}</h2>
      <p className="section-description mt-6">{description}</p>
    </div>
  );
}
