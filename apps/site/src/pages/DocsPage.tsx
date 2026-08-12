import { Check, ChevronRight, Clipboard, FileText, Menu, Search, X } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { SiteLink } from "../components/SiteLink";
import { GitHubIcon } from "../components/Brand";
import {
  docBySlug,
  docPages,
  docSections,
  headingId,
  headingsFor,
  type DocPage,
} from "../content/docs";
import { cn } from "../lib/cn";
import { siteAsset } from "../lib/router";

interface DocsPageProps {
  readonly slug?: string | undefined;
  readonly navigate: (path: string) => void;
}

const markdownRouteMap: Readonly<Record<string, string>> = {
  "docs/ARCHITECTURE.md": "/docs/architecture",
  "ARCHITECTURE.md": "/docs/architecture",
  "docs/COMMANDS.md": "/docs/commands",
  "COMMANDS.md": "/docs/commands",
  "docs/SUPPORT.md": "/docs/support",
  "SUPPORT.md": "/docs/support",
  "docs/CONFORMANCE.md": "/docs/conformance",
  "CONFORMANCE.md": "/docs/conformance",
  "docs/ROADMAP.md": "/docs/roadmap",
  "ROADMAP.md": "/docs/roadmap",
  "docs/spec/SYSTEM_DESIGN.md": "/docs/system-design",
  "spec/SYSTEM_DESIGN.md": "/docs/system-design",
  "docs/adr/0001-authoritative-kernel.md": "/docs/adr-authoritative-kernel",
  "adr/0001-authoritative-kernel.md": "/docs/adr-authoritative-kernel",
  "docs/adr/0002-experimental-scope.md": "/docs/adr-experimental-scope",
  "adr/0002-experimental-scope.md": "/docs/adr-experimental-scope",
  "docs/adr/0003-schema-v2-and-command-catalog.md": "/docs/adr-schema-command-catalog",
  "adr/0003-schema-v2-and-command-catalog.md": "/docs/adr-schema-command-catalog",
  "docs/adr/0004-panel-lifecycle-contract.md": "/docs/adr-panel-lifecycle",
  "adr/0004-panel-lifecycle-contract.md": "/docs/adr-panel-lifecycle",
  "docs/adr/0005-durable-journal-and-trust-boundaries.md": "/docs/adr-persistence-trust",
  "adr/0005-durable-journal-and-trust-boundaries.md": "/docs/adr-persistence-trust",
  "docs/adr/0006-prepared-external-surface-ownership.md": "/docs/adr-external-surfaces",
  "adr/0006-prepared-external-surface-ownership.md": "/docs/adr-external-surfaces",
};

export function DocsPage({ slug, navigate }: DocsPageProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const docsMenuButtonRef = useRef<HTMLButtonElement>(null);
  const docsMenuCloseRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const page = slug === undefined ? undefined : docBySlug(slug);
  const [loadedDocument, setLoadedDocument] = useState<{
    readonly slug: string;
    readonly source: string;
  }>();
  const source =
    loadedDocument !== undefined && loadedDocument.slug === page?.slug ? loadedDocument.source : "";

  useEffect(() => {
    let current = true;
    if (page === undefined) return () => undefined;
    void page.loadSource().then((value) => {
      if (current) setLoadedDocument({ slug: page.slug, source: value });
    });
    return () => {
      current = false;
    };
  }, [page]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("docs-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    docsMenuCloseRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        docsMenuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (source === "" || window.location.hash === "") return;
    window.requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    });
  }, [source]);

  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === "") return docPages;
    return docPages.filter(
      (item) =>
        item.title.toLowerCase().includes(normalized) ||
        item.description.toLowerCase().includes(normalized) ||
        item.section.toLowerCase().includes(normalized),
    );
  }, [query]);

  return (
    <main className="min-h-screen bg-[#080c12] pt-[68px]">
      <div className="border-b border-white/[0.07] bg-[#090e15] lg:hidden">
        <div className="flex h-12 items-center justify-between px-4">
          <span className="text-xs font-medium text-slate-300">Documentation</span>
          <button
            ref={docsMenuButtonRef}
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex h-8 items-center rounded-md border border-white/10 px-2.5 text-slate-400"
            aria-label="Browse documentation pages"
          >
            <span className="mr-2 text-[11px]">Browse docs</span>
            <Menu className="size-4" />
          </button>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1480px]">
        <DocsSidebar
          query={query}
          onQuery={setQuery}
          filteredPages={filteredPages}
          currentSlug={slug}
          navigate={navigate}
          className="sticky top-[68px] hidden h-[calc(100vh-68px)] w-[280px] shrink-0 border-r border-white/[0.07] lg:block"
        />

        {sidebarOpen ? (
          <div className="fixed inset-0 z-[80] lg:hidden">
            <button
              type="button"
              aria-label="Close documentation navigation"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            <div
              className="relative h-full w-[min(86vw,320px)] border-r border-white/10 bg-[#090e15] shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Documentation navigation"
            >
              <button
                ref={docsMenuCloseRef}
                type="button"
                className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-md border border-white/10 text-slate-400"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close documentation navigation"
              >
                <X className="size-4" />
              </button>
              <DocsSidebar
                query={query}
                onQuery={setQuery}
                filteredPages={filteredPages}
                currentSlug={slug}
                navigate={(path) => {
                  setSidebarOpen(false);
                  navigate(path);
                }}
                className="h-full"
              />
            </div>
          </div>
        ) : null}

        {page === undefined && slug !== undefined ? (
          <div className="grid min-h-[70vh] flex-1 place-items-center px-6 text-center">
            <div>
              <p className="font-mono text-xs text-cyan-300">404</p>
              <h1 className="mt-4 font-display text-4xl text-white">Document not found</h1>
              <p className="mt-3 text-sm text-slate-400">
                This route is not part of the current documentation set.
              </p>
              <SiteLink to="/docs" navigate={navigate} className="button-secondary mt-7 h-10 px-4">
                Browse documentation
              </SiteLink>
            </div>
          </div>
        ) : page === undefined ? (
          <DocsIndex navigate={navigate} />
        ) : (
          <DocArticle page={page} source={source} navigate={navigate} />
        )}
      </div>
    </main>
  );
}

interface SidebarProps {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly filteredPages: readonly DocPage[];
  readonly currentSlug?: string | undefined;
  readonly navigate: (path: string) => void;
  readonly className?: string;
}

function DocsSidebar({
  query,
  onQuery,
  filteredPages,
  currentSlug,
  navigate,
  className,
}: SidebarProps) {
  return (
    <aside className={cn("overflow-y-auto bg-[#090e15]", className)}>
      <div className="p-5">
        <SiteLink
          to="/docs"
          navigate={navigate}
          className="mb-5 block font-display text-sm font-semibold text-slate-200"
        >
          Documentation
        </SiteLink>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.09] bg-black/15 px-2.5 text-slate-400 focus-within:border-cyan-300/30 focus-within:text-slate-300">
          <Search className="size-3.5" />
          <input
            id="docs-search"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Filter pages"
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[8px] text-slate-400">
            ⌘K
          </kbd>
        </label>
      </div>
      <nav className="px-3 pb-8" aria-label="Documentation">
        {docSections.map((section) => {
          const pages = filteredPages.filter((item) => item.section === section);
          if (pages.length === 0) return null;
          return (
            <div key={section} className="mb-5">
              <p className="mb-1.5 px-2 font-mono text-[9px] uppercase tracking-[0.15em] text-slate-400">
                {section}
              </p>
              {pages.map((item) => (
                <SiteLink
                  key={item.slug}
                  to={`/docs/${item.slug}`}
                  navigate={navigate}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2 py-2 text-[12px] transition hover:bg-white/[0.04] hover:text-slate-200",
                    currentSlug === item.slug
                      ? "bg-cyan-300/[0.06] text-cyan-100"
                      : "text-slate-400",
                  )}
                  aria-current={currentSlug === item.slug ? "page" : undefined}
                >
                  <span className="truncate">{item.title}</span>
                  {currentSlug === item.slug ? (
                    <ChevronRight className="size-3 text-cyan-300" />
                  ) : null}
                </SiteLink>
              ))}
            </div>
          );
        })}
        {filteredPages.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-5 text-slate-400">
            No documentation matches “{query}”.
          </p>
        ) : null}
      </nav>
    </aside>
  );
}

function DocsIndex({ navigate }: { readonly navigate: (path: string) => void }) {
  return (
    <div className="min-w-0 flex-1 px-5 py-14 md:px-10 lg:px-14 lg:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="section-eyebrow">Panefold documentation</p>
        <h1 className="mt-5 max-w-3xl text-balance font-display text-5xl font-medium tracking-[-0.045em] text-white md:text-6xl">
          Understand the boundaries. Then build.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-slate-400">
          Start with the architecture and command model, then inspect support and conformance before
          adopting an experimental package.
        </p>
        <div className="mt-12 grid gap-3 md:grid-cols-2">
          {docPages.slice(0, 6).map((page) => (
            <SiteLink
              key={page.slug}
              to={`/docs/${page.slug}`}
              navigate={navigate}
              className="group rounded-xl border border-white/[0.08] bg-white/[0.018] p-5 transition hover:border-cyan-200/20 hover:bg-cyan-200/[0.025]"
            >
              <div className="flex items-start justify-between gap-4">
                <FileText className="size-4 text-cyan-300/70" />
                <ChevronRight className="size-4 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-cyan-300" />
              </div>
              <h2 className="mt-6 font-display text-lg font-medium text-slate-200">{page.title}</h2>
              <p className="mt-2 text-xs leading-5 text-slate-400">{page.description}</p>
            </SiteLink>
          ))}
        </div>
        <div className="mt-12 rounded-xl border border-white/[0.08] bg-[#0b1119] p-6 md:flex md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-200">Prefer to inspect the source?</p>
            <p className="mt-1 text-xs text-slate-400">
              Every page is rendered directly from its repository Markdown file.
            </p>
          </div>
          <a
            href="https://github.com/natanelia/panefold/tree/main/docs"
            target="_blank"
            rel="noreferrer"
            className="button-secondary mt-5 h-9 px-3.5 md:mt-0"
          >
            <GitHubIcon className="size-3.5" /> Browse docs on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

function DocArticle({
  page,
  source,
  navigate,
}: {
  readonly page: DocPage;
  readonly source: string;
  readonly navigate: (path: string) => void;
}) {
  const headings = useMemo(() => headingsFor(source), [source]);
  const body = preparedMarkdown(source.replace(/^#\s+.+\n+/, ""), page.slug);
  const components = useMemo(() => markdownComponents(navigate), [navigate]);

  return (
    <div className="flex min-w-0 flex-1">
      <article className="min-w-0 flex-1 px-5 py-12 md:px-10 lg:px-14 lg:py-16">
        <div className="docs-prose mx-auto max-w-[820px]">
          <div className="mb-11 border-b border-white/[0.08] pb-9">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/75">
              {page.eyebrow ?? page.section}
            </p>
            <h1 className="mt-4 font-display text-4xl font-medium tracking-[-0.04em] text-white md:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">{page.description}</p>
          </div>
          {body === "" ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
              Loading document…
            </p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {body}
            </ReactMarkdown>
          )}
          <div className="mt-14 border-t border-white/[0.08] pt-6 text-xs text-slate-400">
            Documentation source: repository Markdown at commit{" "}
            <a
              href="https://github.com/natanelia/panefold"
              className="text-slate-400 hover:text-cyan-200"
            >
              main
            </a>
            .
          </div>
        </div>
      </article>
      {headings.length > 0 ? (
        <aside className="sticky top-[68px] hidden h-[calc(100vh-68px)] w-[220px] shrink-0 overflow-y-auto border-l border-white/[0.07] px-6 py-12 xl:block">
          <p className="mb-4 font-mono text-[9px] uppercase tracking-[0.15em] text-slate-400">
            On this page
          </p>
          <nav className="grid gap-2.5">
            {headings.map((heading) => (
              <a
                key={`${heading.id}-${heading.depth}`}
                href={`#${heading.id}`}
                className={cn(
                  "text-[11px] leading-4 text-slate-400 transition hover:text-slate-200",
                  heading.depth === 3 && "pl-3",
                )}
              >
                {heading.label}
              </a>
            ))}
          </nav>
        </aside>
      ) : null}
    </div>
  );
}

function markdownComponents(navigate: (path: string) => void): Components {
  const heading = (Tag: "h1" | "h2" | "h3" | "h4") =>
    function MarkdownHeading({ children, ...props }: ComponentPropsWithoutRef<typeof Tag>) {
      const label = nodeText(children);
      return (
        <Tag id={headingId(label)} {...props}>
          {children}
        </Tag>
      );
    };

  return {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    a: ({ href = "", children, ...props }) => {
      const [path, hash] = href.split("#", 2);
      const mapped = markdownRouteMap[path ?? ""];
      if (mapped !== undefined)
        return (
          <SiteLink
            to={`${mapped}${hash === undefined ? "" : `#${hash}`}`}
            navigate={navigate}
            {...props}
          >
            {children}
          </SiteLink>
        );
      if (href.startsWith("#"))
        return (
          <a href={href} {...props}>
            {children}
          </a>
        );
      if (/^https?:\/\//.test(href))
        return (
          <a href={href} target="_blank" rel="noreferrer" {...props}>
            {children}
          </a>
        );
      const githubHref = githubSourceUrl(href);
      return (
        <a href={githubHref} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      );
    },
    img: ({ src = "", alt = "", title, ...props }) => {
      const imageSource = src.startsWith("media/")
        ? siteAsset(`docs/${src}`)
        : src.startsWith("/")
          ? siteAsset(src)
          : src;
      return (
        <figure className="docs-figure">
          <img
            src={imageSource}
            alt={alt}
            title={title}
            loading="lazy"
            decoding="async"
            {...props}
          />
        </figure>
      );
    },
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  };
}

function githubSourceUrl(href: string): string {
  const [withoutHash = href, hash] = href.split("#", 2);
  const rootRelative = withoutHash.replace(/^(?:\.\.\/)+/, "").replace(/^\.\//, "");
  return `https://github.com/natanelia/panefold/blob/main/${rootRelative}${hash === undefined ? "" : `#${hash}`}`;
}

function preparedMarkdown(source: string, slug: string): string {
  let result = source.replaceAll("<u>", "").replaceAll("</u>", "");
  result = result.replace(
    /<img\s+src="([^"]+)"\s+title="([^"]+)"\s+style="[^"]*"\s+alt="([^"]+)"\s*\/>/g,
    '![$3]($1 "$2")',
  );
  if (slug === "system-design") {
    result = result.replace(/\(#appendix-([a-j])\.-/g, "(#appendix-$1-");
  }
  return result;
}

function CodeBlock({ children }: { readonly children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const value = nodeText(children).replace(/\n$/, "");
  return (
    <div className="code-frame group relative">
      <button
        type="button"
        className="code-copy absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-md border border-white/10 bg-[#0d141e] text-slate-400 opacity-0 transition hover:text-slate-200 group-hover:opacity-100 focus:opacity-100"
        aria-label={copied ? "Code copied" : "Copy code"}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="size-3.5 text-teal-300" /> : <Clipboard className="size-3.5" />}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Code copied to clipboard" : ""}
      </span>
      <pre>{children}</pre>
    </div>
  );
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return Children.toArray(node).map(nodeText).join("");
}
