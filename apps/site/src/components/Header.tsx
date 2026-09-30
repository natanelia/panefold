import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Brand, GitHubIcon } from "./Brand";
import { SiteLink } from "./SiteLink";

export function Header({
  path,
  navigate,
}: {
  readonly path: string;
  readonly navigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="site-header">
      <div className="header-inner">
        <SiteLink to="/" navigate={navigate} aria-label="Panefold home">
          <Brand />
        </SiteLink>
        <SiteLink to="/docs/support" navigate={navigate} className="status-pill">
          Experimental
        </SiteLink>
        <button
          type="button"
          className="mobile-menu"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="site-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav id="site-navigation" aria-label="Main navigation" data-open={open}>
          <SiteLink to="/#why" navigate={navigate}>
            Why Panefold
          </SiteLink>
          <SiteLink
            to="/docs"
            navigate={navigate}
            aria-current={path.startsWith("/docs") ? "page" : undefined}
          >
            Documentation
          </SiteLink>
          <SiteLink
            to="/demo"
            navigate={navigate}
            aria-current={path === "/demo" ? "page" : undefined}
          >
            Playground <ArrowUpRight size={14} />
          </SiteLink>
          <a href="https://github.com/natanelia/panefold" target="_blank" rel="noreferrer">
            <GitHubIcon /> <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
