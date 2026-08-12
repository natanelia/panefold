import { cp, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const siteDist = resolve(root, "apps/site/dist");
const demoDist = resolve(root, "apps/demo/dist");
const siteOrigin = "https://natanelia.github.io/panefold";
const siteRoutes = [
  {
    path: "demo",
    title: "Live Atlas workspace — Panefold",
    description:
      "Try the interactive Atlas map-operations fixture powered by Panefold's deterministic workspace runtime.",
  },
  {
    path: "docs",
    title: "Documentation — Panefold",
    description:
      "Explore Panefold architecture, commands, support boundaries, conformance evidence, decisions, and system design.",
  },
  {
    path: "docs/overview",
    title: "Overview — Panefold documentation",
    description: "What Panefold is, what works today, and how to run it.",
  },
  {
    path: "docs/architecture",
    title: "Architecture — Panefold documentation",
    description: "Authority boundaries, state flow, and package responsibilities.",
  },
  {
    path: "docs/commands",
    title: "Command catalog — Panefold documentation",
    description: "All 36 semantic commands and their current support boundaries.",
  },
  {
    path: "docs/support",
    title: "Support matrix — Panefold documentation",
    description: "Framework, browser, surface, and capability status without hand-waving.",
  },
  {
    path: "docs/conformance",
    title: "Conformance — Panefold documentation",
    description: "Evidence inventory, hard gates, and the meaning of experimental.",
  },
  {
    path: "docs/roadmap",
    title: "Roadmap — Panefold documentation",
    description: "Completed engineering and the external evidence still required.",
  },
  {
    path: "docs/adr-authoritative-kernel",
    title: "Authoritative kernel — Panefold documentation",
    description: "Why all committed workspace state has one semantic owner.",
  },
  {
    path: "docs/adr-experimental-scope",
    title: "Experimental scope — Panefold documentation",
    description: "Why feature implementation and stable conformance are separate claims.",
  },
  {
    path: "docs/adr-schema-command-catalog",
    title: "Schema v2 and commands — Panefold documentation",
    description: "Snapshot evolution and the single command inventory.",
  },
  {
    path: "docs/adr-panel-lifecycle",
    title: "Panel lifecycle — Panefold documentation",
    description: "Stable hosts, suspension, cancellation, and renderer policy.",
  },
  {
    path: "docs/adr-persistence-trust",
    title: "Persistence and trust — Panefold documentation",
    description: "Durable journals, decoder bounds, and security boundaries.",
  },
  {
    path: "docs/adr-external-surfaces",
    title: "External surfaces — Panefold documentation",
    description: "Prepared transfer, ownership epochs, and orphan recovery.",
  },
  {
    path: "docs/system-design",
    title: "System design — Panefold documentation",
    description: "The complete normative design and 190-requirement register source.",
  },
];

await stat(resolve(demoDist, "index.html")).catch(() => {
  throw new Error("Atlas demo must be built before the marketing site");
});

await mkdir(resolve(siteDist, "atlas"), { recursive: true });
await cp(demoDist, resolve(siteDist, "atlas"), { recursive: true, force: true });
const rootHtml = await readFile(resolve(siteDist, "index.html"), "utf8");
for (const route of siteRoutes) {
  const routeDirectory = resolve(siteDist, route.path);
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(resolve(routeDirectory, "index.html"), withMetadata(rootHtml, route));
}
await copyFile(resolve(siteDist, "index.html"), resolve(siteDist, "404.html"));

function withMetadata(html, route) {
  const canonicalUrl = `${siteOrigin}/${route.path}/`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.description)}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.title)}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.description)}$2`,
    )
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/?>)/, `$1${canonicalUrl}$2`)
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.title)}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*("\s*\/?>)/,
      `$1${escapeHtml(route.description)}$2`,
    )
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/, `$1${canonicalUrl}$2`);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
