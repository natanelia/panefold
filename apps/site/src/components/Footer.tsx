import { Brand, GitHubIcon } from "./Brand";
import { SiteLink } from "./SiteLink";

export function Footer({ navigate }: { readonly navigate: (path: string) => void }) {
  return (
    <footer className="border-t border-white/[0.08] bg-[#06090e]">
      <div className="page-shell grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="mb-4 text-white">
            <Brand />
          </div>
          <p className="max-w-sm text-sm leading-6 text-slate-400">
            Deterministic workspace infrastructure for interfaces that cannot afford hidden state.
          </p>
          <p className="mt-5 inline-flex rounded-full border border-amber-300/15 bg-amber-300/[0.05] px-3 py-1 text-[11px] font-medium text-amber-200/70">
            v0.1 · Experimental
          </p>
        </div>
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Explore
          </p>
          <div className="grid gap-3 text-sm text-slate-400">
            <SiteLink
              to="/docs"
              navigate={navigate}
              data-track="footer_docs"
              className="hover:text-white"
            >
              Documentation
            </SiteLink>
            <SiteLink
              to="/demo"
              navigate={navigate}
              data-track="footer_demo"
              className="hover:text-white"
            >
              Live Atlas demo
            </SiteLink>
            <SiteLink to="/docs/architecture" navigate={navigate} className="hover:text-white">
              Architecture
            </SiteLink>
            <SiteLink to="/docs/support" navigate={navigate} className="hover:text-white">
              Support matrix
            </SiteLink>
          </div>
        </div>
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Project
          </p>
          <div className="grid gap-3 text-sm text-slate-400">
            <a
              href="https://github.com/natanelia/panefold"
              target="_blank"
              rel="noreferrer"
              data-track="footer_github"
              className="inline-flex items-center gap-2 hover:text-white"
            >
              <GitHubIcon /> GitHub
            </a>
            <a
              href="https://github.com/natanelia/panefold/issues"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              Issues
            </a>
            <a
              href="https://github.com/natanelia/panefold/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              MIT License
            </a>
            <a
              href="https://github.com/natanelia/panefold/blob/main/THIRD_PARTY_NOTICES.md"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              Third-party notices
            </a>
          </div>
        </div>
      </div>
      <div className="page-shell flex flex-col gap-2 border-t border-white/[0.06] py-5 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>Built in public. Claims stay as precise as the runtime.</span>
        <span>© {new Date().getFullYear()} Panefold</span>
      </div>
    </footer>
  );
}
