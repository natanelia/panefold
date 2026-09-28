import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ExternalLink,
  Search,
} from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SiteLink } from "../components/SiteLink";
import { CodeBlock } from "../components/CodeBlock";
import { TabPlayground } from "../components/TabPlayground";
import {
  docBySlug,
  docPages,
  docSections,
  headingAnchors,
  headingsFor,
  resolveDocLink,
  sourceUrl,
  type DocPage,
} from "../content/docs";
import { siteAsset, sitePath } from "../lib/router";
import { preparedMarkdown } from "../lib/markdown";

type Navigate = (path: string) => void;
type SearchDocument = { readonly page: DocPage; readonly text: string };
let searchDocuments: Promise<readonly SearchDocument[]> | undefined;
function loadSearchDocuments() {
  searchDocuments ??= Promise.all(
    docPages.map(async (page) => ({ page, text: (await page.loadSource()).replace(/\s+/g, " ") })),
  ).catch((error: unknown) => {
    searchDocuments = undefined;
    throw error;
  });
  return searchDocuments;
}
export function DocsPage({
  slug,
  navigate,
}: {
  readonly slug?: string | undefined;
  readonly navigate: Navigate;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<readonly SearchDocument[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const page = slug === undefined ? undefined : docBySlug(slug);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (event.key === "Escape" && open) {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (query.trim() === "" || search.length > 0) return;
    let active = true;
    setSearchFailed(false);
    void loadSearchDocuments()
      .then((items) => {
        if (active) setSearch(items);
      })
      .catch(() => {
        if (active) setSearchFailed(true);
      });
    return () => {
      active = false;
    };
  }, [query, search.length]);
  const normalized = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      docPages.flatMap((item) => {
        const titleMatch = `${item.title} ${item.description} ${item.section}`
          .toLowerCase()
          .includes(normalized);
        const document = search.find((entry) => entry.page.slug === item.slug)?.text;
        const index = normalized === "" ? -1 : (document?.toLowerCase().indexOf(normalized) ?? -1);
        if (!titleMatch && index < 0) return [];
        const excerpt =
          index < 0 || document === undefined
            ? item.description
            : `${index > 40 ? "…" : ""}${document.slice(Math.max(0, index - 40), index + 105)}…`;
        return [{ page: item, excerpt }];
      }),
    [normalized, search],
  );
  const follow = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="docs-mobile-bar">
        <span>{page?.title ?? "Documentation"}</span>
        <button
          ref={menuRef}
          type="button"
          aria-expanded={open}
          aria-controls="docs-sidebar"
          onClick={() => setOpen(!open)}
          aria-label="Browse documentation pages"
        >
          Browse docs <ChevronDown size={14} />
        </button>
      </div>
      <div className="docs-layout">
        <aside id="docs-sidebar" className="docs-sidebar" data-open={open}>
          <SiteLink to="/docs" navigate={follow} className="docs-sidebar-title">
            The developer's guide
          </SiteLink>
          <label className="docs-search-label">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search documentation</span>
            <input
              ref={searchRef}
              id="docs-search"
              type="search"
              placeholder="Search guides & reference"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd aria-hidden="true">⌘ K</kbd>
          </label>
          {normalized !== "" ? (
            <p className="docs-search-status" role="status">
              {searchFailed
                ? "Full-text search unavailable. Showing title matches; change your search to retry."
                : search.length === 0
                  ? "Searching document text…"
                  : `${results.length} matching ${results.length === 1 ? "page" : "pages"}`}
            </p>
          ) : null}
          <nav aria-label="Documentation">
            {docSections.map((section) => {
              const items = results.filter((item) => item.page.section === section);
              if (items.length === 0) return null;
              return (
                <div className="docs-nav-group" key={section}>
                  <p>{section}</p>
                  {items.map(({ page: item, excerpt }) => (
                    <SiteLink
                      key={item.slug}
                      to={`/docs/${item.slug}`}
                      navigate={follow}
                      aria-current={slug === item.slug ? "page" : undefined}
                    >
                      {item.title}
                      {normalized === "" ? null : <small>{excerpt}</small>}
                    </SiteLink>
                  ))}
                </div>
              );
            })}
            {results.length === 0 ? (
              <p className="docs-search-status">
                No pages match “{query}”. Try “tabs”, “checkpoint” or “split”.
              </p>
            ) : null}
          </nav>
        </aside>
        {page !== undefined ? (
          <DocArticle key={page.slug} page={page} navigate={navigate} />
        ) : slug === undefined ? (
          <DocsIndex navigate={navigate} />
        ) : (
          <div className="docs-message">
            <p className="section-eyebrow">404</p>
            <h1>Document not found</h1>
            <p>This page is not in the documentation catalog.</p>
            <SiteLink to="/docs" navigate={navigate} className="text-link">
              Browse documentation <ArrowRight size={16} />
            </SiteLink>
          </div>
        )}
      </div>
    </main>
  );
}
function DocsIndex({ navigate }: { readonly navigate: Navigate }) {
  const cards = [
    "quickstart",
    "mental-model",
    "react",
    "panels",
    "tabs",
    "styling",
    "layouts",
    "persistence",
    "windows",
    "production",
  ];
  return (
    <div className="docs-index">
      <p className="section-eyebrow">A workspace worth making your own</p>
      <h1>
        From first panel
        <br />
        <span>to your product.</span>
      </h1>
      <p className="docs-index-intro">
        Start with something you can run. Learn the few concepts that hold it together. Then shape
        the interactions, appearance and persistence around your application.
      </p>
      <div className="button-row">
        <SiteLink to="/docs/quickstart" navigate={navigate} className="button-primary">
          Build your first workspace <ArrowRight size={16} />
        </SiteLink>
        <a href={siteAsset("workbench/?fixture=starter")} className="text-link">
          Open the starter <ArrowUpRight size={16} />
        </a>
      </div>
      <p className="fine-print">
        Experimental · Source-only · MIT. Start with React; check the support matrix for other
        adapters.
      </p>
      <h2>The path to your first integration</h2>
      <div className="docs-card-grid">
        {cards.map((slug) => {
          const page = docBySlug(slug);
          if (page === undefined) return null;
          return (
            <SiteLink
              key={slug}
              to={`/docs/${slug}`}
              navigate={navigate}
              className="docs-card group"
            >
              <span className="docs-card-top">
                <BookOpen size={17} />
                <ArrowUpRight size={17} />
              </span>
              <h3>{page.title}</h3>
              <p>{page.description}</p>
            </SiteLink>
          );
        })}
      </div>
      <h2>Already building?</h2>
      <div className="docs-reference-links">
        {[
          "api",
          "troubleshooting",
          "commands",
          "architecture",
          "performance",
          "support",
          "conformance",
        ].map((slug) => (
          <SiteLink key={slug} to={`/docs/${slug}`} navigate={navigate}>
            {docBySlug(slug)?.title}
          </SiteLink>
        ))}
      </div>
      <h2>Go below the surface</h2>
      <p className="docs-index-intro">
        The implementation decisions, complete system design and measured evidence are still here.
        They belong alongside a practical guide—not in the way of getting started.
      </p>
      <div className="docs-reference-links">
        {["system-design", "design-audit", "roadmap", "adr-authoritative-kernel"].map((slug) => (
          <SiteLink key={slug} to={`/docs/${slug}`} navigate={navigate}>
            {docBySlug(slug)?.title}
          </SiteLink>
        ))}
      </div>
    </div>
  );
}
function DocArticle({ page, navigate }: { readonly page: DocPage; readonly navigate: Navigate }) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void page
      .loadSource()
      .then((value) => {
        if (active) setSource(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [page, attempt]);
  const body = preparedMarkdown(
    page.slug === "system-design" ? (source ?? "") : (source ?? "").replace(/^#\s+.+\n+/, ""),
    page.slug,
  );
  const headings = useMemo(() => headingsFor(body), [body]);
  const components = useMemo(
    () => markdownComponents(page, body, navigate),
    [page, body, navigate],
  );
  useEffect(() => {
    if (source === undefined) return;
    const frame = requestAnimationFrame(() => {
      try {
        document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
      } catch {
        /* A malformed fragment is not a document load failure. */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [source]);
  const index = docPages.indexOf(page);
  const previous = docPages[index - 1];
  const next = docPages[index + 1];
  return (
    <div className="docs-body">
      <article className="docs-article">
        <div className="docs-article-inner">
          <header className="doc-header">
            <p className="section-eyebrow">{page.eyebrow ?? `${page.section} / Developer guide`}</p>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
          </header>
          {failed ? (
            <div role="alert">
              <p>We couldn't load this document. Your connection may have changed.</p>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry document
              </button>
              <a href={sourceUrl(page.sourcePath)} className="text-link">
                Read the source <ExternalLink size={14} />
              </a>
            </div>
          ) : source === undefined ? (
            <p role="status" className="fine-print">
              Loading document…
            </p>
          ) : (
            <div className="docs-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {body}
              </ReactMarkdown>
            </div>
          )}
          {page.slug === "tabs" ? (
            <>
              <h2 className="mt-10 mb-5 text-xl font-semibold">Try the presentation</h2>
              <TabPlayground />
            </>
          ) : null}
          <div className="doc-source">
            <a href={sourceUrl(page.sourcePath)} target="_blank" rel="noreferrer">
              Read or edit this page <ExternalLink size={12} />
            </a>
            <span>Source-backed documentation · experimental 0.1.0</span>
          </div>
          <nav className="doc-pagination" aria-label="Adjacent documentation">
            {previous ? (
              <SiteLink to={`/docs/${previous.slug}`} navigate={navigate}>
                <small>Previous</small>
                {previous.title}
              </SiteLink>
            ) : (
              <span />
            )}
            {next ? (
              <SiteLink to={`/docs/${next.slug}`} navigate={navigate}>
                <small>Next</small>
                {next.title}
              </SiteLink>
            ) : null}
          </nav>
        </div>
      </article>
      {headings.length > 0 ? (
        <aside className="docs-toc">
          <p>On this page</p>
          <nav aria-label="On this page">
            {headings.map((heading) => (
              <a key={heading.id} data-depth={heading.depth} href={`#${heading.id}`}>
                {heading.label}
              </a>
            ))}
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
function markdownComponents(page: DocPage, body: string, navigate: Navigate): Components {
  const anchors = headingAnchors(body);
  const heading =
    (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"): NonNullable<Components[typeof Tag]> =>
    ({ children, node }) => {
      const id = anchors.get(node?.position?.start.line ?? 0);
      return (
        <Tag id={id} aria-label={nodeText(children)}>
          {children}
          {id ? (
            <a
              className="heading-anchor"
              href={`#${id}`}
              aria-label={`Link to ${nodeText(children)}`}
            >
              #
            </a>
          ) : null}
        </Tag>
      );
    };
  return {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: heading("h5"),
    h6: heading("h6"),
    a: ({ href = "", children }) => {
      const link = resolveDocLink(href, page);
      if (link === undefined) return <span>{children}</span>;
      if (link.kind === "site")
        return /^\/(workbench|atlas)(?:[/?#]|$)/.test(link.href) ? (
          <a href={sitePath(link.href)}>{children}</a>
        ) : (
          <SiteLink to={link.href} navigate={navigate}>
            {children}
          </SiteLink>
        );
      return (
        <a
          href={link.href}
          {...(link.kind === "external" ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {children}
        </a>
      );
    },
    img: ({ src = "", alt = "", title }) => (
      <span className="docs-figure">
        <img
          src={src.startsWith("media/") ? siteAsset(`docs/${src}`) : src}
          alt={alt}
          title={title}
          loading="lazy"
          decoding="async"
        />
      </span>
    ),
    table: ({ children }) => (
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable reference table"
      >
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }) => {
      const child = Children.toArray(children).find((item) => isValidElement(item));
      const language = isValidElement<{ className?: string }>(child)
        ? child.props.className?.replace("language-", "")
        : undefined;
      return (
        <CodeBlock
          code={nodeText(children).replace(/\n$/, "")}
          {...(language ? { language } : {})}
        />
      );
    },
  };
}
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}
