import { ArrowUpRight, Menu, X } from "lucide-react";
import { useState } from "react";

import { Brand, GitHubIcon } from "./Brand";
import { SiteLink } from "./SiteLink";
import { cn } from "../lib/cn";

interface HeaderProps {
  readonly path: string;
  readonly navigate: (path: string) => void;
}

const links = [
  { label: "Why Panefold", path: "/#why" },
  { label: "Docs", path: "/docs" },
  { label: "Live demo", path: "/demo" },
] as const;

export function Header({ path, navigate }: HeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.07] bg-ink-950/80 backdrop-blur-xl">
      <div className="page-shell flex h-[68px] items-center justify-between">
        <SiteLink
          to="/"
          navigate={navigate}
          className="text-white transition-opacity hover:opacity-80"
          aria-label="Panefold home"
        >
          <Brand />
        </SiteLink>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          {links.map((link) => {
            const route = link.path.split("#")[0] ?? link.path;
            return (
              <SiteLink
                key={link.path}
                to={link.path}
                navigate={navigate}
                className={cn(
                  "rounded-full px-4 py-2 text-[13px] font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-white",
                  path.startsWith(route) &&
                    link.path !== "/#why" &&
                    "bg-white/[0.05] text-slate-100",
                )}
                aria-current={path.startsWith(route) && link.path !== "/#why" ? "page" : undefined}
              >
                {link.label}
              </SiteLink>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a
            href="https://github.com/natanelia/panefold"
            className="button-secondary h-9 px-3.5"
            target="_blank"
            rel="noreferrer"
            data-track="header_github"
          >
            <GitHubIcon />
            GitHub
          </a>
          <SiteLink
            to="/docs/overview"
            navigate={navigate}
            data-track="header_docs"
            className="button-primary h-9 px-4"
          >
            Read docs
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </SiteLink>
        </div>

        <button
          type="button"
          className="grid size-10 place-items-center rounded-lg border border-white/10 text-slate-300 md:hidden"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <nav
          className="border-t border-white/[0.07] bg-ink-950 px-5 py-4 md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto grid max-w-6xl gap-1">
            {links.map((link) => (
              <SiteLink
                key={link.path}
                to={link.path}
                navigate={navigate}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </SiteLink>
            ))}
            <a
              href="https://github.com/natanelia/panefold"
              className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-3 text-sm font-medium text-slate-300"
              target="_blank"
              rel="noreferrer"
              data-track="mobile_github"
            >
              <GitHubIcon /> GitHub
            </a>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
